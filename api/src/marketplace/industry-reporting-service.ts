import {MarketplaceError} from './service'
import {validateReportingMetadata, type ReportingEventSnapshot} from './industry-reporting'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
  run: () => Promise<unknown>
}

type Database = {
  prepare: (sql: string) => Statement
  transaction: <T>(callback: (database: Database) => Promise<T>) => Promise<T>
}

type Staff = {role: 'reviewer' | 'admin'}

export type IndustryReportingExportEvent = Omit<ReportingEventSnapshot, 'validationStatus' | 'validationErrors'> & {
  validation_status: 'pending' | 'ready' | 'metadata_error'
  validation_errors: string[] | string
  batch_id: string | null
}

type BatchRow = {
  id: string
  report_date: string
  status: 'exported' | 'submitted' | 'accepted' | 'rejected'
  event_count: number
  export_format: 'csv'
  export_data: string
  submitted_at: string | null
  resolved_at: string | null
  rejection_reason: string | null
  created_at: string
}

export type IndustryReportingDashboard = {
  role: Staff['role']
  reportDate: string
  counts: {todaySales: number; ready: number; metadataErrors: number; submitted: number; rejected: number}
  events: Array<{
    id: string
    eventType: 'sale' | 'refund'
    isrc: string | null
    upc: string | null
    artistName: string
    releaseTitle: string
    trackTitle: string
    transactionId: string
    ledgerTransactionId: string
    priceMinor: number
    quantity: number
    territory: string | null
    occurredAt: string
    validationStatus: EventRow['validation_status']
    validationErrors: string[]
    batchId: string | null
  }>
  batches: Array<Omit<BatchRow, 'export_data'>>
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildReportingCsv(events: EventRow[]): string {
  const header = ['event_id', 'event_type', 'isrc', 'upc', 'artist', 'release', 'track', 'transaction', 'ledger_transaction', 'price_minor', 'currency', 'quantity', 'territory', 'timestamp']
  const rows = events.map((event) => [
    event.id, event.eventType, event.isrc, event.upc, event.artistName, event.releaseTitle,
    event.trackTitle, event.stripeTransactionId, event.ledgerTransactionId, event.priceMinor,
    event.currency, event.quantity, event.territory, event.occurredAt,
  ].map(csvCell).join(','))
  return `${header.join(',')}\r\n${rows.join('\r\n')}\r\n`
}

function parseErrors(value: string[] | string): string[] {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
  } catch {
    return []
  }
}

function eventForValidation(row: EventRow): Omit<ReportingEventSnapshot, 'validationStatus' | 'validationErrors'> {
  return {
    id: row.id,
    orderId: row.orderId,
    orderItemId: row.orderItemId,
    ledgerTransactionId: row.ledgerTransactionId,
    trackId: row.trackId,
    eventType: row.eventType,
    isrc: row.isrc,
    upc: row.upc,
    artistName: row.artistName,
    releaseTitle: row.releaseTitle,
    trackTitle: row.trackTitle,
    stripeTransactionId: row.stripeTransactionId,
    currency: row.currency,
    priceMinor: Number(row.priceMinor),
    quantity: Number(row.quantity),
    territory: row.territory,
    occurredAt: row.occurredAt,
  }
}

const eventSelect = `SELECT event.id, event.order_id AS "orderId", event.order_item_id AS "orderItemId",
  event.ledger_transaction_id AS "ledgerTransactionId", event.track_id AS "trackId",
  event.event_type AS "eventType", event.isrc, event.upc, event.artist_name AS "artistName",
  event.release_title AS "releaseTitle", event.track_title AS "trackTitle",
  event.stripe_transaction_id AS "stripeTransactionId", event.currency,
  event.price_minor AS "priceMinor", event.quantity, event.territory, event.occurred_at AS "occurredAt",
  state.validation_status, state.validation_errors, state.batch_id
 FROM marketplace_reporting_events event
 JOIN marketplace_reporting_event_states state ON state.event_id = event.id`

export class IndustryReportingService {
  constructor(private readonly database: Database) {}

  private async requireStaff(database: Database, userId: string, admin = false): Promise<Staff> {
    const staff = await database.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1').bind(userId).first<Staff>()
    if (!staff) throw new MarketplaceError(403, 'marketplace_staff_required', 'Marketplace staff access is required')
    if (admin && staff.role !== 'admin') throw new MarketplaceError(403, 'marketplace_admin_required', 'Marketplace admin access is required')
    return staff
  }

  private async validateDate(database: Database, reportDate: string): Promise<{ready: number; metadataErrors: number}> {
    const {results} = await database.prepare(
      `${eventSelect} WHERE (event.occurred_at AT TIME ZONE 'UTC')::date = ?1::date AND state.batch_id IS NULL ORDER BY event.occurred_at, event.id`,
    ).bind(reportDate).all<EventRow>()
    let ready = 0
    let metadataErrors = 0
    for (const event of results) {
      const errors = validateReportingMetadata(eventForValidation(event))
      const status = errors.length === 0 ? 'ready' : 'metadata_error'
      if (status === 'ready') ready += 1
      else metadataErrors += 1
      await database.prepare(
        `UPDATE marketplace_reporting_event_states SET validation_status = ?1, validation_errors = ?2,
          validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE event_id = ?3 AND batch_id IS NULL`,
      ).bind(status, JSON.stringify(errors), event.id).run()
    }
    return {ready, metadataErrors}
  }

  async getDashboard(userId: string, reportDate: string): Promise<IndustryReportingDashboard> {
    const staff = await this.requireStaff(this.database, userId)
    const counts = await this.database.prepare(
      `SELECT
        COALESCE(SUM(event.quantity) FILTER (WHERE event.event_type = 'sale'), 0)::integer AS "todaySales",
        COUNT(*) FILTER (WHERE state.validation_status = 'ready' AND state.batch_id IS NULL)::integer AS ready,
        COUNT(*) FILTER (WHERE state.validation_status = 'metadata_error')::integer AS "metadataErrors",
        COUNT(*) FILTER (WHERE batch.status IN ('submitted', 'accepted'))::integer AS submitted,
        COUNT(*) FILTER (WHERE batch.status = 'rejected')::integer AS rejected
       FROM marketplace_reporting_events event
       JOIN marketplace_reporting_event_states state ON state.event_id = event.id
       LEFT JOIN marketplace_reporting_batches batch ON batch.id = state.batch_id
       WHERE (event.occurred_at AT TIME ZONE 'UTC')::date = ?1::date`,
    ).bind(reportDate).first<IndustryReportingDashboard['counts']>()
    const events = await this.database.prepare(
      `${eventSelect} WHERE (event.occurred_at AT TIME ZONE 'UTC')::date = ?1::date ORDER BY event.occurred_at DESC, event.id`,
    ).bind(reportDate).all<EventRow>()
    const batches = await this.database.prepare(
      `SELECT id, report_date::text, status, event_count, export_format, submitted_at,
        resolved_at, rejection_reason, created_at
       FROM marketplace_reporting_batches ORDER BY report_date DESC LIMIT 30`,
    ).all<Omit<BatchRow, 'export_data'>>()
    return {
      role: staff.role,
      reportDate,
      counts: counts ?? {todaySales: 0, ready: 0, metadataErrors: 0, submitted: 0, rejected: 0},
      events: events.results.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        isrc: event.isrc,
        upc: event.upc,
        artistName: event.artistName,
        releaseTitle: event.releaseTitle,
        trackTitle: event.trackTitle,
        transactionId: event.stripeTransactionId,
        ledgerTransactionId: event.ledgerTransactionId,
        priceMinor: Number(event.priceMinor),
        quantity: Number(event.quantity),
        territory: event.territory,
        occurredAt: event.occurredAt,
        validationStatus: event.validation_status,
        validationErrors: parseErrors(event.validation_errors),
        batchId: event.batch_id,
      })),
      batches: batches.results,
    }
  }

  async validate(userId: string, reportDate: string): Promise<{ready: number; metadataErrors: number}> {
    await this.requireStaff(this.database, userId, true)
    return this.validateDate(this.database, reportDate)
  }

  async createBatch(userId: string, reportDate: string): Promise<Omit<BatchRow, 'export_data'>> {
    return this.database.transaction(async (database) => {
      await this.requireStaff(database, userId, true)
      const existing = await database.prepare(
        'SELECT id FROM marketplace_reporting_batches WHERE report_date = ?1::date FOR UPDATE',
      ).bind(reportDate).first<{id: string}>()
      if (existing) throw new MarketplaceError(409, 'reporting_batch_exists', 'A reporting batch already exists for this date')
      await this.validateDate(database, reportDate)
      const {results} = await database.prepare(
        `${eventSelect} WHERE (event.occurred_at AT TIME ZONE 'UTC')::date = ?1::date
          AND state.validation_status = 'ready' AND state.batch_id IS NULL ORDER BY event.occurred_at, event.id FOR UPDATE OF state`,
      ).bind(reportDate).all<EventRow>()
      if (results.length === 0) throw new MarketplaceError(409, 'reporting_batch_empty', 'No validated reporting events are ready for this date')
      const id = crypto.randomUUID()
      const row = await database.prepare(
        `INSERT INTO marketplace_reporting_batches
          (id, report_date, event_count, export_data, created_by_user_id)
         VALUES (?1, ?2::date, ?3, ?4, ?5)
         RETURNING id, report_date::text, status, event_count, export_format, submitted_at,
           resolved_at, rejection_reason, created_at`,
      ).bind(id, reportDate, results.length, buildReportingCsv(results), userId).first<Omit<BatchRow, 'export_data'>>()
      if (!row) throw new Error('Reporting batch insert failed')
      for (const event of results) {
        await database.prepare(
          'UPDATE marketplace_reporting_event_states SET batch_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE event_id = ?2 AND batch_id IS NULL',
        ).bind(id, event.id).run()
      }
      return row
    })
  }

  async getExport(userId: string, batchId: string): Promise<{fileName: string; data: string}> {
    await this.requireStaff(this.database, userId)
    const batch = await this.database.prepare(
      'SELECT report_date::text, export_data FROM marketplace_reporting_batches WHERE id = ?1',
    ).bind(batchId).first<{report_date: string; export_data: string}>()
    if (!batch) throw new MarketplaceError(404, 'reporting_batch_not_found', 'Reporting batch was not found')
    return {fileName: `mejay-reporting-${batch.report_date}.csv`, data: batch.export_data}
  }

  async submitBatch(userId: string, batchId: string): Promise<void> {
    await this.requireStaff(this.database, userId, true)
    const batch = await this.database.prepare(
      `UPDATE marketplace_reporting_batches SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP,
        resolved_at = NULL, rejection_reason = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND status IN ('exported', 'rejected') RETURNING id`,
    ).bind(batchId).first<{id: string}>()
    if (!batch) throw new MarketplaceError(409, 'reporting_batch_not_submittable', 'Reporting batch cannot be submitted from its current state')
  }

  async resolveBatch(userId: string, batchId: string, status: 'accepted' | 'rejected', reason?: string): Promise<void> {
    await this.requireStaff(this.database, userId, true)
    const batch = await this.database.prepare(
      `UPDATE marketplace_reporting_batches SET status = ?1, resolved_at = CURRENT_TIMESTAMP,
        rejection_reason = ?2, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?3 AND status = 'submitted' RETURNING id`,
    ).bind(status, status === 'rejected' ? reason ?? null : null, batchId).first<{id: string}>()
    if (!batch) throw new MarketplaceError(409, 'reporting_batch_not_resolvable', 'Only a submitted batch can be accepted or rejected')
  }
}

type EventRow = IndustryReportingExportEvent