import {describe, expect, it} from 'vitest'

import {resolveApiBaseUrl} from './api'

describe('resolveApiBaseUrl', () => {
  it('uses same-origin api for pages.dev in production when no override exists', async () => {
    expect(resolveApiBaseUrl({configuredApiUrl: '', isProd: true, hostname: 'mejay2.pages.dev'})).toBe('')
  })

  it('uses same-origin api when explicitly enabled', async () => {
    expect(resolveApiBaseUrl({configuredApiUrl: '', isProd: true, useSameOriginApi: true})).toBe('')
  })

  it('keeps explicit api overrides', async () => {
    expect(resolveApiBaseUrl({configuredApiUrl: 'https://api.example.com/', isProd: true, hostname: 'mejay2.pages.dev'})).toBe('https://api.example.com')
  })
})
