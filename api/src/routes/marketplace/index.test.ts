import {describe, expect, it, vi} from 'vitest'
import {createArtist} from '.'

function sessionDatabase() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue({user_id: 'user-1', expires_at: '2999-01-01T00:00:00.000Z'}),
      })),
    })),
  }
}

describe('marketplace routes', () => {
  it('requires an authenticated session', async () => {
    const response = await createArtist({
      request: new Request('https://api.example.test/api/marketplace/artists', {method: 'POST', body: '{}'}),
      env: {DB: sessionDatabase()},
      params: {},
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ok: false, error: 'unauthorized'})
  })

  it('returns structured validation errors before calling a service', async () => {
    const response = await createArtist({
      request: new Request('https://api.example.test/api/marketplace/artists', {
        method: 'POST',
        headers: {'content-type': 'application/json', cookie: 'mejay_session=test-token'},
        body: JSON.stringify({name: ''}),
      }),
      env: {DB: sessionDatabase(), SESSION_PEPPER: 'test-pepper'},
      params: {},
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ok: false, error: 'invalid_request'})
  })
})
