import {allocateProviderProceeds, calculateSaleAmounts, saleLedgerEntries, type TrackSplitInput} from './commerce-money'
import {MarketplaceError} from './service'
import {stripeRequest} from '../services/stripe'

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

type ProductRow = {
  product_id: string
  product_name: string
  price_id: string
  amount_minor: number
  currency: string
  release_id: string
  release_title: string
  release_type: string
  artist_name: string
  artwork_asset_id: string | null
  provider_profile_id: string
  stripe_account_id: string | null
  purchase_ready: boolean
}

type TrackRow = {
  track_id: string
  track_title: string
  disc_number: number
  track_number: number
  asset_id: string
  storage_key: string
  mime_type: string
  byte_size: number
  file_name: string | null
  split_entry_id: string
  payee_name: string
  payee_email: string | null
  payee_role: string | null
  share_bps: number
}

type CheckoutSnapshot = {
  product: ProductRow
  tracks: Array<{
    id: string
    title: string
    discNumber: number
    trackNumber: number
    asset: {id: string; storageKey: string; mimeType: string; byteSize: number; fileName: string}
    splits: Array<{id: string; payeeName: string; payeeEmail: string | null; role: string | null; shareBps: number}>
  }>
}

type AttemptRow = {
  id: string
  buyer_user_id: string | null
  provider_profile_id: string | null
  product_id: string | null
  release_id: string | null
  price_id: string | null
  amount_minor: number
  currency: string
  platform_fee_bps: number
  stripe_checkout_session_id: string | null
  transfer_group: string
  status: string
  snapshot: CheckoutSnapshot
}

type StripeCheckoutSession = {
  id: string
  payment_status?: string
  payment_intent?: string | {id?: string}
  amount_total?: number
  currency?: string
  customer_details?: {email?: string | null}
  customer_email?: string | null
  metadata?: Record<string, string | undefined>
}

type StripePaymentIntent = {
  id: string
  status?: string
  latest_charge?: string | {
    id?: string
    balance_transaction?: string | {id?: string; fee?: number}
    billing_details?: {address?: {country?: string | null} | null}
    payment_method_details?: {card?: {country?: string | null} | null}
  }
}

type OrderRow = {
  id: string
  provider_profile_id: string | null
  provider_proceeds_minor: number
  currency: string
  stripe_charge_id: string | null
  stripe_transfer_id: string | null
  transfer_status: string
  gross_amount_minor?: number
  platform_fee_minor?: number
  refunded_amount_minor?: number
  payment_status?: string
  dispute_status?: string
}

function extensionForMime(mimeType: string): string {
  return mimeType.includes('flac') ? 'flac' : 'wav'
}

function safeFileName(value: string, fallback: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim()
  return cleaned || fallback
}

function parseSnapshot(value: CheckoutSnapshot | string): CheckoutSnapshot {
  return typeof value === 'string' ? JSON.parse(value) as CheckoutSnapshot : value
}

function paymentIntentId(session: StripeCheckoutSession): string | null {
  if (typeof session.payment_intent === 'string') return session.payment_intent
  return typeof session.payment_intent?.id === 'string' ? session.payment_intent.id : null
}

export function paymentCountry(intent: StripePaymentIntent): string | null {
  if (!intent.latest_charge || typeof intent.latest_charge === 'string') return null
  const normalize = (value?: string | null) => {
    const normalized = value?.trim().toUpperCase() ?? ''
    return /^[A-Z]{2}$/.test(normalized) ? normalized : null
  }
  return normalize(intent.latest_charge.billing_details?.address?.country)
    ?? normalize(intent.latest_charge.payment_method_details?.card?.country)
}

function chargeDetails(intent: StripePaymentIntent): {chargeId: string | null; balanceTransactionId: string | null; stripeFeeMinor: number | null} {
  if (typeof intent.latest_charge === 'string') return {chargeId: intent.latest_charge, balanceTransactionId: null, stripeFeeMinor: null}
  const chargeId = typeof intent.latest_charge?.id === 'string' ? intent.latest_charge.id : null
  if (typeof intent.latest_charge?.balance_transaction === 'string') {
    return {chargeId, balanceTransactionId: intent.latest_charge.balance_transaction, stripeFeeMinor: null}
  }
  return {
    chargeId,
    balanceTransactionId: intent.latest_charge?.balance_transaction?.id ?? null,
    stripeFeeMinor: Number.isSafeInteger(intent.latest_charge?.balance_transaction?.fee)
      ? intent.latest_charge!.balance_transaction!.fee!
      : null,
  }
}

export class CommerceService {
  constructor(
    private readonly database: Database,
    private readonly secretKey: string,
    private readonly platformFeeBps = 1000,
  ) {}

  async createCheckout(userId: string, productId: string, frontendOrigin: string): Promise<{url: string; sessionId: string}> {
    const existing = await this.database.prepare(
      `SELECT entitlement.id FROM download_entitlements entitlement
       JOIN marketplace_order_items item ON item.id = entitlement.order_item_id
       WHERE entitlement.buyer_user_id = ?1 AND item.product_id = ?2 AND entitlement.status <> 'revoked' LIMIT 1`,
    ).bind(userId, productId).first()
    if (existing) throw new MarketplaceError(409, 'already_owned', 'This release is already in Purchased Music')

    const product = await this.database.prepare(
      `SELECT product.id AS product_id, product.name AS product_name, price.id AS price_id,
        price.amount_minor, price.currency, release.id AS release_id, release.title AS release_title,
        release.release_type, artist.name AS artist_name, artwork.id AS artwork_asset_id,
        release.provider_profile_id, provider.stripe_account_id,
        (provider.stripe_details_submitted AND provider.stripe_payouts_enabled
          AND provider.stripe_transfers_status = 'active') AS purchase_ready
       FROM products product
       JOIN releases release ON release.id = product.release_id AND release.status = 'LIVE'
       JOIN provider_profiles provider ON provider.id = release.provider_profile_id
       JOIN release_artists credit ON credit.release_id = release.id AND credit.is_primary = TRUE
       JOIN artists artist ON artist.id = credit.artist_id
       JOIN LATERAL (
         SELECT current_price.id, current_price.amount_minor, current_price.currency
         FROM prices current_price WHERE current_price.product_id = product.id AND current_price.active = TRUE
           AND current_price.effective_from <= CURRENT_TIMESTAMP
           AND (current_price.effective_until IS NULL OR current_price.effective_until > CURRENT_TIMESTAMP)
         ORDER BY current_price.effective_from DESC LIMIT 1
       ) price ON TRUE
       LEFT JOIN LATERAL (
         SELECT asset.id FROM marketplace_assets asset WHERE asset.release_id = release.id
           AND asset.kind = 'artwork' AND asset.processing_status = 'ready'
         ORDER BY asset.created_at DESC LIMIT 1
       ) artwork ON TRUE
       WHERE product.id = ?1 AND product.active = TRUE LIMIT 1`,
    ).bind(productId).first<ProductRow>()
    if (!product) throw new MarketplaceError(404, 'product_not_found', 'This product is not available')
    if (!product.purchase_ready || !product.stripe_account_id) {
      throw new MarketplaceError(409, 'provider_payout_not_ready', 'This provider is still completing Stripe payout setup')
    }
    if (product.currency !== 'USD') throw new MarketplaceError(422, 'currency_not_supported', 'Only USD marketplace checkout is available')

    const {results: trackRows} = await this.database.prepare(
      `SELECT track.id AS track_id, track.title AS track_title, track.disc_number, track.track_number,
        asset.id AS asset_id, asset.storage_key, asset.mime_type, asset.byte_size,
        asset.metadata->>'fileName' AS file_name,
        entry.id AS split_entry_id, entry.payee_name, entry.payee_email, entry.role AS payee_role, entry.share_bps
       FROM tracks track
       JOIN LATERAL (
         SELECT source.id, source.storage_key, source.mime_type, source.byte_size, source.metadata
         FROM marketplace_assets source WHERE source.track_id = track.id AND source.kind = 'audio'
           AND source.processing_status = 'ready' ORDER BY source.created_at DESC LIMIT 1
       ) asset ON TRUE
       JOIN revenue_split_sets split_set ON split_set.track_id = track.id AND split_set.active = TRUE
       JOIN revenue_split_entries entry ON entry.split_set_id = split_set.id
       WHERE track.release_id = ?1
       ORDER BY track.disc_number, track.track_number, entry.created_at, entry.id`,
    ).bind(product.release_id).all<TrackRow>()
    const tracksById = new Map<string, CheckoutSnapshot['tracks'][number]>()
    for (const row of trackRows) {
      let track = tracksById.get(row.track_id)
      if (!track) {
        const fallback = `${String(row.track_number).padStart(2, '0')} - ${row.track_title}.${extensionForMime(row.mime_type)}`
        track = {
          id: row.track_id,
          title: row.track_title,
          discNumber: row.disc_number,
          trackNumber: row.track_number,
          asset: {
            id: row.asset_id,
            storageKey: row.storage_key,
            mimeType: row.mime_type,
            byteSize: Number(row.byte_size),
            fileName: safeFileName(row.file_name ?? fallback, fallback),
          },
          splits: [],
        }
        tracksById.set(row.track_id, track)
      }
      track.splits.push({
        id: row.split_entry_id,
        payeeName: row.payee_name,
        payeeEmail: row.payee_email,
        role: row.payee_role,
        shareBps: row.share_bps,
      })
    }
    const tracks = [...tracksById.values()]
    if (tracks.length === 0) throw new MarketplaceError(422, 'download_files_missing', 'This release has no downloadable tracks')
    for (const track of tracks) {
      if (track.splits.reduce((sum, split) => sum + split.shareBps, 0) !== 10000) {
        throw new MarketplaceError(422, 'splits_incomplete', `Revenue splits are incomplete for ${track.title}`)
      }
    }
    const user = await this.database.prepare('SELECT email FROM users WHERE id = ?1').bind(userId).first<{email: string}>()
    if (!user) throw new MarketplaceError(401, 'unauthorized', 'Account session is no longer valid')

    const attemptId = crypto.randomUUID()
    const idempotencyKey = `marketplace-checkout-${attemptId}`
    const transferGroup = `MEJAY_ORDER_${attemptId.replace(/-/g, '')}`
    const snapshot: CheckoutSnapshot = {product, tracks}
    await this.database.prepare(
      `INSERT INTO marketplace_checkout_attempts
        (id, buyer_user_id, provider_profile_id, product_id, release_id, price_id, amount_minor, currency,
          platform_fee_bps, stripe_idempotency_key, transfer_group, snapshot, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
    ).bind(
      attemptId, userId, product.provider_profile_id, product.product_id, product.release_id, product.price_id,
      product.amount_minor, product.currency, this.platformFeeBps, idempotencyKey, transferGroup, JSON.stringify(snapshot),
    ).run()

    const params = new URLSearchParams()
    params.set('mode', 'payment')
    params.set('line_items[0][price_data][currency]', product.currency.toLowerCase())
    params.set('line_items[0][price_data][unit_amount]', String(product.amount_minor))
    params.set('line_items[0][price_data][product_data][name]', product.release_title)
    params.set('line_items[0][price_data][product_data][description]', `${product.artist_name} - ${product.release_type}`)
    params.set('line_items[0][quantity]', '1')
    params.set('customer_creation', 'always')
    params.set('customer_email', user.email)
    params.set('client_reference_id', userId)
    params.set('metadata[kind]', 'marketplace_purchase')
    params.set('metadata[attemptId]', attemptId)
    params.set('metadata[userId]', userId)
    params.set('metadata[productId]', product.product_id)
    params.set('payment_intent_data[transfer_group]', transferGroup)
    params.set('success_url', `${frontendOrigin}/app/purchased?checkout=success&session_id={CHECKOUT_SESSION_ID}`)
    params.set('cancel_url', `${frontendOrigin}/app/store/${encodeURIComponent(product.release_id)}?checkout=cancel`)
    try {
      const session = await stripeRequest<{id?: string; url?: string}>({
        secretKey: this.secretKey,
        method: 'POST',
        path: '/v1/checkout/sessions',
        params,
        idempotencyKey,
      })
      if (!session.id || !session.url) throw new MarketplaceError(502, 'stripe_invalid_response', 'Stripe did not return a Checkout Session')
      await this.database.prepare(
        `UPDATE marketplace_checkout_attempts SET stripe_checkout_session_id = ?1, status = 'checkout_created',
          updated_at = CURRENT_TIMESTAMP WHERE id = ?2`,
      ).bind(session.id, attemptId).run()
      return {url: session.url, sessionId: session.id}
    } catch (error) {
      await this.database.prepare(
        `UPDATE marketplace_checkout_attempts SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
      ).bind(attemptId).run()
      throw error
    }
  }

  async fulfillPaidSession(session: StripeCheckoutSession): Promise<{orderId: string}> {
    if (session.payment_status !== 'paid') throw new MarketplaceError(409, 'payment_not_paid', 'Checkout payment is not complete')
    const attemptId = session.metadata?.attemptId
    const userId = session.metadata?.userId
    const productId = session.metadata?.productId
    if (!attemptId || !userId || !productId || session.metadata?.kind !== 'marketplace_purchase') {
      throw new MarketplaceError(400, 'checkout_metadata_invalid', 'Marketplace Checkout metadata is incomplete')
    }
    const intentId = paymentIntentId(session)
    if (!intentId) throw new MarketplaceError(409, 'payment_intent_missing', 'Checkout payment intent is missing')
    const intent = await stripeRequest<StripePaymentIntent>({
      secretKey: this.secretKey,
      path: `/v1/payment_intents/${encodeURIComponent(intentId)}`,
      params: new URLSearchParams({'expand[]': 'latest_charge.balance_transaction'}),
    })
    if (intent.status !== 'succeeded') throw new MarketplaceError(409, 'payment_not_succeeded', 'Stripe payment did not succeed')
    const charge = chargeDetails(intent)
    if (!charge.chargeId) throw new MarketplaceError(409, 'charge_missing', 'Stripe charge is unavailable')

    const order = await this.database.transaction(async (db) => {
      const existing = await db.prepare(
        'SELECT * FROM marketplace_orders WHERE stripe_checkout_session_id = ?1 FOR UPDATE',
      ).bind(session.id).first<OrderRow>()
      if (existing) return existing
      const attempt = await db.prepare(
        'SELECT * FROM marketplace_checkout_attempts WHERE id = ?1 FOR UPDATE',
      ).bind(attemptId).first<AttemptRow>()
      if (!attempt || attempt.stripe_checkout_session_id !== session.id) {
        throw new MarketplaceError(409, 'checkout_attempt_mismatch', 'Checkout attempt does not match the Stripe Session')
      }
      if (attempt.buyer_user_id !== userId || attempt.product_id !== productId) {
        throw new MarketplaceError(409, 'checkout_identity_mismatch', 'Checkout ownership metadata does not match')
      }
      if (session.amount_total !== attempt.amount_minor || session.currency?.toUpperCase() !== attempt.currency) {
        throw new MarketplaceError(409, 'checkout_amount_mismatch', 'Stripe amount does not match the authoritative checkout snapshot')
      }
      const snapshot = parseSnapshot(attempt.snapshot)
      const amounts = calculateSaleAmounts(attempt.amount_minor, attempt.platform_fee_bps)
      const orderId = crypto.randomUUID()
      const paidAt = new Date().toISOString()
      const insertedOrder = await db.prepare(
        `INSERT INTO marketplace_orders
          (id, buyer_user_id, provider_profile_id, checkout_attempt_id, buyer_email, buyer_country_code, currency,
            gross_amount_minor, platform_fee_minor, provider_proceeds_minor, stripe_fee_minor,
            stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id, stripe_balance_transaction_id,
            payment_status, paid_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'paid', ?16)
         RETURNING *`,
      ).bind(
        orderId, userId, attempt.provider_profile_id, attempt.id,
        session.customer_details?.email ?? session.customer_email ?? null,
        paymentCountry(intent),
        attempt.currency, amounts.grossAmountMinor, amounts.platformFeeMinor, amounts.providerProceedsMinor,
        charge.stripeFeeMinor, session.id, intentId, charge.chargeId, charge.balanceTransactionId, paidAt,
      ).first<OrderRow>()
      if (!insertedOrder) throw new Error('Order insert failed')

      const itemId = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO marketplace_order_items
          (id, order_id, product_id, release_id, product_name, release_title, artist_name,
            artwork_asset_id, unit_amount_minor, currency, catalog_snapshot)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      ).bind(
        itemId, orderId, snapshot.product.product_id, snapshot.product.release_id, snapshot.product.product_name,
        snapshot.product.release_title, snapshot.product.artist_name, snapshot.product.artwork_asset_id,
        attempt.amount_minor, attempt.currency, JSON.stringify(snapshot.product),
      ).run()

      const allocations = allocateProviderProceeds(amounts.providerProceedsMinor, snapshot.tracks.map((track): TrackSplitInput => ({
        id: track.id, title: track.title, splits: track.splits,
      })))
      for (const allocation of allocations) {
        await db.prepare(
          `INSERT INTO marketplace_split_allocations
            (id, order_id, order_item_id, track_id, split_entry_id, track_title, payee_name,
              payee_email, payee_role, share_bps, amount_minor, currency)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        ).bind(
          crypto.randomUUID(), orderId, itemId, allocation.trackId, allocation.id, allocation.trackTitle,
          allocation.payeeName, allocation.payeeEmail ?? null, allocation.role ?? null,
          allocation.shareBps, allocation.amountMinor, attempt.currency,
        ).run()
      }

      const ledgerTransactionId = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO marketplace_ledger_transactions
          (id, order_id, transaction_type, currency, stripe_reference_id, idempotency_key)
         VALUES (?1, ?2, 'sale', ?3, ?4, ?5)`,
      ).bind(ledgerTransactionId, orderId, attempt.currency, intentId, `sale-${session.id}`).run()
      for (const entry of saleLedgerEntries(amounts)) {
        await db.prepare(
          `INSERT INTO marketplace_ledger_entries (id, transaction_id, account_code, debit_minor, credit_minor)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        ).bind(crypto.randomUUID(), ledgerTransactionId, entry.accountCode, entry.debitMinor, entry.creditMinor).run()
      }

      const entitlementId = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO download_entitlements (id, buyer_user_id, order_id, order_item_id, product_id)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(entitlementId, userId, orderId, itemId, snapshot.product.product_id).run()
      for (const track of snapshot.tracks) {
        await db.prepare(
          `INSERT INTO download_entitlement_files
            (id, entitlement_id, track_id, source_asset_id, track_title, storage_key, file_name,
              mime_type, byte_size, disc_number, track_number)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        ).bind(
          crypto.randomUUID(), entitlementId, track.id, track.asset.id, track.title, track.asset.storageKey,
          track.asset.fileName, track.asset.mimeType, track.asset.byteSize, track.discNumber, track.trackNumber,
        ).run()
      }
      await db.prepare(
        `UPDATE marketplace_checkout_attempts SET status = 'paid', stripe_payment_intent_id = ?1,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?2`,
      ).bind(intentId, attempt.id).run()
      return insertedOrder
    })

    await this.ensureProviderTransfer(order)
    return {orderId: order.id}
  }

  private async ensureProviderTransfer(order: OrderRow): Promise<void> {
    if (order.stripe_transfer_id && order.transfer_status === 'transferred') return
    if (!order.provider_profile_id || !order.stripe_charge_id) throw new Error('Order transfer destination is incomplete')
    const provider = await this.database.prepare(
      `SELECT stripe_account_id FROM provider_profiles WHERE id = ?1`,
    ).bind(order.provider_profile_id).first<{stripe_account_id: string | null}>()
    if (!provider?.stripe_account_id) throw new Error('Provider Stripe account is unavailable')
    const params = new URLSearchParams()
    params.set('amount', String(order.provider_proceeds_minor))
    params.set('currency', order.currency.toLowerCase())
    params.set('destination', provider.stripe_account_id)
    params.set('source_transaction', order.stripe_charge_id)
    params.set('metadata[orderId]', order.id)
    const transfer = await stripeRequest<{id?: string}>({
      secretKey: this.secretKey,
      method: 'POST',
      path: '/v1/transfers',
      params,
      idempotencyKey: `marketplace-transfer-${order.id}`,
    })
    if (!transfer.id) throw new Error('Stripe did not return a transfer ID')
    await this.database.transaction(async (db) => {
      const current = await db.prepare('SELECT * FROM marketplace_orders WHERE id = ?1 FOR UPDATE').bind(order.id).first<OrderRow>()
      if (!current || current.transfer_status === 'transferred') return
      const transactionId = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO marketplace_ledger_transactions
          (id, order_id, transaction_type, currency, stripe_reference_id, idempotency_key)
         VALUES (?1, ?2, 'provider_transfer', ?3, ?4, ?5) ON CONFLICT (idempotency_key) DO NOTHING`,
      ).bind(transactionId, order.id, order.currency, transfer.id, `provider-transfer-${order.id}`).run()
      const posted = await db.prepare(
        'SELECT id FROM marketplace_ledger_transactions WHERE idempotency_key = ?1',
      ).bind(`provider-transfer-${order.id}`).first<{id: string}>()
      if (!posted) throw new Error('Provider transfer ledger transaction was not persisted')
      const hasEntries = await db.prepare(
        'SELECT id FROM marketplace_ledger_entries WHERE transaction_id = ?1 LIMIT 1',
      ).bind(posted.id).first()
      if (!hasEntries) {
        await db.prepare(
          `INSERT INTO marketplace_ledger_entries (id, transaction_id, account_code, debit_minor, credit_minor)
           VALUES (?1, ?2, 'provider_payable', ?3, 0), (?4, ?2, 'stripe_clearing', 0, ?3)`,
        ).bind(crypto.randomUUID(), posted.id, order.provider_proceeds_minor, crypto.randomUUID()).run()
      }
      await db.prepare(
        `UPDATE marketplace_orders SET stripe_transfer_id = ?1, transfer_status = 'transferred',
          updated_at = CURRENT_TIMESTAMP WHERE id = ?2`,
      ).bind(transfer.id, order.id).run()
    })
  }

  async handleRefund(charge: {id?: string; amount?: number; amount_refunded?: number}): Promise<void> {
    if (!charge.id || !Number.isSafeInteger(charge.amount_refunded)) return
    const order = await this.database.prepare(
      `SELECT * FROM marketplace_orders WHERE stripe_charge_id = ?1`,
    ).bind(charge.id).first<OrderRow>()
    if (!order?.gross_amount_minor) return
    const refundedAmount = Math.min(charge.amount_refunded ?? 0, order.gross_amount_minor)
    const fullRefund = refundedAmount >= order.gross_amount_minor
    if (fullRefund && order.stripe_transfer_id && order.transfer_status === 'transferred') {
      const params = new URLSearchParams()
      params.set('amount', String(order.provider_proceeds_minor))
      params.set('metadata[orderId]', order.id)
      const reversal = await stripeRequest<{id?: string}>({
        secretKey: this.secretKey,
        method: 'POST',
        path: `/v1/transfers/${encodeURIComponent(order.stripe_transfer_id)}/reversals`,
        params,
        idempotencyKey: `marketplace-transfer-reversal-${order.id}`,
      })
      if (!reversal.id) throw new Error('Stripe did not return a transfer reversal ID')
      await this.postTransferReversal(order, reversal.id)
    }

    await this.database.transaction(async (db) => {
      const current = await db.prepare('SELECT * FROM marketplace_orders WHERE id = ?1 FOR UPDATE').bind(order.id).first<OrderRow>()
      if (!current || (current.refunded_amount_minor ?? 0) >= refundedAmount) return
      const refundIdempotencyKey = `refund-${order.id}-${refundedAmount}`
      const transactionId = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO marketplace_ledger_transactions
          (id, order_id, transaction_type, currency, stripe_reference_id, idempotency_key)
         VALUES (?1, ?2, 'refund', ?3, ?4, ?5) ON CONFLICT (idempotency_key) DO NOTHING`,
      ).bind(transactionId, order.id, order.currency, charge.id, refundIdempotencyKey).run()
      const transaction = await db.prepare(
        'SELECT id FROM marketplace_ledger_transactions WHERE idempotency_key = ?1',
      ).bind(refundIdempotencyKey).first<{id: string}>()
      if (!transaction) throw new Error('Refund ledger transaction was not persisted')
      const hasEntries = await db.prepare(
        'SELECT id FROM marketplace_ledger_entries WHERE transaction_id = ?1 LIMIT 1',
      ).bind(transaction.id).first()
      if (!hasEntries) {
        const platformRefund = fullRefund
          ? current.platform_fee_minor ?? 0
          : Math.floor(refundedAmount * (current.platform_fee_minor ?? 0) / order.gross_amount_minor!)
        const providerRefund = refundedAmount - platformRefund
        const entries = [
          {account: 'platform_revenue', debit: platformRefund, credit: 0},
          {account: 'provider_payable', debit: providerRefund, credit: 0},
          {account: 'stripe_clearing', debit: 0, credit: refundedAmount},
        ].filter((entry) => entry.debit > 0 || entry.credit > 0)
        for (const entry of entries) {
          await db.prepare(
            `INSERT INTO marketplace_ledger_entries (id, transaction_id, account_code, debit_minor, credit_minor)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
          ).bind(crypto.randomUUID(), transaction.id, entry.account, entry.debit, entry.credit).run()
        }
      }
      await db.prepare(
        `UPDATE marketplace_orders SET refunded_amount_minor = ?1,
          payment_status = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3`,
      ).bind(refundedAmount, fullRefund ? 'refunded' : 'partially_refunded', order.id).run()
      if (fullRefund) {
        await db.prepare(
          `UPDATE download_entitlements SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP,
            suspended_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?1`,
        ).bind(order.id).run()
      }
    })
  }

  private async postTransferReversal(order: OrderRow, reversalId: string): Promise<void> {
    await this.database.transaction(async (db) => {
      const current = await db.prepare('SELECT * FROM marketplace_orders WHERE id = ?1 FOR UPDATE').bind(order.id).first<OrderRow>()
      if (!current || current.transfer_status === 'reversed') return
      const key = `transfer-reversal-${order.id}`
      const transactionId = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO marketplace_ledger_transactions
          (id, order_id, transaction_type, currency, stripe_reference_id, idempotency_key)
         VALUES (?1, ?2, 'transfer_reversal', ?3, ?4, ?5) ON CONFLICT (idempotency_key) DO NOTHING`,
      ).bind(transactionId, order.id, order.currency, reversalId, key).run()
      const transaction = await db.prepare(
        'SELECT id FROM marketplace_ledger_transactions WHERE idempotency_key = ?1',
      ).bind(key).first<{id: string}>()
      if (!transaction) throw new Error('Transfer reversal ledger transaction was not persisted')
      const hasEntries = await db.prepare(
        'SELECT id FROM marketplace_ledger_entries WHERE transaction_id = ?1 LIMIT 1',
      ).bind(transaction.id).first()
      if (!hasEntries) {
        await db.prepare(
          `INSERT INTO marketplace_ledger_entries (id, transaction_id, account_code, debit_minor, credit_minor)
           VALUES (?1, ?2, 'stripe_clearing', ?3, 0), (?4, ?2, 'provider_payable', 0, ?3)`,
        ).bind(crypto.randomUUID(), transaction.id, order.provider_proceeds_minor, crypto.randomUUID()).run()
      }
      await db.prepare(
        `UPDATE marketplace_orders SET stripe_transfer_reversal_id = ?1, transfer_status = 'reversed',
          updated_at = CURRENT_TIMESTAMP WHERE id = ?2`,
      ).bind(reversalId, order.id).run()
    })
  }

  async handleDispute(dispute: {id?: string; charge?: string; status?: string}, opened: boolean): Promise<void> {
    const chargeId = typeof dispute.charge === 'string' ? dispute.charge : ''
    if (!chargeId) return
    const order = await this.database.prepare(
      'SELECT * FROM marketplace_orders WHERE stripe_charge_id = ?1',
    ).bind(chargeId).first<OrderRow>()
    if (!order) return
    const won = !opened && dispute.status === 'won'
    const lost = !opened && dispute.status === 'lost'
    await this.database.transaction(async (db) => {
      await db.prepare(
        `UPDATE marketplace_orders SET dispute_status = ?1,
          payment_status = CASE WHEN ?2 THEN 'disputed' ELSE payment_status END,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?3`,
      ).bind(opened ? 'open' : won ? 'won' : lost ? 'lost' : 'none', opened, order.id).run()
      if (opened) {
        await db.prepare(
          `UPDATE download_entitlements SET status = 'suspended', suspended_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP WHERE order_id = ?1 AND status = 'active'`,
        ).bind(order.id).run()
      } else if (won) {
        await db.prepare(
          `UPDATE download_entitlements SET status = 'active', suspended_at = NULL,
            updated_at = CURRENT_TIMESTAMP WHERE order_id = ?1 AND status = 'suspended'`,
        ).bind(order.id).run()
      } else if (lost) {
        await db.prepare(
          `UPDATE download_entitlements SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP,
            suspended_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?1`,
        ).bind(order.id).run()
      }
    })
  }

  async getOrderStatus(userId: string, sessionId: string): Promise<unknown> {
    const attempt = await this.database.prepare(
      `SELECT attempt.status, attempt.stripe_checkout_session_id, order.id AS order_id,
        order.payment_status, order.transfer_status
       FROM marketplace_checkout_attempts attempt
       LEFT JOIN marketplace_orders order ON order.checkout_attempt_id = attempt.id
       WHERE attempt.buyer_user_id = ?1 AND attempt.stripe_checkout_session_id = ?2`,
    ).bind(userId, sessionId).first()
    if (!attempt) throw new MarketplaceError(404, 'checkout_not_found', 'Checkout was not found')
    return attempt
  }

  async listPurchases(userId: string): Promise<unknown[]> {
    const {results} = await this.database.prepare(
      `SELECT entitlement.id AS entitlement_id, entitlement.status AS entitlement_status,
        order.id AS order_id, order.paid_at, order.payment_status, order.currency,
        item.product_id, item.release_title, item.artist_name, item.artwork_asset_id, item.unit_amount_minor,
        COALESCE(json_agg(json_build_object(
          'id', file.id, 'trackId', file.track_id, 'title', file.track_title,
          'discNumber', file.disc_number, 'trackNumber', file.track_number,
          'fileName', file.file_name, 'mimeType', file.mime_type, 'byteSize', file.byte_size
        ) ORDER BY file.disc_number, file.track_number) FILTER (WHERE file.id IS NOT NULL), '[]'::json) AS files
       FROM download_entitlements entitlement
       JOIN marketplace_orders order ON order.id = entitlement.order_id
       JOIN marketplace_order_items item ON item.id = entitlement.order_item_id
       LEFT JOIN download_entitlement_files file ON file.entitlement_id = entitlement.id
       WHERE entitlement.buyer_user_id = ?1
       GROUP BY entitlement.id, order.id, item.id
       ORDER BY order.paid_at DESC`,
    ).bind(userId).all()
    return results
  }

  async getDownload(userId: string, entitlementId: string, fileId: string): Promise<{
    storageKey: string
    fileName: string
    mimeType: string
    byteSize: number
  }> {
    const file = await this.database.prepare(
      `SELECT file.storage_key, file.file_name, file.mime_type, file.byte_size
       FROM download_entitlement_files file
       JOIN download_entitlements entitlement ON entitlement.id = file.entitlement_id
       WHERE file.id = ?1 AND entitlement.id = ?2 AND entitlement.buyer_user_id = ?3
         AND entitlement.status = 'active'`,
    ).bind(fileId, entitlementId, userId).first<{
      storage_key: string
      file_name: string
      mime_type: string
      byte_size: number
    }>()
    if (!file) throw new MarketplaceError(404, 'download_not_found', 'Download is unavailable')
    return {storageKey: file.storage_key, fileName: file.file_name, mimeType: file.mime_type, byteSize: Number(file.byte_size)}
  }
}