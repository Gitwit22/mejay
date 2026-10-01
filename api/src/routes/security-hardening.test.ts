import {afterEach, describe, expect, it, vi} from 'vitest'

import {applyRateLimit, CLIENT_IP_HEADER, isDevEnvironment} from './_security'
import {random6DigitCode} from './_auth'
import {onRequest as authStart} from './auth/start'
import {onRequestGet as downloadFullProgram} from './download/full-program'
import {hasLiveProSubscription, isEligibleForProTrial, onRequest as checkout} from './checkout'
import {requireDevAdmin} from './dev-admin/_guard'

/** Minimal in-memory stand-in for the D1-style adapter, keyed on SQL prefixes. */
function fakeDb(handlers: {first?: (sql: string, args: unknown[]) => unknown; run?: (sql: string, args: unknown[]) => void} = {}) {
  const runs: Array<{sql: string; args: unknown[]}> = []
  return {
    runs,
    prepare(sql: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...values: unknown[]) {
          args = values
          return stmt
        },
        async first<T = Record<string, unknown>>() {
          return (handlers.first?.(sql, args) ?? null) as T | null
        },
        async run() {
          runs.push({sql, args})
          handlers.run?.(sql, args)
          return {success: true, meta: {changes: 1}}
        },
        async all() {
          return {results: []}
        },
      }
      return stmt
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dev environment detection', () => {
  it('is driven by deployment env, not by request host', () => {
    expect(isDevEnvironment({NODE_ENV: 'production'})).toBe(false)
    expect(isDevEnvironment({NODE_ENV: 'production', ALLOW_DEV_ENDPOINTS: 'true'})).toBe(true)
    expect(isDevEnvironment({NODE_ENV: 'development'})).toBe(true)
  })

  it('never returns the login code in production even with a spoofed localhost host', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', {status: 500})))
    const db = fakeDb()
    const request = new Request('http://localhost/api/auth/start', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-forwarded-host': 'localhost', [CLIENT_IP_HEADER]: '1.2.3.4'},
      body: JSON.stringify({email: 'victim@example.com', purpose: 'password_reset'}),
    })
    const response = await authStart({request, env: {DB: db, NODE_ENV: 'production'}})
    const body = await response.json() as Record<string, unknown>
    expect(body.devCode).toBeUndefined()
    expect(response.status).toBe(500)
  })

  it('does not reset failed attempts when a new code is issued', async () => {
    const db = fakeDb({
      first: (sql) => (sql.startsWith('SELECT attempts') ? {attempts: 3, locked_until: null} : null),
    })
    const request = new Request('http://api.test/api/auth/start', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email: 'user@example.com'}),
    })
    const response = await authStart({request, env: {DB: db, NODE_ENV: 'development'}})
    expect(response.status).toBe(200)
    const insert = db.runs.find((entry) => entry.sql.startsWith('INSERT INTO email_codes'))
    expect(insert?.args[4]).toBe(3)
  })
})

describe('login code generation', () => {
  it('produces six-digit codes', () => {
    for (let i = 0; i < 200; i++) expect(random6DigitCode()).toMatch(/^[1-9]\d{5}$/)
  })
})

describe('rate limiting', () => {
  it('locks a key after the window budget is spent', async () => {
    const rows = new Map<string, {window_start: string; count: number; locked_until: string | null}>()
    const db = fakeDb({
      first: (_sql, args) => rows.get(String(args[0])) ?? null,
      run: (_sql, args) => {
        rows.set(String(args[0]), {window_start: String(args[3]), count: Number(args[4]), locked_until: (args[5] as string) ?? null})
      },
    })
    const results = []
    for (let i = 0; i < 4; i++) results.push((await applyRateLimit({db, key: 'k', purpose: 'login', kind: 'x', maxPerWindow: 3})).ok)
    expect(results).toEqual([true, true, true, false])
    expect((await applyRateLimit({db, key: 'k', purpose: 'login', kind: 'x', maxPerWindow: 3})).ok).toBe(false)
  })
})

describe('Full Program download', () => {
  it('rejects Pro subscribers even though they have full access flags', async () => {
    const env = {
      DB: fakeDb({first: (sql) => (sql.includes('FROM sessions') ? {user_id: 'u1', expires_at: '2999-01-01T00:00:00.000Z'} : {access_type: 'pro', has_full_access: 1})}),
      DOWNLOADS: {get: vi.fn(async () => ({body: 'zip'}))},
    }
    const request = new Request('http://api.test/api/download/full-program', {headers: {cookie: 'mejay_session=tok'}})
    const response = await downloadFullProgram({request, env})
    expect(response.status).toBe(403)
    expect(env.DOWNLOADS.get).not.toHaveBeenCalled()
  })
})

describe('Pro checkout', () => {
  const baseEnv = {
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_PRICE_PRO: 'price_pro',
    STRIPE_PRICE_YEARLY: 'price_year',
    STRIPE_PRICE_FULL_PROGRAM: 'price_full',
    FRONTEND_URL: 'https://app.test',
    NODE_ENV: 'production',
  }

  function checkoutRequest(body: Record<string, unknown>) {
    return new Request('http://api.test/api/checkout', {
      method: 'POST',
      headers: {'content-type': 'application/json', cookie: 'mejay_session=tok'},
      body: JSON.stringify(body),
    })
  }

  function envWithEntitlement(ent: Record<string, unknown> | null) {
    return {
      ...baseEnv,
      DB: fakeDb({
        first: (sql) => {
          if (sql.includes('FROM sessions')) return {user_id: 'u1', expires_at: '2999-01-01T00:00:00.000Z'}
          if (sql.includes('FROM entitlements')) return ent
          if (sql.includes('FROM users')) return {email: 'u1@example.com'}
          return null
        },
      }),
    }
  }

  it('classifies live subscriptions and trial eligibility', () => {
    expect(hasLiveProSubscription({access_type: 'free', has_full_access: 0, stripe_subscription_id: 'sub_1', subscription_status: 'past_due'})).toBe(true)
    expect(hasLiveProSubscription({access_type: 'free', has_full_access: 0, stripe_subscription_id: 'sub_1', subscription_status: 'canceled'})).toBe(false)
    expect(isEligibleForProTrial(null)).toBe(true)
    expect(isEligibleForProTrial({access_type: 'free', has_full_access: 0, stripe_subscription_id: null, subscription_status: 'canceled'})).toBe(false)
  })

  it('adds a 3-day trial for first-time subscribers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({url: 'https://checkout.stripe.test/s'}), {status: 200}))
    vi.stubGlobal('fetch', fetchMock)
    const response = await checkout({request: checkoutRequest({plan: 'pro', intent: 'trial'}), env: envWithEntitlement(null)})
    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1]
    const params = new URLSearchParams(String(init.body))
    expect(params.get('subscription_data[trial_period_days]')).toBe('3')
    expect((init.headers as Record<string, string>)['idempotency-key']).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not grant a second trial to returning subscribers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({url: 'https://checkout.stripe.test/s'}), {status: 200}))
    vi.stubGlobal('fetch', fetchMock)
    const ent = {access_type: 'free', has_full_access: 0, stripe_subscription_id: 'sub_old', subscription_status: 'canceled'}
    await checkout({request: checkoutRequest({plan: 'pro'}), env: envWithEntitlement(ent)})
    const params = new URLSearchParams(String(fetchMock.mock.calls[0][1].body))
    expect(params.get('subscription_data[trial_period_days]')).toBeNull()
  })

  it('blocks a second subscription while one is past due', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const ent = {access_type: 'free', has_full_access: 0, stripe_subscription_id: 'sub_1', subscription_status: 'past_due'}
    const response = await checkout({request: checkoutRequest({plan: 'pro'}), env: envWithEntitlement(ent)})
    expect(response.status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps Full Program gated in production regardless of host', async () => {
    const response = await checkout({
      request: new Request('http://localhost/api/checkout', {method: 'POST', body: JSON.stringify({plan: 'full_program'})}),
      env: envWithEntitlement(null),
    })
    expect(response.status).toBe(403)
  })
})

describe('dev admin guard', () => {
  it('fails closed without an allowlist even when enabled', async () => {
    const result = await requireDevAdmin(new Request('http://api.test/'), {DB: fakeDb(), NODE_ENV: 'development', ALLOW_DEV_ADMIN: 'true'})
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(404)
  })
})
