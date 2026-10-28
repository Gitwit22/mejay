import {MarketplaceError} from './service'
import {reportingOrderAmounts, type ReportingOrderMoney} from './reporting-money'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
}

type Database = {prepare: (sql: string) => Statement}

export type FinanceFilters = {
  /** Inclusive UTC sale date, YYYY-MM-DD. */
  from?: string
  /** Inclusive UTC sale date, YYYY-MM-DD. */
  to?: string
  providerId?: string
  /** The purchasable unit is a release (a single is a one-track release). */
  releaseId?: string
  paymentStatus?: string
}

export type FinanceOrderRow = {
  id: string
  paid_at: string
  provider_profile_id: string | null
  provider_name: string | null
  release_id: string | null
  release_title: string
  song_title: string | null
  artist_name: string
  currency: string
  gross_amount_minor: number
  platform_fee_minor: number
  provider_proceeds_minor: number
  stripe_fee_minor: number | null
  refunded_amount_minor: number
  platform_fee_bps: number | null
  payment_status: string
  transfer_status: ReportingOrderMoney['transferStatus']
  dispute_status: ReportingOrderMoney['disputeStatus']
  livemode: boolean | null
  /** platform_revenue credits minus debits from the immutable ledger (sale less refunds). */
  platform_revenue_net_minor: number
}

export type FinanceSummary = {
  currency: 'USD'
  filters: FinanceFilters
  totals: {
    orders: number
    grossSalesMinor: number
    stripeFeesMinor: number
    /** Orders whose Stripe fee has not been reported by Stripe yet (excluded from stripeFeesMinor). */
    ordersWithUnknownStripeFee: number
    platformCommissionMinor: number
    /** Stripe fees recovered from the artist share; commission + recovered + allocation = gross. */
    processingFeesRecoveredMinor: number
    artistAllocationMinor: number
    artistEarningsAfterAdjustmentsMinor: number
    refundsMinor: number
    refundedOrders: number
    /** Platform ledger revenue after refunds and lost disputes, less Stripe fees the platform paid. */
    netPlatformRevenueMinor: number
    disputes: {open: number; won: number; lost: number; openAmountMinor: number; lostAmountMinor: number}
    failedPayments: number
    pendingTransfers: {count: number; amountMinor: number}
    failedTransfers: {count: number; amountMinor: number}
  }
  /** One row per artist account across every order matching the filters (not only the listed ones). */
  byProvider: Array<{
    providerId: string | null
    providerName: string | null
    orders: number
    grossMinor: number
    platformCommissionMinor: number
    artistAllocationMinor: number
    /** Artist share after refunds and lost disputes. */
    artistEarningsMinor: number
    refundsMinor: number
    /** Earnings not yet sent to the artist's Stripe account (pre-orders and pending or failed transfers). */
    pendingPayoutMinor: number
    paidOutMinor: number
  }>
  transactions: Array<{
    orderId: string
    paidAt: string
    providerId: string | null
    providerName: string | null
    releaseTitle: string
    /** Song title for a single-song sale; null for a whole-release sale. */
    songTitle: string | null
    artistName: string
    grossMinor: number
    platformCommissionMinor: number
    stripeFeeMinor: number | null
    artistAllocationMinor: number
    refundedMinor: number
    paymentStatus: string
    transferStatus: string
    disputeStatus: string
    livemode: boolean | null
  }>
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PAYMENT_STATUSES = new Set(['paid', 'partially_refunded', 'refunded', 'disputed', 'failed'])
const TRANSACTION_LIMIT = 500

/** Commission at the rate snapshotted for the sale, rounded exactly as calculateSaleAmounts does. */
function commissionFor(row: FinanceOrderRow): number {
  const gross = Number(row.gross_amount_minor)
  if (row.platform_fee_bps === null || row.platform_fee_bps === undefined) return Number(row.platform_fee_minor)
  return Math.min(Number(row.platform_fee_minor), Math.floor((gross * Number(row.platform_fee_bps) + 5000) / 10000))
}

export function normalizeFinanceFilters(input: Record<string, string | undefined>): FinanceFilters {
  const filters: FinanceFilters = {}
  for (const key of ['from', 'to'] as const) {
    const value = input[key]?.trim()
    if (!value) continue
    if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      throw new MarketplaceError(400, 'invalid_date', `${key} must be a YYYY-MM-DD date`)
    }
    filters[key] = value
  }
  if (filters.from && filters.to && filters.from > filters.to) throw new MarketplaceError(400, 'invalid_date_range', 'from must not be after to')
  const providerId = input.providerId?.trim()
  if (providerId) filters.providerId = providerId.slice(0, 128)
  const releaseId = input.releaseId?.trim()
  if (releaseId) filters.releaseId = releaseId.slice(0, 128)
  const paymentStatus = input.status?.trim()
  if (paymentStatus) {
    if (!PAYMENT_STATUSES.has(paymentStatus)) throw new MarketplaceError(400, 'invalid_status', 'Unknown payment status')
    filters.paymentStatus = paymentStatus
  }
  return filters
}

export function buildFinanceSummary(filters: FinanceFilters, rows: FinanceOrderRow[], failedPayments: number): FinanceSummary {
  const totals: FinanceSummary['totals'] = {
    orders: rows.length,
    grossSalesMinor: 0,
    stripeFeesMinor: 0,
    ordersWithUnknownStripeFee: 0,
    platformCommissionMinor: 0,
    processingFeesRecoveredMinor: 0,
    artistAllocationMinor: 0,
    artistEarningsAfterAdjustmentsMinor: 0,
    refundsMinor: 0,
    refundedOrders: 0,
    netPlatformRevenueMinor: 0,
    disputes: {open: 0, won: 0, lost: 0, openAmountMinor: 0, lostAmountMinor: 0},
    failedPayments,
    pendingTransfers: {count: 0, amountMinor: 0},
    failedTransfers: {count: 0, amountMinor: 0},
  }
  const transactions: FinanceSummary['transactions'] = []
  const byProvider = new Map<string, FinanceSummary['byProvider'][number]>()
  for (const row of rows) {
    const gross = Number(row.gross_amount_minor)
    const commission = commissionFor(row)
    const stripeFee = row.stripe_fee_minor === null || row.stripe_fee_minor === undefined ? null : Number(row.stripe_fee_minor)
    const amounts = reportingOrderAmounts({
      grossAmountMinor: gross,
      platformFeeMinor: Number(row.platform_fee_minor),
      providerProceedsMinor: Number(row.provider_proceeds_minor),
      refundedAmountMinor: Number(row.refunded_amount_minor),
      transferStatus: row.transfer_status,
      disputeStatus: row.dispute_status,
    })
    totals.grossSalesMinor += gross
    totals.platformCommissionMinor += commission
    totals.processingFeesRecoveredMinor += Number(row.platform_fee_minor) - commission
    totals.artistAllocationMinor += Number(row.provider_proceeds_minor)
    totals.artistEarningsAfterAdjustmentsMinor += amounts.earningsMinor
    if (stripeFee === null) totals.ordersWithUnknownStripeFee += 1
    else totals.stripeFeesMinor += stripeFee
    if (Number(row.refunded_amount_minor) > 0) {
      totals.refundsMinor += Number(row.refunded_amount_minor)
      totals.refundedOrders += 1
    }
    // A lost dispute returns the whole sale to the buyer: the platform keeps none of its share.
    const platformRevenue = row.dispute_status === 'lost' ? 0 : Number(row.platform_revenue_net_minor)
    totals.netPlatformRevenueMinor += platformRevenue - (stripeFee ?? 0)
    if (row.dispute_status === 'open') {
      totals.disputes.open += 1
      totals.disputes.openAmountMinor += gross
    } else if (row.dispute_status === 'won') {
      totals.disputes.won += 1
    } else if (row.dispute_status === 'lost') {
      totals.disputes.lost += 1
      totals.disputes.lostAmountMinor += gross
    }
    if (row.transfer_status === 'pending') {
      totals.pendingTransfers.count += 1
      totals.pendingTransfers.amountMinor += amounts.earningsMinor
    } else if (row.transfer_status === 'failed') {
      totals.failedTransfers.count += 1
      totals.failedTransfers.amountMinor += amounts.earningsMinor
    }
    const providerKey = row.provider_profile_id ?? ''
    const provider = byProvider.get(providerKey) ?? {
      providerId: row.provider_profile_id, providerName: row.provider_name, orders: 0, grossMinor: 0, platformCommissionMinor: 0,
      artistAllocationMinor: 0, artistEarningsMinor: 0, refundsMinor: 0, pendingPayoutMinor: 0, paidOutMinor: 0,
    }
    provider.orders += 1
    provider.grossMinor += gross
    provider.platformCommissionMinor += commission
    provider.artistAllocationMinor += Number(row.provider_proceeds_minor)
    provider.artistEarningsMinor += amounts.earningsMinor
    provider.refundsMinor += Number(row.refunded_amount_minor)
    provider.pendingPayoutMinor += amounts.pendingMinor
    provider.paidOutMinor += amounts.paidOutMinor
    byProvider.set(providerKey, provider)
    if (transactions.length < TRANSACTION_LIMIT) {
      transactions.push({
        orderId: row.id,
        paidAt: row.paid_at,
        providerId: row.provider_profile_id,
        providerName: row.provider_name,
        releaseTitle: row.release_title,
        songTitle: row.song_title ?? null,
        artistName: row.artist_name,
        grossMinor: gross,
        platformCommissionMinor: commission,
        stripeFeeMinor: stripeFee,
        artistAllocationMinor: Number(row.provider_proceeds_minor),
        refundedMinor: Number(row.refunded_amount_minor),
        paymentStatus: row.payment_status,
        transferStatus: row.transfer_status,
        disputeStatus: row.dispute_status,
        livemode: row.livemode,
      })
    }
  }
  const providers = [...byProvider.values()].sort((left, right) => right.grossMinor - left.grossMinor || String(left.providerName).localeCompare(String(right.providerName)))
  return {currency: 'USD', filters, totals, byProvider: providers, transactions}
}

/** A spreadsheet cell. Text that a spreadsheet would run as a formula (=, +, -, @) is quoted with a leading apostrophe. */
function csvCell(value: string | number | boolean | null): string {
  if (value === null) return ''
  if (typeof value !== 'string') return String(value)
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const dollars = (minor: number | null) => minor === null ? null : (minor / 100).toFixed(2)

/** Every order matching the filters, one per line, with the same money split the Finance page shows. */
export function buildFinanceCsv(rows: FinanceOrderRow[]): string {
  const header = ['order_id', 'paid_at_utc', 'artist_account', 'artist', 'release', 'song', 'currency', 'gross', 'mejay_commission', 'stripe_fees_recovered', 'artist_allocation', 'artist_earnings_after_adjustments', 'stripe_fee', 'refunded', 'payment_status', 'transfer_status', 'dispute_status', 'live_mode']
  const lines = rows.map((row) => {
    const commission = commissionFor(row)
    const amounts = reportingOrderAmounts({
      grossAmountMinor: Number(row.gross_amount_minor), platformFeeMinor: Number(row.platform_fee_minor), providerProceedsMinor: Number(row.provider_proceeds_minor),
      refundedAmountMinor: Number(row.refunded_amount_minor), transferStatus: row.transfer_status, disputeStatus: row.dispute_status,
    })
    const paidAt = row.paid_at as unknown
    return [
      row.id, paidAt instanceof Date ? paidAt.toISOString() : String(paidAt), row.provider_name, row.artist_name, row.release_title, row.song_title ?? null, row.currency,
      dollars(Number(row.gross_amount_minor)), dollars(commission), dollars(Number(row.platform_fee_minor) - commission), dollars(Number(row.provider_proceeds_minor)),
      dollars(amounts.earningsMinor), dollars(row.stripe_fee_minor === null || row.stripe_fee_minor === undefined ? null : Number(row.stripe_fee_minor)),
      dollars(Number(row.refunded_amount_minor)), row.payment_status, row.transfer_status, row.dispute_status, row.livemode,
    ].map(csvCell).join(',')
  })
  return `${[header.join(','), ...lines].join('\n')}\n`
}

export type FinanceOrderDetail = {
  order: Record<string, unknown> & {id: string; platform_commission_minor: number; processing_fees_recovered_minor: number; artist_earnings_minor: number}
  items: Array<Record<string, unknown>>
  splits: Array<Record<string, unknown>>
  entitlements: Array<Record<string, unknown>>
  ledger: Array<Record<string, unknown>>
  emails: Array<Record<string, unknown>>
}

/** Read-only marketplace finance reporting for marketplace admins. Never mutates financial rows. */
export class MarketplaceFinanceService {
  constructor(private readonly database: Database) {}

  private async requireAdmin(userId: string): Promise<void> {
    const staff = await this.database.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1')
      .bind(userId).first<{role: string}>()
    if (staff?.role !== 'admin') throw new MarketplaceError(403, 'marketplace_admin_required', 'Marketplace admin access is required')
  }

  private async loadOrders(filters: FinanceFilters): Promise<{rows: FinanceOrderRow[]; fromAt: string | null; toExclusive: string | null}> {
    const fromAt = filters.from ? `${filters.from}T00:00:00.000Z` : null
    const toExclusive = filters.to ? new Date(Date.parse(`${filters.to}T00:00:00Z`) + 86_400_000).toISOString() : null
    const {results} = await this.database.prepare(
      `WITH filtered AS (
         SELECT purchase_order.id, purchase_order.paid_at, purchase_order.provider_profile_id,
           provider.display_name AS provider_name, item.release_id, item.release_title, item.artist_name,
           item.catalog_snapshot->>'track_title' AS song_title,
           purchase_order.currency, purchase_order.gross_amount_minor, purchase_order.platform_fee_minor,
           purchase_order.provider_proceeds_minor, purchase_order.stripe_fee_minor,
           purchase_order.refunded_amount_minor,
           COALESCE(purchase_order.platform_fee_bps, attempt.platform_fee_bps) AS platform_fee_bps,
           purchase_order.payment_status, purchase_order.transfer_status, purchase_order.dispute_status,
           purchase_order.livemode
         FROM marketplace_orders purchase_order
         JOIN marketplace_order_items item ON item.order_id = purchase_order.id
         LEFT JOIN provider_profiles provider ON provider.id = purchase_order.provider_profile_id
         LEFT JOIN marketplace_checkout_attempts attempt ON attempt.id = purchase_order.checkout_attempt_id
         WHERE (?1::timestamptz IS NULL OR purchase_order.paid_at >= ?1::timestamptz)
           AND (?2::timestamptz IS NULL OR purchase_order.paid_at < ?2::timestamptz)
           AND (?3 = '' OR purchase_order.provider_profile_id = ?3)
           AND (?4 = '' OR item.release_id = ?4)
           AND (?5 = '' OR purchase_order.payment_status = ?5)
       ), platform_revenue AS (
         SELECT ledger.order_id, SUM(entry.credit_minor - entry.debit_minor)::integer AS net_minor
         FROM marketplace_ledger_transactions ledger
         JOIN marketplace_ledger_entries entry ON entry.transaction_id = ledger.id
         WHERE entry.account_code = 'platform_revenue' AND ledger.order_id IN (SELECT id FROM filtered)
         GROUP BY ledger.order_id
       )
       SELECT filtered.*, COALESCE(platform_revenue.net_minor, 0) AS platform_revenue_net_minor
       FROM filtered LEFT JOIN platform_revenue ON platform_revenue.order_id = filtered.id
       ORDER BY filtered.paid_at DESC, filtered.id`,
    ).bind(fromAt, toExclusive, filters.providerId ?? '', filters.releaseId ?? '', filters.paymentStatus ?? '')
      .all<FinanceOrderRow>()
    return {rows: results, fromAt, toExclusive}
  }

  async getSummary(userId: string, filters: FinanceFilters): Promise<FinanceSummary> {
    await this.requireAdmin(userId)
    const {rows: results, fromAt, toExclusive} = await this.loadOrders(filters)
    const failed = await this.database.prepare(
      `SELECT COUNT(*)::integer AS count FROM marketplace_checkout_attempts
       WHERE status = 'payment_failed'
         AND (?1::timestamptz IS NULL OR created_at >= ?1::timestamptz)
         AND (?2::timestamptz IS NULL OR created_at < ?2::timestamptz)
         AND (?3 = '' OR provider_profile_id = ?3)
         AND (?4 = '' OR release_id = ?4)`,
    ).bind(fromAt, toExclusive, filters.providerId ?? '', filters.releaseId ?? '').first<{count: number}>()

    // A payment-status filter selects orders; failed payments never become orders.
    const failedPayments = filters.paymentStatus ? 0 : Number(failed?.count ?? 0)
    return buildFinanceSummary(filters, results, failedPayments)
  }

  /** Every matching order as CSV (the page lists only the latest 500). */
  async exportCsv(userId: string, filters: FinanceFilters): Promise<{data: string; fileName: string}> {
    await this.requireAdmin(userId)
    const {rows} = await this.loadOrders(filters)
    const range = [filters.from, filters.to].filter(Boolean).join('-to-') || new Date().toISOString().slice(0, 10)
    return {data: buildFinanceCsv(rows), fileName: `mejay-sales-${range}.csv`}
  }

  /** Everything recorded about one order, for the admin order panel. Read-only. */
  async getOrderDetail(userId: string, orderId: string): Promise<FinanceOrderDetail> {
    await this.requireAdmin(userId)
    const order = await this.database.prepare(
      `SELECT purchase_order.id, purchase_order.created_at, purchase_order.paid_at, purchase_order.purchase_type,
         purchase_order.buyer_user_id, purchase_order.buyer_email, buyer.email AS buyer_account_email, purchase_order.buyer_country_code,
         COALESCE(attempt.guest_checkout, purchase_order.buyer_user_id IS NULL) AS guest_checkout,
         purchase_order.provider_profile_id, provider.display_name AS provider_name,
         purchase_order.currency, purchase_order.gross_amount_minor, purchase_order.platform_fee_minor, purchase_order.provider_proceeds_minor,
         COALESCE(purchase_order.platform_fee_bps, attempt.platform_fee_bps) AS platform_fee_bps,
         purchase_order.stripe_fee_minor, purchase_order.refunded_amount_minor, purchase_order.transfer_reversed_minor,
         purchase_order.payment_status, purchase_order.transfer_status, purchase_order.dispute_status, purchase_order.livemode,
         purchase_order.stripe_checkout_session_id, purchase_order.stripe_payment_intent_id, purchase_order.stripe_charge_id,
         purchase_order.stripe_transfer_id, purchase_order.stripe_transfer_reversal_id, purchase_order.stripe_destination_account_id
       FROM marketplace_orders purchase_order
       LEFT JOIN marketplace_checkout_attempts attempt ON attempt.id = purchase_order.checkout_attempt_id
       LEFT JOIN provider_profiles provider ON provider.id = purchase_order.provider_profile_id
       LEFT JOIN users buyer ON buyer.id = purchase_order.buyer_user_id
       WHERE purchase_order.id = ?1`,
    ).bind(orderId).first<FinanceOrderRow & Record<string, unknown>>()
    if (!order) throw new MarketplaceError(404, 'order_not_found', 'Order was not found')
    const commission = commissionFor(order)
    const amounts = reportingOrderAmounts({
      grossAmountMinor: Number(order.gross_amount_minor), platformFeeMinor: Number(order.platform_fee_minor), providerProceedsMinor: Number(order.provider_proceeds_minor),
      refundedAmountMinor: Number(order.refunded_amount_minor), transferStatus: order.transfer_status, disputeStatus: order.dispute_status,
    })
    const [items, splits, entitlements, ledger, emails] = await Promise.all([
      this.database.prepare(
        `SELECT id, product_name, release_id, release_title, artist_name, unit_amount_minor, currency,
           catalog_snapshot->>'track_title' AS song_title
         FROM marketplace_order_items WHERE order_id = ?1 ORDER BY created_at, id`,
      ).bind(orderId).all(),
      this.database.prepare(
        `SELECT track_title, payee_name, payee_role, share_bps, amount_minor
         FROM marketplace_split_allocations WHERE order_id = ?1 ORDER BY track_title, payee_name`,
      ).bind(orderId).all(),
      this.database.prepare(
        `SELECT entitlement.id, entitlement.status, entitlement.delivery_status, entitlement.delivery_available_at, entitlement.granted_at,
           (SELECT COUNT(*)::integer FROM download_entitlement_files file WHERE file.entitlement_id = entitlement.id) AS file_count,
           (SELECT COUNT(*)::integer FROM marketplace_download_events download WHERE download.entitlement_id = entitlement.id) AS download_count,
           (SELECT MAX(download.downloaded_at) FROM marketplace_download_events download WHERE download.entitlement_id = entitlement.id) AS last_downloaded_at
         FROM download_entitlements entitlement WHERE entitlement.order_id = ?1 ORDER BY entitlement.granted_at`,
      ).bind(orderId).all(),
      this.database.prepare(
        `SELECT ledger.id, ledger.transaction_type, ledger.stripe_reference_id, ledger.occurred_at,
           COALESCE(json_agg(json_build_object('account', entry.account_code, 'debitMinor', entry.debit_minor, 'creditMinor', entry.credit_minor)
             ORDER BY entry.created_at, entry.id) FILTER (WHERE entry.id IS NOT NULL), '[]'::json) AS entries
         FROM marketplace_ledger_transactions ledger
         LEFT JOIN marketplace_ledger_entries entry ON entry.transaction_id = ledger.id
         WHERE ledger.order_id = ?1 GROUP BY ledger.id ORDER BY ledger.occurred_at, ledger.id`,
      ).bind(orderId).all(),
      this.database.prepare(
        `SELECT kind, status, attempts, sent_at, created_at FROM marketplace_email_jobs WHERE order_id = ?1
         UNION ALL
         SELECT kind, status, attempts, sent_at, created_at FROM marketplace_order_notifications WHERE order_id = ?1
         ORDER BY created_at`,
      ).bind(orderId).all(),
    ])
    return {
      order: {...order, platform_commission_minor: commission, processing_fees_recovered_minor: Number(order.platform_fee_minor) - commission, artist_earnings_minor: amounts.earningsMinor},
      items: items.results, splits: splits.results, entitlements: entitlements.results, ledger: ledger.results, emails: emails.results,
    }
  }
}
