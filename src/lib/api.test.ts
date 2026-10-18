import {describe, expect, it} from 'vitest'
import {resolveApiBase} from './api'

describe('resolveApiBase', () => {
  it('uses the same-origin proxy on the production Pages domain', () => {
    expect(resolveApiBase('https://mejay-api.onrender.com', true, 'mejay2.pages.dev')).toBe('')
  })

  it('uses the same-origin proxy on the mejayapp.com production domain', () => {
    expect(resolveApiBase('https://mejay-api.onrender.com', true, 'mejayapp.com')).toBe('')
    expect(resolveApiBase('https://mejay-api.onrender.com', true, 'www.mejayapp.com')).toBe('')
    expect(resolveApiBase('', true, 'MEJAYAPP.COM')).toBe('')
  })

  it('does not treat look-alike hosts as the production domain', () => {
    expect(resolveApiBase('', true, 'evilmejayapp.com')).toBe('https://mejay-api.onrender.com')
    expect(resolveApiBase('', true, 'mejayapp.com.attacker.example')).toBe('https://mejay-api.onrender.com')
  })

  it('uses the configured API on a custom frontend domain', () => {
    expect(resolveApiBase('https://api.mejayapp.com/', true, 'app.mejayapp.com')).toBe('https://api.mejayapp.com')
  })

  it('uses the configured API on non-matching preview domains', () => {
    expect(resolveApiBase('https://api.mejayapp.com/', true, 'other-project.pages.dev')).toBe('https://api.mejayapp.com')
  })
})
