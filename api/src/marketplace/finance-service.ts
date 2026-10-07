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
  transactions: Array<{
    orderId: string
    paidAt: string
    providerName: string | null
    releaseTitle: string
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
    if (transactions.length < TRANSACTION_LIMIT) {
      transactions.push({
        orderId: row.id,
        paidAt: row.paid_at,
        providerName: row.provider_name,
        releaseTitle: row.release_title,
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
  return {currency: 'USD', filters, totals, transactions}
}

/** Read-only marketplace finance reporting for marketplace admins. Never mutates financial rows. */
export class MarketplaceFinanceService {
  constructor(private readonly database: Database) {}

  async getSummary(userId: string, filters: FinanceFilters): Promise<FinanceSummary> {
    const staff = await this.database.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1')
      .bind(userId).first<{role: string}>()
    if (staff?.role !== 'admin') throw new MarketplaceError(403, 'marketplace_admin_required', 'Marketplace admin access is required')

    const fromAt = filters.from ? `${filters.from}T00:00:00.000Z` : null
    const toExclusive = filters.to ? new Date(Date.parse(`${filters.to}T00:00:00Z`) + 86_400_000).toISOString() : null
    const {results} = await this.database.prepare(
      `WITH filtered AS (
         SELECT purchase_order.id, purchase_order.paid_at, purchase_order.provider_profile_id,
           provider.display_name AS provider_name, item.release_id, item.release_title, item.artist_name,
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
}
