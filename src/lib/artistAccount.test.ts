import {afterEach, describe, expect, it, vi} from 'vitest'

import {ArtistAccountError, convertToArtistAccount} from './artistAccount'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Artist account client', () => {
  it('returns the validated provider summary', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      provider: {id: 'provider-1', status: 'pending_profile_completion', role: 'owner'},
    }), {status: 200, headers: {'content-type': 'application/json'}}))

    await expect(convertToArtistAccount()).resolves.toEqual({
      id: 'provider-1',
      status: 'pending_profile_completion',
      role: 'owner',
    })
  })

  it('rejects invalid success responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>fallback</html>', {status: 200}))

    await expect(convertToArtistAccount()).rejects.toMatchObject({
      code: 'artist_conversion_failed',
    })
  })

  it('surfaces the server policy error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: 'pro_subscription_required',
      message: 'An active Pro subscription is required for Artist access.',
    }), {status: 403, headers: {'content-type': 'application/json'}}))

    await expect(convertToArtistAccount()).rejects.toMatchObject({
      status: 403,
      code: 'pro_subscription_required',
    })
  })
})