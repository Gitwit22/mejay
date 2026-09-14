import {describe, expect, it, vi} from 'vitest'
import {cadenceFromPrice, persistSubscriptionState, stripeTimestampToIso, subscriptionGrantsPro} from './billing'

describe('subscription billing policy', () => {
  it('grants Pro only for active and trialing subscriptions', () => {
    expect(subscriptionGrantsPro('active')).toBe(true)
    expect(subscriptionGrantsPro('trialing')).toBe(true)
    expect(subscriptionGrantsPro('past_due')).toBe(false)
    expect(subscriptionGrantsPro('unpaid')).toBe(false)
    expect(subscriptionGrantsPro('canceled')).toBe(false)
  })

  it('retains Pro when an active subscription is scheduled to cancel', () => {
    expect(subscriptionGrantsPro('active')).toBe(true)
  })

  it('recognizes monthly and yearly Stripe prices', () => {
    expect(cadenceFromPrice('price_month', 'price_month', 'price_year')).toBe('monthly')
    expect(cadenceFromPrice('price_year', 'price_month', 'price_year')).toBe('yearly')
    expect(cadenceFromPrice('price_other', 'price_month', 'price_year')).toBeNull()
  })

  it('normalizes Stripe timestamps', () => {
    expect(stripeTimestampToIso(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z')
    expect(stripeTimestampToIso(undefined)).toBeNull()
  })

  it('persists subscription state with stale-event and Full Program protection', async () => {
    const bind = vi.fn().mockReturnThis()
    const run = vi.fn().mockResolvedValue({success: true})
    const prepare = vi.fn().mockReturnValue({bind, run})

    await persistSubscriptionState({
      db: {prepare},
      userId: 'user-1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: {
        status: 'past_due',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        cadence: 'monthly',
      },
      eventCreatedAt: '2026-09-13T12:00:00.000Z',
    })

    expect(bind).toHaveBeenCalledWith(
      'user-1', 'free', 0, 'cus_1', 'sub_1', 'past_due', 'monthly', false,
      '2026-10-01T00:00:00.000Z', '2026-09-13T12:00:00.000Z',
    )
    const sql = prepare.mock.calls[0][0] as string
    expect(sql).toContain("entitlements.access_type IN ('full', 'full_program')")
    expect(sql).not.toContain("entitlements.access_type <> 'full'")
    expect(sql).toContain('entitlements.stripe_event_created_at <= excluded.stripe_event_created_at')
  })
})