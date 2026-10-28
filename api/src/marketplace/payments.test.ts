import {createHmac} from 'node:crypto'
import {describe, expect, it, vi} from 'vitest'

import {estimateSale, calculateSaleAmounts, resolvePlatformFeeBps} from './commerce-money'
import {connectOnboardingStatus} from './connect-service'
import {buildFinanceCsv, buildFinanceSummary, normalizeFinanceFilters, type FinanceOrderRow} from './finance-service'
import {DEFAULT_MINIMUM_RELEASE_PRICE_MINOR, resolveMinimumReleasePriceMinor} from './sale-policy'
import {priceSchema, releasePriceSchema} from './schemas'
import {onRequest as stripeWebhook, stripeKeyLivemode, verifyStripeWebhookSource, verifyStripeWebhookWithAnySecret} from '../routes/stripe-webhook'

describe('marketplace minimum price configuration', () => {
  it('defaults to $3.00 and accepts an explicit override in cents', () => {
    expect(DEFAULT_MINIMUM_RELEASE_PRICE_MINOR).toBe(300)
    expect(resolveMinimumReleasePriceMinor({})).toBe(300)
    expect(resolveMinimumReleasePriceMinor({MINIMUM_TRACK_PRICE_CENTS: '200'})).toBe(200)
    expect(resolveMinimumReleasePriceMinor({MINIMUM_TRACK_PRICE_CENTS: ' 350 '})).toBe(350)
  })

  it('rejects overrides below the database floor or that are not whole cents', () => {
    for (const value of ['99', '2.00', 'abc', '-300', '10000001']) {
      expect(() => resolveMinimumReleasePriceMinor({MINIMUM_TRACK_PRICE_CENTS: value})).toThrow(/MINIMUM_TRACK_PRICE_CENTS/)
    }
  })

  it('enforces the configured minimum in the price schemas', () => {
    expect(releasePriceSchema.safeParse({name: 'Single', amountMinor: 199}).success).toBe(false)
    expect(releasePriceSchema.safeParse({name: 'Single', amountMinor: 299}).success).toBe(false)
    expect(releasePriceSchema.safeParse({name: 'Single', amountMinor: 300}).success).toBe(true)
    expect(releasePriceSchema.safeParse({name: 'Single', amountMinor: 299.5}).success).toBe(false)
    expect(priceSchema.safeParse({amountMinor: 300, currency: 'USD'}).success).toBe(true)
  })
})

describe('marketplace commission configuration', () => {
  it('reads the platform fee from MARKETPLACE_PLATFORM_FEE_BPS with a 10% default', () => {
    expect(resolvePlatformFeeBps({})).toBe(1000)
    expect(resolvePlatformFeeBps({MARKETPLACE_PLATFORM_FEE_BPS: ''})).toBe(1000)
    expect(resolvePlatformFeeBps({MARKETPLACE_PLATFORM_FEE_BPS: '2000'})).toBe(2000)
    expect(() => resolvePlatformFeeBps({MARKETPLACE_PLATFORM_FEE_BPS: '10001'})).toThrow()
    expect(() => resolvePlatformFeeBps({MARKETPLACE_PLATFORM_FEE_BPS: '12.5'})).toThrow()
  })

  it('estimates a $3.00 sale exactly as fulfillment would before Stripe reports the fee', () => {
    // 20% of 300 = 60; estimated Stripe fee floor((300*290+5000)/10000) + 30 = 39; artist 201.
    expect(estimateSale(300, 2000)).toEqual({
      grossAmountMinor: 300,
      platformCommissionMinor: 60,
      estimatedProcessingFeeMinor: 39,
      estimatedArtistProceedsMinor: 201,
    })
    const fulfillment = calculateSaleAmounts(300, 2000, 39)
    expect(fulfillment.providerProceedsMinor).toBe(201)
  })

  it('always splits the full gross between commission, processing recovery, and artist', () => {
    for (const gross of [300, 299, 999, 1234, 100_000_00]) {
      for (const bps of [0, 1000, 2000, 3000]) {
        const estimate = estimateSale(gross, bps)
        expect(estimate.platformCommissionMinor + estimate.estimatedProcessingFeeMinor + estimate.estimatedArtistProceedsMinor).toBe(gross)
      }
    }
  })
})

describe('Stripe Connect onboarding status', () => {
  const base = {
    stripe_account_id: 'acct_1',
    stripe_details_submitted: true,
    stripe_payouts_enabled: true,
    stripe_transfers_status: 'active' as const,
    stripe_requirements: {},
  }

  it('maps Stripe-reported state to the artist lifecycle', () => {
    expect(connectOnboardingStatus({...base, stripe_account_id: null})).toBe('not_connected')
    expect(connectOnboardingStatus({...base, stripe_details_submitted: false})).toBe('onboarding_required')
    expect(connectOnboardingStatus(base)).toBe('payouts_enabled')
    expect(connectOnboardingStatus({...base, stripe_payouts_enabled: false, stripe_requirements: {currently_due: ['external_account']}})).toBe('verification_required')
    expect(connectOnboardingStatus({...base, stripe_transfers_status: 'pending', stripe_requirements: {pending_verification: ['individual.id_number']}})).toBe('verification_required')
    expect(connectOnboardingStatus({...base, stripe_transfers_status: 'pending'})).toBe('connected')
  })

  it('treats disabled or past-due accounts as restricted even if payouts were enabled', () => {
    expect(connectOnboardingStatus({...base, stripe_requirements: {disabled_reason: 'requirements.past_due'}})).toBe('restricted')
    expect(connectOnboardingStatus({...base, stripe_requirements: {past_due: ['individual.verification.document']}})).toBe('restricted')
  })
})

describe('marketplace finance summary', () => {
  function order(overrides: Partial<FinanceOrderRow>): FinanceOrderRow {
    return {
      id: crypto.randomUUID(), paid_at: '2026-10-01T12:00:00.000Z', provider_profile_id: 'p1', provider_name: 'Label',
      release_id: 'r1', release_title: 'Song', song_title: null, artist_name: 'Artist', currency: 'USD',
      gross_amount_minor: 999, platform_fee_minor: 159, provider_proceeds_minor: 840, stripe_fee_minor: 59,
      refunded_amount_minor: 0, platform_fee_bps: 1000, payment_status: 'paid', transfer_status: 'transferred',
      dispute_status: 'none', livemode: false, platform_revenue_net_minor: 159,
      ...overrides,
    }
  }

  it('reconciles gross to commission, recovered processing fees, and artist allocation', () => {
    const rows = [
      order({}),
      // Refunded $5.00 of $9.99: platform ledger keeps 159 - 79 = 80; artist share reversed.
      order({refunded_amount_minor: 500, payment_status: 'partially_refunded', platform_revenue_net_minor: 80}),
      order({stripe_fee_minor: null, transfer_status: 'pending'}),
      order({dispute_status: 'lost', payment_status: 'disputed', transfer_status: 'reversed'}),
    ]
    const {totals, transactions} = buildFinanceSummary({}, rows, 2)
    expect(totals.orders).toBe(4)
    expect(totals.grossSalesMinor).toBe(3996)
    expect(totals.platformCommissionMinor + totals.processingFeesRecoveredMinor + totals.artistAllocationMinor).toBe(totals.grossSalesMinor)
    expect(totals.platformCommissionMinor).toBe(400)
    expect(totals.stripeFeesMinor).toBe(177)
    expect(totals.ordersWithUnknownStripeFee).toBe(1)
    expect(totals.refundsMinor).toBe(500)
    expect(totals.refundedOrders).toBe(1)
    // (159 - 59) + (80 - 59) + (159 - 0) + (0 - 59) for the lost dispute.
    expect(totals.netPlatformRevenueMinor).toBe(221)
    expect(totals.disputes).toEqual({open: 0, won: 0, lost: 1, openAmountMinor: 0, lostAmountMinor: 999})
    expect(totals.failedPayments).toBe(2)
    expect(totals.pendingTransfers).toEqual({count: 1, amountMinor: 840})
    // Earnings after refunds: 840 + (840 - 421) + 840 + 0 (lost dispute).
    expect(totals.artistEarningsAfterAdjustmentsMinor).toBe(2099)
    expect(transactions).toHaveLength(4)
    expect(transactions[0]).not.toHaveProperty('buyerEmail')
  })

  it('totals sales per artist account across every matching order, largest first', () => {
    const rows = [
      order({provider_profile_id: 'p1', provider_name: 'Label'}),
      order({provider_profile_id: 'p1', provider_name: 'Label', refunded_amount_minor: 500, payment_status: 'partially_refunded'}),
      order({provider_profile_id: 'p2', provider_name: 'Indie', transfer_status: 'pending'}),
    ]
    const {byProvider, totals} = buildFinanceSummary({}, rows, 0)
    expect(byProvider.map((row) => row.providerName)).toEqual(['Label', 'Indie'])
    expect(byProvider[0]).toMatchObject({providerId: 'p1', orders: 2, grossMinor: 1998, platformCommissionMinor: 200, artistAllocationMinor: 1680, refundsMinor: 500, artistEarningsMinor: 1259, paidOutMinor: 1680, pendingPayoutMinor: 0})
    expect(byProvider[1]).toMatchObject({providerId: 'p2', orders: 1, grossMinor: 999, artistEarningsMinor: 840, pendingPayoutMinor: 840, paidOutMinor: 0})
    // The per-artist rows add back up to the page totals.
    expect(byProvider.reduce((sum, row) => sum + row.grossMinor, 0)).toBe(totals.grossSalesMinor)
    expect(byProvider.reduce((sum, row) => sum + row.artistEarningsMinor, 0)).toBe(totals.artistEarningsAfterAdjustmentsMinor)
  })

  it('exports every order as CSV in dollars, with spreadsheet formulas neutralised', () => {
    const csv = buildFinanceCsv([
      order({id: 'o1', release_title: 'Night, Drive', artist_name: '=HYPERLINK("x")', stripe_fee_minor: null}),
      order({id: 'o2', song_title: 'MIA', paid_at: new Date('2026-10-02T00:00:00Z') as never}),
    ])
    const [header, first, second] = csv.trimEnd().split('\n')
    expect(header.split(',')).toEqual(['order_id', 'paid_at_utc', 'artist_account', 'artist', 'release', 'song', 'currency', 'gross', 'mejay_commission', 'stripe_fees_recovered', 'artist_allocation', 'artist_earnings_after_adjustments', 'stripe_fee', 'refunded', 'payment_status', 'transfer_status', 'dispute_status', 'live_mode'])
    expect(first).toBe(`o1,2026-10-01T12:00:00.000Z,Label,"'=HYPERLINK(""x"")","Night, Drive",,USD,9.99,1.00,0.59,8.40,8.40,,0.00,paid,transferred,none,false`)
    expect(second).toContain('o2,2026-10-02T00:00:00.000Z,Label,Artist,Song,MIA,USD,9.99')
  })

  it('validates filters', () => {
    expect(normalizeFinanceFilters({from: '2026-10-01', to: '2026-10-07', status: 'refunded'})).toEqual({from: '2026-10-01', to: '2026-10-07', paymentStatus: 'refunded'})
    expect(() => normalizeFinanceFilters({from: '10/01/2026'})).toThrow()
    expect(() => normalizeFinanceFilters({from: '2026-10-08', to: '2026-10-01'})).toThrow()
    expect(() => normalizeFinanceFilters({status: 'settled'})).toThrow()
  })
})

describe('Stripe webhook verification', () => {
  const platformSecret = 'whsec_platform'
  const connectSecret = 'whsec_connect'

  function sign(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
    return `t=${timestamp},v1=${signature}`
  }

  function webhookRequest(event: Record<string, unknown>, secret: string): Request {
    const payload = JSON.stringify(event)
    return new Request('https://api.test/api/stripe-webhook', {method: 'POST', headers: {'stripe-signature': sign(payload, secret)}, body: payload})
  }

  function fakeDb(claimed: boolean, knownAccount: string | null = null) {
    const queries: string[] = []
    const statement = (sql: string) => {
      const value = {
        bind: () => value,
        first: async () => {
          if (sql.includes('INSERT INTO stripe_webhook_events')) return claimed ? {stripe_event_id: 'evt'} : null
          if (knownAccount && sql.includes('FROM provider_profiles WHERE stripe_account_id')) return {id: 'provider-1'}
          return null
        },
        run: async () => ({}),
        all: async () => ({results: []}),
      }
      return value
    }
    return {queries, db: {prepare: (sql: string) => {queries.push(sql); return statement(sql)}}}
  }

  const env = (DB: unknown, secretKey = 'sk_test_123') => ({
    DB, STRIPE_SECRET_KEY: secretKey, STRIPE_WEBHOOK_SECRET: platformSecret, STRIPE_CONNECT_WEBHOOK_SECRET: connectSecret,
    STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_YEARLY: 'price_year',
  })

  it('accepts payloads signed by either the platform or the Connect endpoint secret', async () => {
    const payload = '{"id":"evt_1"}'
    await expect(verifyStripeWebhookWithAnySecret({payload, header: sign(payload, connectSecret), secrets: [platformSecret, connectSecret]})).resolves.toBe(true)
    await expect(verifyStripeWebhookWithAnySecret({payload, header: sign(payload, platformSecret), secrets: [platformSecret, connectSecret]})).resolves.toBe(true)
    await expect(verifyStripeWebhookWithAnySecret({payload, header: sign(payload, 'whsec_other'), secrets: [platformSecret, connectSecret]})).resolves.toBe(false)
  })

  it('classifies Stripe key modes', () => {
    expect(stripeKeyLivemode('sk_live_abc')).toBe(true)
    expect(stripeKeyLivemode('rk_test_abc')).toBe(false)
    expect(stripeKeyLivemode('unknown')).toBeNull()
  })

  it('rejects unsigned payloads without touching the database', async () => {
    const {db, queries} = fakeDb(true)
    const response = await stripeWebhook({request: webhookRequest({id: 'evt_1', type: 'account.updated'}, 'whsec_forged'), env: env(db) as never})
    expect(response.status).toBe(400)
    expect(queries).toHaveLength(0)
  })

  it('ignores events whose mode does not match the configured secret key', async () => {
    const {db, queries} = fakeDb(true)
    const event = {id: 'evt_test', type: 'checkout.session.completed', livemode: false, data: {object: {metadata: {kind: 'marketplace_purchase'}}}}
    const response = await stripeWebhook({request: webhookRequest(event, platformSecret), env: env(db, 'sk_live_123') as never})
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ok: true, ignored: true})
    expect(queries).toHaveLength(0)
  })

  it('processes a connected-account event signed with the Connect secret', async () => {
    const {db, queries} = fakeDb(true)
    const event = {id: 'evt_acct', type: 'account.updated', livemode: false, account: 'acct_1', data: {object: {id: 'acct_1', details_submitted: true}}}
    const response = await stripeWebhook({request: webhookRequest(event, connectSecret), env: env(db) as never})
    expect(response.status).toBe(200)
    expect(queries.some((sql) => sql.includes('UPDATE provider_profiles SET stripe_details_submitted'))).toBe(true)
  })

  it('identifies which endpoint secret signed a payload', async () => {
    const payload = '{"id":"evt_1"}'
    const secrets = {platformSecret, connectSecret}
    await expect(verifyStripeWebhookSource({payload, header: sign(payload, platformSecret), ...secrets})).resolves.toBe('platform')
    await expect(verifyStripeWebhookSource({payload, header: sign(payload, connectSecret), ...secrets})).resolves.toBe('connect')
    await expect(verifyStripeWebhookSource({payload, header: sign(payload, 'whsec_other'), ...secrets})).resolves.toBeNull()
    // Without a configured Connect secret, a Connect-signed payload is not authentic.
    await expect(verifyStripeWebhookSource({payload, header: sign(payload, connectSecret), platformSecret, connectSecret: ''})).resolves.toBeNull()
  })

  it('rejects forged signatures for both store and Connect event types', async () => {
    for (const event of [
      {id: 'evt_f1', type: 'checkout.session.completed', livemode: false, data: {object: {}}},
      {id: 'evt_f2', type: 'capability.updated', livemode: false, account: 'acct_1', data: {object: {account: 'acct_1'}}},
    ]) {
      const {db, queries} = fakeDb(true)
      const response = await stripeWebhook({request: webhookRequest(event, 'whsec_forged'), env: env(db) as never})
      expect(response.status).toBe(400)
      expect(queries).toHaveLength(0)
    }
  })

  it('never lets the Connect secret drive store fulfillment', async () => {
    const {db, queries} = fakeDb(true)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const event = {id: 'evt_x', type: 'checkout.session.completed', livemode: false, account: 'acct_1', data: {object: {payment_status: 'paid', metadata: {kind: 'marketplace_purchase'}}}}
      const response = await stripeWebhook({request: webhookRequest(event, connectSecret), env: env(db) as never})
      await expect(response.json()).resolves.toEqual({ok: true, ignored: true})
      expect(queries).toHaveLength(0)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('never lets the platform secret change a connected account', async () => {
    for (const type of ['account.updated', 'capability.updated', 'payout.failed']) {
      const {db, queries} = fakeDb(true)
      const event = {id: `evt_${type}`, type, livemode: false, account: 'acct_1', data: {object: {id: 'acct_1'}}}
      const response = await stripeWebhook({request: webhookRequest(event, platformSecret), env: env(db) as never})
      await expect(response.json()).resolves.toEqual({ok: true, ignored: true})
      expect(queries).toHaveLength(0)
    }
  })

  it('ignores Connect-signed events that name no connected account', async () => {
    const {db, queries} = fakeDb(true)
    const event = {id: 'evt_noacct', type: 'account.updated', livemode: false, data: {object: {id: 'acct_1'}}}
    const response = await stripeWebhook({request: webhookRequest(event, connectSecret), env: env(db) as never})
    await expect(response.json()).resolves.toEqual({ok: true, ignored: true})
    expect(queries).toHaveLength(0)
  })

  it('ignores an account.updated payload for a different account than the event names', async () => {
    const {db, queries} = fakeDb(true)
    const event = {id: 'evt_mismatch', type: 'account.updated', livemode: false, account: 'acct_1', data: {object: {id: 'acct_2'}}}
    const response = await stripeWebhook({request: webhookRequest(event, connectSecret), env: env(db) as never})
    await expect(response.json()).resolves.toEqual({ok: true, ignored: true})
    expect(queries.some((sql) => sql.includes('UPDATE provider_profiles'))).toBe(false)
  })

  it('re-reads and syncs the account on capability.updated', async () => {
    const {db, queries} = fakeDb(true, 'acct_1')
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({id: 'acct_1', details_submitted: true, payouts_enabled: true, capabilities: {transfers: 'active'}}), {status: 200}))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const event = {id: 'evt_cap', type: 'capability.updated', livemode: false, account: 'acct_1', data: {object: {id: 'transfers', account: 'acct_1', status: 'active'}}}
      const response = await stripeWebhook({request: webhookRequest(event, connectSecret), env: env(db) as never})
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ok: true})
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe('https://api.stripe.com/v1/accounts/acct_1')
      expect(queries.some((sql) => sql.includes('UPDATE provider_profiles SET stripe_details_submitted'))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('skips capability.updated for accounts MEJay does not know', async () => {
    const {db} = fakeDb(true)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const event = {id: 'evt_cap2', type: 'capability.updated', livemode: false, account: 'acct_unknown', data: {object: {account: 'acct_unknown'}}}
      const response = await stripeWebhook({request: webhookRequest(event, connectSecret), env: env(db) as never})
      expect(response.status).toBe(200)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('acknowledges duplicate deliveries without processing them again', async () => {
    const {db, queries} = fakeDb(false)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const event = {id: 'evt_dup', type: 'checkout.session.completed', livemode: false, data: {object: {payment_status: 'paid', metadata: {kind: 'marketplace_purchase'}}}}
      const response = await stripeWebhook({request: webhookRequest(event, platformSecret), env: env(db) as never})
      await expect(response.json()).resolves.toEqual({ok: true, duplicate: true})
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(queries.every((sql) => sql.includes('stripe_webhook_events'))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
