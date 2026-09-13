import {describe, expect, it} from 'vitest'
import {resolveApiBase} from './api'

describe('resolveApiBase', () => {
  it('uses the same-origin proxy on the production Pages domain', () => {
    expect(resolveApiBase('https://mejay-api.onrender.com', true, 'mejay2.pages.dev')).toBe('')
  })

  it('uses the configured API on a custom frontend domain', () => {
    expect(resolveApiBase('https://api.mejayapp.com/', true, 'app.mejayapp.com')).toBe('https://api.mejayapp.com')
  })
})