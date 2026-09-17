export type ReportingEventType = 'sale' | 'refund'

export type ReportingTrackSnapshot = {
  id: string
  title: string
  isrc: string | null
  discNumber: number
  trackNumber: number
}

export type ReportingEventInput = {
  orderId: string
  orderItemId: string
  ledgerTransactionId: string
  eventType: ReportingEventType
  upc: string | null
  artistName: string
  releaseTitle: string
  stripeTransactionId: string
  currency: string
  amountMinor: number
  territory: string | null
  occurredAt: string
  tracks: ReportingTrackSnapshot[]
}

export type ReportingTrackAmount = ReportingTrackSnapshot & {priceMinor: number}

export type ReportingEventSnapshot = {
  id: string
  orderId: string
  orderItemId: string
  ledgerTransactionId: string
  trackId: string
  eventType: ReportingEventType
  isrc: string | null
  upc: string | null
  artistName: string
  releaseTitle: string
  trackTitle: string
  stripeTransactionId: string
  currency: string
  priceMinor: number
  quantity: number
  territory: string | null
  occurredAt: string
  validationStatus: 'ready' | 'metadata_error'
  validationErrors: string[]
}

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  run: () => Promise<unknown>
}

type Database = {prepare: (sql: string) => Statement}

export function validateReportingMetadata(event: Omit<ReportingEventSnapshot, 'validationStatus' | 'validationErrors'>): string[] {
  const errors: string[] = []
  if (!event.isrc || !/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(event.isrc)) errors.push('isrc_missing_or_invalid')
  if (!event.upc || !/^[0-9]{12,14}$/.test(event.upc)) errors.push('upc_missing_or_invalid')
  if (!event.artistName.trim()) errors.push('artist_missing')
  if (!event.releaseTitle.trim()) errors.push('release_missing')
  if (!event.trackTitle.trim()) errors.push('track_missing')
  if (!event.stripeTransactionId.trim()) errors.push('stripe_transaction_missing')
  if (!/^[A-Z]{3}$/.test(event.currency)) errors.push('currency_invalid')
  if (!event.territory || !/^[A-Z]{2}$/.test(event.territory)) errors.push('territory_missing_or_invalid')
  if (!Number.isSafeInteger(event.priceMinor) || event.priceMinor < 0) errors.push('price_invalid')
  return errors
}

export function buildReportingEvents(input: ReportingEventInput): ReportingEventSnapshot[] {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) throw new Error('Reporting amount must be a non-negative integer')
  if (input.tracks.length === 0) throw new Error('Reporting events require at least one track')
  const tracks = [...input.tracks].sort((left, right) => left.discNumber - right.discNumber || left.trackNumber - right.trackNumber || left.id.localeCompare(right.id))
  const basePrice = Math.floor(input.amountMinor / tracks.length)
  let remainder = input.amountMinor % tracks.length
  return buildReportingEventsForTrackAmounts({
    ...input,
    tracks: tracks.map((track) => ({...track, priceMinor: basePrice + (remainder-- > 0 ? 1 : 0)})),
  })
}

export function buildReportingEventsForTrackAmounts(input: Omit<ReportingEventInput, 'amountMinor' | 'tracks'> & {tracks: ReportingTrackAmount[]}): ReportingEventSnapshot[] {
  if (input.tracks.length === 0) throw new Error('Reporting events require at least one track')
  if (input.tracks.some((track) => !Number.isSafeInteger(track.priceMinor) || track.priceMinor < 0)) {
    throw new Error('Reporting track amounts must be non-negative integers')
  }
  return input.tracks.map((track) => {
    const event = {
      id: crypto.randomUUID(),
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      ledgerTransactionId: input.ledgerTransactionId,
      trackId: track.id,
      eventType: input.eventType,
      isrc: track.isrc?.trim().toUpperCase() || null,
      upc: input.upc?.trim() || null,
      artistName: input.artistName.trim(),
      releaseTitle: input.releaseTitle.trim(),
      trackTitle: track.title.trim(),
      stripeTransactionId: input.stripeTransactionId.trim(),
      currency: input.currency.trim().toUpperCase(),
      priceMinor: track.priceMinor,
      quantity: 1,
      territory: input.territory?.trim().toUpperCase() || null,
      occurredAt: input.occurredAt,
    }
    const validationErrors = validateReportingMetadata(event)
    return {...event, validationStatus: validationErrors.length === 0 ? 'ready' as const : 'metadata_error' as const, validationErrors}
  })
}

export async function insertReportingEvents(database: Database, events: ReportingEventSnapshot[]): Promise<void> {
  for (const event of events) {
    const inserted = await database.prepare(
      `INSERT INTO marketplace_reporting_events
        (id, order_id, order_item_id, ledger_transaction_id, track_id, event_type, isrc, upc,
          artist_name, release_title, track_title, stripe_transaction_id, currency, price_minor,
          quantity, territory, occurred_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
      ON CONFLICT (ledger_transaction_id, track_id) DO NOTHING
      RETURNING id`,
    ).bind(
      event.id, event.orderId, event.orderItemId, event.ledgerTransactionId, event.trackId,
      event.eventType, event.isrc, event.upc, event.artistName, event.releaseTitle, event.trackTitle,
      event.stripeTransactionId, event.currency, event.priceMinor, event.quantity, event.territory,
      event.occurredAt,
    ).first<{id: string}>()
    const persisted = inserted ?? await database.prepare(
      'SELECT id FROM marketplace_reporting_events WHERE ledger_transaction_id = ?1 AND track_id = ?2',
    ).bind(event.ledgerTransactionId, event.trackId).first<{id: string}>()
    if (!persisted) throw new Error('Reporting event was not persisted')
    await database.prepare(
      `INSERT INTO marketplace_reporting_event_states
        (event_id, validation_status, validation_errors, validated_at)
       VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP) ON CONFLICT (event_id) DO NOTHING`,
    ).bind(persisted.id, event.validationStatus, JSON.stringify(event.validationErrors)).run()
  }
}

export function allocateCumulativeRefunds(
  refundedAmountMinor: number,
  saleEvents: Array<{trackId: string; priceMinor: number}>,
  previouslyReported: Map<string, number>,
): Map<string, number> {
  if (!Number.isSafeInteger(refundedAmountMinor) || refundedAmountMinor < 0) throw new Error('Refund amount must be a non-negative integer')
  const grossMinor = saleEvents.reduce((sum, event) => sum + event.priceMinor, 0)
  if (grossMinor <= 0 || refundedAmountMinor > grossMinor) throw new Error('Refund amount cannot exceed reported sale gross')
  const targets = saleEvents.map((event) => {
    const weighted = refundedAmountMinor * event.priceMinor
    if (!Number.isSafeInteger(weighted)) throw new Error('Refund allocation exceeds safe integer precision')
    return {trackId: event.trackId, target: Math.floor(weighted / grossMinor), remainder: weighted % grossMinor}
  })
  let remaining = refundedAmountMinor - targets.reduce((sum, row) => sum + row.target, 0)
  targets.sort((left, right) => right.remainder - left.remainder || left.trackId.localeCompare(right.trackId))
  for (let index = 0; index < targets.length && remaining > 0; index += 1, remaining -= 1) targets[index].target += 1
  return new Map(targets.map(({trackId, target}) => {
    const delta = target - (previouslyReported.get(trackId) ?? 0)
    if (delta < 0) throw new Error('Previously reported track refunds exceed the cumulative target')
    return [trackId, delta]
  }))
}
