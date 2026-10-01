import {describe, expect, it, vi} from 'vitest'
import {onRequest} from './logout'

function request() {
  return new Request('https://api.example.test/api/auth/logout', {
    method: 'POST',
    headers: {cookie: 'mejay_session=test-token'},
  })
}

describe('POST /api/auth/logout', () => {
  it('deletes the session and expires the cookie', async () => {
    const run = vi.fn().mockResolvedValue({success: true})
    const env = {DB: {prepare: vi.fn(() => ({bind: vi.fn(() => ({run}))}))}, SESSION_PEPPER: 'test'}

    const response = await onRequest({request: request(), env})

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ok: true})
    expect(run).toHaveBeenCalledOnce()
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('returns a stable error and does not expire the cookie when deletion fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = vi.fn().mockRejectedValue(new Error('database unavailable'))
    const env = {DB: {prepare: vi.fn(() => ({bind: vi.fn(() => ({run}))}))}, SESSION_PEPPER: 'test'}

    const response = await onRequest({request: request(), env})

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ok: false, error: 'logout_failed'})
    expect(response.headers.get('set-cookie')).toBeNull()
    consoleError.mockRestore()
  })
})