import {describe, expect, it} from 'vitest'
import {loadConfig} from './env'

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@example.com/mejay',
  FRONTEND_URL: 'https://mejay2.pages.dev',
  SESSION_PEPPER: 's'.repeat(48),
  AUTH_CODE_PEPPER: 'c'.repeat(48),
  AUTH_TOKEN_SECRET: 't'.repeat(48),
  COOKIE_SAME_SITE: 'none',
}

describe('loadConfig', () => {
  it('loads the cross-site production cookie policy', () => {
    const config = loadConfig(productionEnv)

    expect(config.FRONTEND_URL).toBe('https://mejay2.pages.dev')
    expect(config.COOKIE_SAME_SITE).toBe('none')
  })

  it.each(['SESSION_PEPPER', 'AUTH_CODE_PEPPER', 'AUTH_TOKEN_SECRET'] as const)(
    'rejects a missing production %s',
    (key) => {
      expect(() => loadConfig({...productionEnv, [key]: ''})).toThrow(key)
    },
  )

  it('rejects placeholder production secrets', () => {
    expect(() => loadConfig({...productionEnv, SESSION_PEPPER: 'replace-with-a-long-random-value'})).toThrow(
      'SESSION_PEPPER',
    )
  })
})