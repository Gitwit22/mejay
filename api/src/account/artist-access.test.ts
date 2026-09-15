import {describe, expect, it, vi} from 'vitest'

import {grantsArtistPortalAccess, userHasArtistPortalAccess} from './artist-access'

describe('Artist portal access policy', () => {
  it.each(['active', 'trialing'])('allows a Stripe-backed %s Pro subscription', (subscriptionStatus) => {
    expect(grantsArtistPortalAccess({stripe_subscription_id: 'sub_123', subscription_status: subscriptionStatus})).toBe(true)
  })

  it.each([null, 'past_due', 'unpaid', 'canceled'])('rejects subscription status %s', (subscriptionStatus) => {
    expect(grantsArtistPortalAccess({stripe_subscription_id: 'sub_123', subscription_status: subscriptionStatus})).toBe(false)
  })

  it('rejects Full Program-style access without a Stripe subscription', () => {
    expect(grantsArtistPortalAccess({stripe_subscription_id: null, subscription_status: 'active'})).toBe(false)
  })

  it('allows an explicit Artist Portal grant without fake Stripe data', () => {
    expect(grantsArtistPortalAccess({
      stripe_subscription_id: null,
      subscription_status: null,
      artist_portal_access: true,
    })).toBe(true)
  })

  it('loads the current user entitlement from the database', async () => {
    const first = vi.fn().mockResolvedValue({stripe_subscription_id: 'sub_123', subscription_status: 'active'})
    const bind = vi.fn().mockReturnValue({first})
    const prepare = vi.fn().mockReturnValue({bind})

    await expect(userHasArtistPortalAccess({prepare}, 'user-1')).resolves.toBe(true)
    expect(bind).toHaveBeenCalledWith('user-1')
  })
})