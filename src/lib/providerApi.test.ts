import {beforeEach, describe, expect, it, vi} from 'vitest'

import {apiFetch} from './api'
import {createProviderArtist, getProviderDashboard, getProviderReporting, getRecipientEarnings} from './providerApi'

vi.mock('./api', () => ({apiFetch: vi.fn()}))

describe('provider API', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset())

  it('loads the provider dashboard through the authenticated API client', async () => {
    const data = {provider: {id: 'provider-1'}, counts: {artists: 1}}
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ok: true, data}), {status: 200}))

    await expect(getProviderDashboard()).resolves.toEqual(data)
    expect(apiFetch).toHaveBeenCalledWith('/api/marketplace/dashboard', undefined)
  })

  it('sends normalized artist input and preserves server errors', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: 'provider_write_forbidden',
      message: 'Provider write access is required',
    }), {status: 403}))

    await expect(createProviderArtist({name: 'Artist'})).rejects.toThrow('Provider write access is required')
    expect(apiFetch).toHaveBeenCalledWith('/api/marketplace/artists', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({name: 'Artist', metadata: {}}),
    }))
  })

  it('loads provider and recipient reporting for the selected range', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => new Response(JSON.stringify({ok: true, data: {summary: {}}}), {status: 200}))

    await getProviderReporting('30d')
    await getRecipientEarnings('ytd')

    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/marketplace/reporting?range=30d', undefined)
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/marketplace/recipient-earnings?range=ytd', undefined)
  })
})