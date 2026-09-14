import {describe, expect, it, vi} from 'vitest'
import {onRequest} from './delete'

function database(entitlement: Record<string, unknown> | null = null) {
  const executed: string[] = []
  const db: any = {
    prepare: vi.fn((sql: string) => {
      const statement: any = {
        bind: vi.fn(() => statement),
        first: vi.fn(async () => {
          if (sql.includes('FROM sessions')) return {user_id: 'user-1', expires_at: '2999-01-01T00:00:00.000Z'}
          if (sql.includes('FROM users WHERE id')) return {id: 'user-1', email: 'free@example.com'}
          if (sql.includes('FROM entitlements')) return entitlement
          if (sql.includes('FROM provider_members pm')) return null
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

function request(body: unknown, authenticated = true) {
  return new Request('https://api.example.test/api/account', {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? {cookie: 'mejay_session=test-token'} : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('DELETE /api/account', () => {
  it('requires an authenticated session', async () => {
    const {db} = database()
    const response = await onRequest({request: request({}, false), env: {DB: db, SESSION_PEPPER: 'test'}})
    expect(response.status).toBe(401)
  })

  it('deletes only the current free account and expires its cookie', async () => {
    const {db, executed} = database({access_type: 'free', has_full_access: 0, subscription_status: null})
    const response = await onRequest({
      request: request({email: 'free@example.com', forfeitFullProgram: false}),
      env: {DB: db, SESSION_PEPPER: 'test', COOKIE_SAME_SITE: 'none'},
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ok: true})
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(executed.some((sql) => sql.includes('DELETE FROM users WHERE id'))).toBe(true)
  })

  it('rejects an active paid account before any user deletion', async () => {
    const {db, executed} = database({access_type: 'pro', has_full_access: 1, subscription_status: 'active'})
    const response = await onRequest({
      request: request({email: 'free@example.com', forfeitFullProgram: false}),
      env: {DB: db, SESSION_PEPPER: 'test'},
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ok: false, error: 'subscription_active'})
    expect(executed.some((sql) => sql.includes('DELETE FROM users WHERE id'))).toBe(false)
  })
})