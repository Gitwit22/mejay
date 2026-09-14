import {describe, expect, it, vi} from 'vitest'

import {onRequest} from './artist'

function request(authenticated = true): Request {
  return new Request('https://api.example.test/api/account/artist', {
    method: 'POST',
    headers: authenticated ? {cookie: 'mejay_session=test-token'} : {},
  })
}

function database(options?: {subscriptionStatus?: string | null; subscriptionId?: string | null; existingProvider?: boolean}) {
  const executed: string[] = []
  const providerId = 'provider-1'
  const db: any = {
    prepare: vi.fn((sql: string) => {
      const statement: any = {
        bind: vi.fn(() => statement),
        first: vi.fn(async () => {
          if (sql.includes('FROM sessions')) return {user_id: 'user-1', expires_at: '2999-01-01T00:00:00.000Z'}
          if (sql.includes('FROM users WHERE id')) return {id: 'user-1'}
          if (sql.includes('FROM entitlements')) {
            return {
              stripe_subscription_id: options?.subscriptionId ?? null,
              subscription_status: options?.subscriptionStatus ?? null,
            }
          }
          if (sql.includes('SELECT id FROM provider_profiles')) {
            return options?.existingProvider ? {id: providerId} : null
          }
          if (sql.includes('FROM provider_members pm')) {
            return {id: providerId, status: 'pending_profile_completion', role: 'owner'}
          }
          return null
        }),
        run: vi.fn(async () => {
          executed.push(sql)
          return {success: true, meta: {changes: 1}}
        }),
      }
      return statement
    }),
  }
  db.transaction = vi.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(db))
  return {db, executed}
}

describe('POST /api/account/artist', () => {
  it('requires an authenticated session', async () => {
    const {db} = database()
    const response = await onRequest({request: request(false), env: {DB: db, SESSION_PEPPER: 'test'}})

    expect(response.status).toBe(401)
  })

  it.each([
    ['free', null, null],
    ['Full Program only', null, 'active'],
    ['past-due Pro', 'sub_123', 'past_due'],
  ])('rejects %s access', async (_label, subscriptionId, subscriptionStatus) => {
    const {db, executed} = database({subscriptionId, subscriptionStatus})
    const response = await onRequest({request: request(), env: {DB: db, SESSION_PEPPER: 'test'}})

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ok: false, error: 'pro_subscription_required'})
    expect(executed.some((sql) => sql.includes("account_intent = 'provider'"))).toBe(false)
  })

  it.each(['active', 'trialing'])('converts a %s Pro user and bootstraps the provider', async (subscriptionStatus) => {
    const {db, executed} = database({subscriptionId: 'sub_123', subscriptionStatus})
    const response = await onRequest({request: request(), env: {DB: db, SESSION_PEPPER: 'test'}})

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      provider: {id: 'provider-1', status: 'pending_profile_completion', role: 'owner'},
    })
    expect(executed.some((sql) => sql.includes("account_intent = 'provider'"))).toBe(true)
    expect(executed.some((sql) => sql.includes('INSERT INTO provider_profiles'))).toBe(true)
    expect(executed.some((sql) => sql.includes('INSERT INTO provider_members'))).toBe(true)
  })

  it('reuses an existing provider when conversion is repeated', async () => {
    const {db, executed} = database({subscriptionId: 'sub_123', subscriptionStatus: 'active', existingProvider: true})
    const response = await onRequest({request: request(), env: {DB: db, SESSION_PEPPER: 'test'}})

    expect(response.status).toBe(200)
    expect(executed.some((sql) => sql.includes('INSERT INTO provider_profiles'))).toBe(false)
    expect(executed.some((sql) => sql.includes('INSERT INTO provider_members'))).toBe(true)
  })
})