import {describe, expect, it} from 'vitest'

import {resolveApiBaseUrl} from './api'

describe('resolveApiBaseUrl', () => {
  it('uses same-origin api for pages.dev in production when no override exists', async () => {
    expect(resolveApiBaseUrl('mejay2.pages.dev', {configuredApiUrl: '', isProd: true})).toBe('')
  })

  it('keeps explicit api overrides', async () => {
    expect(resolveApiBaseUrl('mejay2.pages.dev', {configuredApiUrl: 'https://api.example.com/', isProd: true})).toBe('https://api.example.com')
  })
})
