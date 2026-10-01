import {describe, expect, it, vi} from 'vitest'

import {getReleaseSaleReadiness, MINIMUM_RELEASE_PRICE_MINOR} from './sale-policy'

describe('marketplace sale policy', () => {
  it('requires a current USD price of at least one dollar and ready Stripe payouts', async () => {
    let query = ''
    const statement = {
      bind: vi.fn(() => statement),
      first: vi.fn().mockResolvedValue({has_minimum_price: true, stripe_ready: true}),
    }
    const readiness = await getReleaseSaleReadiness({prepare: (sql: string) => {query = sql; return statement}}, 'release-1')

    expect(MINIMUM_RELEASE_PRICE_MINOR).toBe(100)
    expect(query).toContain("price.currency = 'USD'")
    expect(query).toContain('price.amount_minor >= 100')
    expect(query).toContain('provider.stripe_payouts_enabled')
    expect(query).toContain("provider.stripe_transfers_status = 'active'")
    expect(readiness).toEqual({hasMinimumPrice: true, stripeReady: true})
  })

  it('reports incomplete sales setup', async () => {
    const statement = {
      bind: vi.fn(() => statement),
      first: vi.fn().mockResolvedValue({has_minimum_price: false, stripe_ready: false}),
    }

    await expect(getReleaseSaleReadiness({prepare: () => statement}, 'release-1')).resolves.toEqual({
      hasMinimumPrice: false,
      stripeReady: false,
    })
  })
})