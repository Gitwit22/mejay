import {MarketplaceError} from './service'
import {reconcileRecipientAllocations, reportingOrderAmounts, type ReportingOrderMoney} from './reporting-money'
import {reportingPeriod, type ReportingPeriod, type ReportingRange} from './reporting-schemas'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
}

type Database = {prepare: (sql: string) => Statement}

type OrderRow = {
  id: string
  paid_at: string
  buyer_country_code: string | null
  gross_amount_minor: number
  platform_fee_minor: number
  provider_proceeds_minor: number
  refunded_amount_minor: number
  payment_status: string
  transfer_status: ReportingOrderMoney['transferStatus']
  dispute_status: ReportingOrderMoney['disputeStatus']
  release_id: string
  release_title: string
  artist_name: string
}

type AllocationRow = {
  id: string
  order_id: string
  track_id: string | null
  track_title: string
  payee_name: string
  payee_email: string | null
  payee_role: string | null
  amount_minor: number
}

type DownloadRow = {
  release_id: string
  release_title: string
  track_id: string | null
  track_title: string
  download_count: number
}

type AdjustedAllocation = AllocationRow & {adjustedAmountMinor: number}

export type ProviderSalesReport = {
  period: ReportingPeriod
  currency: 'USD'
  summary: {
    grossSalesMinor: number
    unitsSold: number
    earningsMinor: number
    pendingMinor: number
    paidOutMinor: number
    refundsMinor: number
    refundCount: number
    downloadCount: number
  }
  topSongs: Array<{trackId: string | null; title: string; units: number; earningsMinor: number}>
  salesByRelease: Array<{releaseId: string; title: string; artistName: string; units: number; grossMinor: number; earningsMinor: number; refundsMinor: number; downloads: number}>
  salesByDay: Array<{date: string; units: number; grossMinor: number; earningsMinor: number; refundsMinor: number}>
  salesByTerritory: Array<{countryCode: string | null; units: number; grossMinor: number; earningsMinor: number}>
  downloads: DownloadRow[]
  refunds: Array<{orderId: string; saleDate: string; releaseId: string; releaseTitle: string; amountMinor: number; status: string}>
  recipientLiabilities: Array<{name: string; email: string | null; role: string | null; allocatedMinor: number; refundAdjustmentMinor: number; owedMinor: number}>
}

export type RecipientEarningsReport = {
  period: ReportingPeriod
  currency: 'USD'
  recipientEmail: string
  summary: {allocatedMinor: number; refundAdjustmentMinor: number; owedMinor: number}
  rows: Array<{allocationId: string; orderId: string; saleDate: string; releaseId: string; releaseTitle: string; trackId: string | null; trackTitle: string; role: string | null; allocatedMinor: number; refundAdjustmentMinor: number; owedMinor: number}>
}

function moneyFor(order: OrderRow): ReportingOrderMoney {
  return {
    grossAmountMinor: Number(order.gross_amount_minor),
    platformFeeMinor: Number(order.platform_fee_minor),
    providerProceedsMinor: Number(order.provider_proceeds_minor),
    refundedAmountMinor: Number(order.refunded_amount_minor),
    transferStatus: order.transfer_status,
    disputeStatus: order.dispute_status,
  }
}

function adjustedAllocations(orders: OrderRow[], allocations: AllocationRow[]): AdjustedAllocation[] {
  const orderById = new Map(orders.map((order) => [order.id, order]))
  const byOrder = new Map<string, AllocationRow[]>()
  for (const allocation of allocations) {
    const values = byOrder.get(allocation.order_id) ?? []
    values.push(allocation)
    byOrder.set(allocation.order_id, values)
  }
  const adjusted: AdjustedAllocation[] = []
  for (const [orderId, values] of byOrder) {
    const order = orderById.get(orderId)
    if (!order) continue
    const net = reportingOrderAmounts(moneyFor(order)).earningsMinor
    const amounts = reconcileRecipientAllocations(net, values.map(({id, amount_minor}) => ({id, amountMinor: Number(amount_minor)})))
    for (const value of values) adjusted.push({...value, adjustedAmountMinor: amounts.get(value.id) ?? 0})
  }
  return adjusted
}

function zeroDays(period: ReportingPeriod): Map<string, ProviderSalesReport['salesByDay'][number]> {
  const days = new Map<string, ProviderSalesReport['salesByDay'][number]>()
  if (!period.startAt) return days
  const cursor = new Date(period.startAt)
  const end = new Date(period.endAt)
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10)
    days.set(date, {date, units: 0, grossMinor: 0, earningsMinor: 0, refundsMinor: 0})
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

export function buildProviderSalesReport(
  period: ReportingPeriod,
  orders: OrderRow[],
  allocations: AllocationRow[],
  downloads: DownloadRow[],
): ProviderSalesReport {
  const adjusted = adjustedAllocations(orders, allocations)
  const orderById = new Map(orders.map((order) => [order.id, order]))
  const summary = {grossSalesMinor: 0, unitsSold: orders.length, earningsMinor: 0, pendingMinor: 0, paidOutMinor: 0, refundsMinor: 0, refundCount: 0, downloadCount: 0}
  const releases = new Map<string, ProviderSalesReport['salesByRelease'][number]>()
  const territories = new Map<string, ProviderSalesReport['salesByTerritory'][number]>()
  const days = zeroDays(period)

  for (const order of orders) {
    const amounts = reportingOrderAmounts(moneyFor(order))
    summary.grossSalesMinor += Number(order.gross_amount_minor)
    summary.earningsMinor += amounts.earningsMinor
    summary.pendingMinor += amounts.pendingMinor
    summary.paidOutMinor += amounts.paidOutMinor
    summary.refundsMinor += Number(order.refunded_amount_minor)
    if (Number(order.refunded_amount_minor) > 0) summary.refundCount += 1

    const release = releases.get(order.release_id) ?? {releaseId: order.release_id, title: order.release_title, artistName: order.artist_name, units: 0, grossMinor: 0, earningsMinor: 0, refundsMinor: 0, downloads: 0}
    release.units += 1
    release.grossMinor += Number(order.gross_amount_minor)
    release.earningsMinor += amounts.earningsMinor
    release.refundsMinor += Number(order.refunded_amount_minor)
    releases.set(order.release_id, release)

    const countryKey = order.buyer_country_code ?? 'Unknown'
    const territory = territories.get(countryKey) ?? {countryCode: order.buyer_country_code, units: 0, grossMinor: 0, earningsMinor: 0}
    territory.units += 1
    territory.grossMinor += Number(order.gross_amount_minor)
    territory.earningsMinor += amounts.earningsMinor
    territories.set(countryKey, territory)

    const date = order.paid_at.slice(0, 10)
    const day = days.get(date) ?? {date, units: 0, grossMinor: 0, earningsMinor: 0, refundsMinor: 0}
    day.units += 1
    day.grossMinor += Number(order.gross_amount_minor)
    day.earningsMinor += amounts.earningsMinor
    day.refundsMinor += Number(order.refunded_amount_minor)
    days.set(date, day)
  }

  const songs = new Map<string, ProviderSalesReport['topSongs'][number] & {orders: Set<string>}>()
  const liabilities = new Map<string, ProviderSalesReport['recipientLiabilities'][number]>()
  for (const allocation of adjusted) {
    const songKey = allocation.track_id ?? `${allocation.order_id}:${allocation.track_title}`
    const song = songs.get(songKey) ?? {trackId: allocation.track_id, title: allocation.track_title, units: 0, earningsMinor: 0, orders: new Set<string>()}
    song.orders.add(allocation.order_id)
    song.earningsMinor += allocation.adjustedAmountMinor
    songs.set(songKey, song)

    const normalizedEmail = allocation.payee_email?.trim().toLowerCase() ?? null
    const liabilityKey = `${normalizedEmail ?? ''}|${allocation.payee_name.toLowerCase()}|${allocation.payee_role ?? ''}`
    const liability = liabilities.get(liabilityKey) ?? {name: allocation.payee_name, email: normalizedEmail, role: allocation.payee_role, allocatedMinor: 0, refundAdjustmentMinor: 0, owedMinor: 0}
    liability.allocatedMinor += Number(allocation.amount_minor)
    liability.owedMinor += allocation.adjustedAmountMinor
    liability.refundAdjustmentMinor += Number(allocation.amount_minor) - allocation.adjustedAmountMinor
    liabilities.set(liabilityKey, liability)
  }
  for (const song of songs.values()) song.units = song.orders.size

  for (const download of downloads) {
    const count = Number(download.download_count)
    summary.downloadCount += count
    const release = releases.get(download.release_id)
    if (release) release.downloads += count
  }

  return {
    period,
    currency: 'USD',
    summary,
    topSongs: [...songs.values()].map(({orders: _orders, ...song}) => song).sort((left, right) => right.units - left.units || right.earningsMinor - left.earningsMinor || left.title.localeCompare(right.title)).slice(0, 10),
    salesByRelease: [...releases.values()].sort((left, right) => right.units - left.units || right.grossMinor - left.grossMinor || left.title.localeCompare(right.title)),
    salesByDay: [...days.values()].sort((left, right) => left.date.localeCompare(right.date)),
    salesByTerritory: [...territories.values()].sort((left, right) => right.units - left.units || right.grossMinor - left.grossMinor || (left.countryCode ?? '').localeCompare(right.countryCode ?? '')),
    downloads: [...downloads].sort((left, right) => Number(right.download_count) - Number(left.download_count) || left.track_title.localeCompare(right.track_title)),
    refunds: orders.filter((order) => Number(order.refunded_amount_minor) > 0).map((order) => ({orderId: order.id, saleDate: order.paid_at, releaseId: order.release_id, releaseTitle: order.release_title, amountMinor: Number(order.refunded_amount_minor), status: order.payment_status})).sort((left, right) => right.saleDate.localeCompare(left.saleDate)),
    recipientLiabilities: [...liabilities.values()].sort((left, right) => right.owedMinor - left.owedMinor || left.name.localeCompare(right.name)),
  }
}

export function buildRecipientEarningsReport(period: ReportingPeriod, email: string, orders: OrderRow[], allocations: AllocationRow[]): RecipientEarningsReport {
  const normalizedEmail = email.trim().toLowerCase()
  const adjusted = adjustedAllocations(orders, allocations).filter((allocation) => allocation.payee_email?.trim().toLowerCase() === normalizedEmail)
  const orderById = new Map(orders.map((order) => [order.id, order]))
  const summary = {allocatedMinor: 0, refundAdjustmentMinor: 0, owedMinor: 0}
  const rows = adjusted.map((allocation) => {
    const order = orderById.get(allocation.order_id)!
    const allocatedMinor = Number(allocation.amount_minor)
    const refundAdjustmentMinor = allocatedMinor - allocation.adjustedAmountMinor
    summary.allocatedMinor += allocatedMinor
    summary.refundAdjustmentMinor += refundAdjustmentMinor
    summary.owedMinor += allocation.adjustedAmountMinor
    return {allocationId: allocation.id, orderId: order.id, saleDate: order.paid_at, releaseId: order.release_id, releaseTitle: order.release_title, trackId: allocation.track_id, trackTitle: allocation.track_title, role: allocation.payee_role, allocatedMinor, refundAdjustmentMinor, owedMinor: allocation.adjustedAmountMinor}
  }).sort((left, right) => right.saleDate.localeCompare(left.saleDate) || left.trackTitle.localeCompare(right.trackTitle))
  return {period, currency: 'USD', recipientEmail: normalizedEmail, summary, rows}
}

export class MarketplaceReportingService {
  constructor(private readonly database: Database) {}

  private async ordersForProvider(providerId: string, period: ReportingPeriod): Promise<OrderRow[]> {
    const {results} = await this.database.prepare(
      `SELECT orders.id, orders.paid_at, orders.buyer_country_code, orders.gross_amount_minor,
        orders.platform_fee_minor, orders.provider_proceeds_minor, orders.refunded_amount_minor,
        orders.payment_status, orders.transfer_status, orders.dispute_status,
        item.release_id, item.release_title, item.artist_name
       FROM marketplace_orders orders
       JOIN marketplace_order_items item ON item.order_id = orders.id
       WHERE orders.provider_profile_id = ?1 AND orders.payment_status <> 'failed'
         AND (?2::timestamptz IS NULL OR orders.paid_at >= ?2::timestamptz)
         AND orders.paid_at <= ?3::timestamptz
       ORDER BY orders.paid_at DESC, orders.id`,
    ).bind(providerId, period.startAt, period.endAt).all<OrderRow>()
    return results
  }

  private async allocationsForOrders(providerId: string, period: ReportingPeriod, recipientEmail?: string): Promise<AllocationRow[]> {
    const {results} = await this.database.prepare(
      `SELECT allocation.id, allocation.order_id, allocation.track_id, allocation.track_title,
        allocation.payee_name, allocation.payee_email, allocation.payee_role, allocation.amount_minor
       FROM marketplace_split_allocations allocation
       JOIN marketplace_orders orders ON orders.id = allocation.order_id
       WHERE orders.provider_profile_id = ?1 AND orders.payment_status <> 'failed'
         AND (?2::timestamptz IS NULL OR orders.paid_at >= ?2::timestamptz)
         AND orders.paid_at <= ?3::timestamptz
         AND (?4::text IS NULL OR EXISTS (
           SELECT 1 FROM marketplace_split_allocations matched
           WHERE matched.order_id = orders.id AND LOWER(matched.payee_email) = ?4
         ))
       ORDER BY allocation.order_id, allocation.track_id, allocation.id`,
    ).bind(providerId, period.startAt, period.endAt, recipientEmail ?? null).all<AllocationRow>()
    return results
  }

  async getProviderReport(userId: string, range: ReportingRange): Promise<ProviderSalesReport> {
    const membership = await this.database.prepare(
      'SELECT provider_profile_id FROM provider_members WHERE user_id = ?1 ORDER BY created_at LIMIT 1',
    ).bind(userId).first<{provider_profile_id: string}>()
    if (!membership) throw new MarketplaceError(403, 'provider_required', 'A provider profile is required')
    const period = reportingPeriod(range)
    const [orders, allocations, downloadResult] = await Promise.all([
      this.ordersForProvider(membership.provider_profile_id, period),
      this.allocationsForOrders(membership.provider_profile_id, period),
      this.database.prepare(
        `SELECT item.release_id, item.release_title, file.track_id, file.track_title,
          COUNT(event.id)::integer AS download_count
         FROM marketplace_download_events event
         JOIN download_entitlements entitlement ON entitlement.id = event.entitlement_id
         JOIN marketplace_orders orders ON orders.id = entitlement.order_id
         JOIN marketplace_order_items item ON item.id = entitlement.order_item_id
         JOIN download_entitlement_files file ON file.id = event.entitlement_file_id
         WHERE orders.provider_profile_id = ?1
           AND (?2::timestamptz IS NULL OR event.downloaded_at >= ?2::timestamptz)
           AND event.downloaded_at <= ?3::timestamptz
         GROUP BY item.release_id, item.release_title, file.track_id, file.track_title`,
      ).bind(membership.provider_profile_id, period.startAt, period.endAt).all<DownloadRow>(),
    ])
    return buildProviderSalesReport(period, orders, allocations, downloadResult.results)
  }

  async getRecipientReport(userId: string, range: ReportingRange): Promise<RecipientEarningsReport> {
    const user = await this.database.prepare('SELECT email FROM users WHERE id = ?1').bind(userId).first<{email: string}>()
    if (!user) throw new MarketplaceError(401, 'unauthorized', 'Account session is no longer valid')
    const email = user.email.trim().toLowerCase()
    const period = reportingPeriod(range)
    const providers = await this.database.prepare(
      `SELECT DISTINCT orders.provider_profile_id
       FROM marketplace_split_allocations allocation
       JOIN marketplace_orders orders ON orders.id = allocation.order_id
       WHERE LOWER(allocation.payee_email) = ?1`,
    ).bind(email).all<{provider_profile_id: string}>()
    const allOrders: OrderRow[] = []
    const allAllocations: AllocationRow[] = []
    for (const {provider_profile_id: providerId} of providers.results) {
      const [orders, allocations] = await Promise.all([
        this.ordersForProvider(providerId, period),
        this.allocationsForOrders(providerId, period, email),
      ])
      allOrders.push(...orders)
      allAllocations.push(...allocations)
    }
    return buildRecipientEarningsReport(period, email, allOrders, allAllocations)
  }
}
