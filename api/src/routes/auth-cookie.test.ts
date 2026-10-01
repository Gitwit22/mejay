import {describe, expect, it} from 'vitest'
import {cookieHeaderForLogout, makeSessionCookie} from './_auth'

describe('session cookies', () => {
  it('issues a secure cross-site cookie', () => {
    const cookie = makeSessionCookie('token', {secure: true, sameSite: 'none', maxAgeSeconds: 3600})

    expect(cookie).toContain('mejay_session=token')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=None')
    expect(cookie).toContain('Max-Age=3600')
  })

  it('clears a cookie with matching cross-site attributes', () => {
    const cookie = cookieHeaderForLogout({secure: true, sameSite: 'none'})

    expect(cookie).toContain('SameSite=None')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Max-Age=0')
  })
})