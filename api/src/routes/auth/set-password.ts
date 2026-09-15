import {hashPassword} from '../_password'

import {
  SESSION_TTL_MS,
  SHORT_SESSION_TTL_MS,
  addMsIso,
  makeSessionCookie,
  normalizeEmail,
  nowIso,
  readJson,
  sha256Hex,
  verifyVerifiedToken,
} from '../_auth'
import {parseAccountIntent} from '../../marketplace/onboarding'
import {claimMarketplaceAccess} from '../../marketplace/staff-access'

type PreparedQuery = {
  bind: (...values: unknown[]) => {
    first: <T = Record<string, unknown>>() => Promise<T | null>
    run: () => Promise<unknown>
  }
}

type TransactionDatabase = {
  prepare: (sql: string) => PreparedQuery
}

type Env = {
  DB: TransactionDatabase & {
    transaction: <T>(callback: (database: TransactionDatabase) => Promise<T>) => Promise<T>
  }
  SESSION_PEPPER?: string
  AUTH_TOKEN_SECRET?: string
  COOKIE_SAME_SITE?: 'lax' | 'none' | 'strict'
  // Optional safety switch: allow dev-only behavior outside localhost.
  ALLOW_DEV_ENDPOINTS?: string
}

function isLocalHost(req: Request) {
  const host = new URL(req.url).hostname
  return host === '127.0.0.1' || host === 'localhost'
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
      expires: '0',
      ...(init?.headers ?? {}),
    },
  })

export const onRequest = async (ctx: {request: Request; env: Env}): Promise<Response> => {
  const {request, env} = ctx

  if (request.method !== 'POST') return json({ok: false, error: 'Method not allowed'}, {status: 405})
  if (!env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})

  try {
    const body = (await readJson(request)) as {
      email?: unknown
      verifiedToken?: unknown
      password?: unknown
      accountIntent?: unknown
      rememberMe?: unknown
    }
    const email = normalizeEmail(String(body.email || ''))
    const token = String(body.verifiedToken || '').trim()
    const password = String(body.password || '')
    const accountIntent = parseAccountIntent(body.accountIntent)
    const rememberMeRaw = body.rememberMe
    // Back-compat: older clients don't send rememberMe; preserve existing 30-day behavior.
    const rememberMe = typeof rememberMeRaw === 'boolean' ? rememberMeRaw : true

    if (!email || !token || !password) return json({ok: false, error: 'missing'}, {status: 400})
    if (password.length < 8) return json({ok: false, error: 'password_too_short'}, {status: 400})

    const verified = await verifyVerifiedToken({env, token})
    if (!verified.ok) return json({ok: false, error: verified.error === 'expired' ? 'expired' : 'invalid'}, {status: 400})
    if (normalizeEmail(verified.payload.email) !== email) return json({ok: false, error: 'invalid'}, {status: 400})

    const purpose = verified.payload.purpose
    if (purpose !== 'signup_verify' && purpose !== 'password_reset') {
      return json({ok: false, error: 'invalid'}, {status: 400})
    }

    // Hash password.
    const passwordHash = await hashPassword(password)

    const ttlMs = rememberMe ? SESSION_TTL_MS : SHORT_SESSION_TTL_MS
    const sessionToken = crypto.randomUUID() + crypto.randomUUID()
    const sessionPepper = env.SESSION_PEPPER || 'dev-session-pepper'
    const tokenHash = await sha256Hex(`session:${sessionToken}:${sessionPepper}`)
    const expiresAt = addMsIso(ttlMs)

    const user = await env.DB.transaction(async (database) => {
      let currentUser = (await database
        .prepare('SELECT id, email FROM users WHERE email = ?1')
        .bind(email)
        .first()) as {id: string; email: string} | null

      if (purpose === 'password_reset') {
        if (!currentUser) return null

        await database
          .prepare('UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3')
          .bind(passwordHash, nowIso(), currentUser.id)
          .run()
        await database.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(currentUser.id).run()
      } else {
        const userId = currentUser?.id ?? crypto.randomUUID()
        const now = nowIso()
        await database
          .prepare(
            [
              'INSERT INTO users (id, email, password_hash, account_intent, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)',
              'ON CONFLICT(email) DO UPDATE SET',
              'password_hash=excluded.password_hash,',
              "account_intent=CASE WHEN users.account_intent = 'provider' THEN users.account_intent ELSE excluded.account_intent END,",
              'updated_at=excluded.updated_at',
            ].join(' '),
          )
          .bind(userId, email, passwordHash, 'consumer', now)
          .run()

        currentUser = (await database
          .prepare('SELECT id, email FROM users WHERE email = ?1')
          .bind(email)
          .first()) as {id: string; email: string} | null
        if (!currentUser) throw new Error('user_upsert_failed')

      }

      await claimMarketplaceAccess(database, currentUser.id, currentUser.email)

      await database.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(nowIso()).run()
      await database
        .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)')
        .bind(tokenHash, currentUser.id, expiresAt)
        .run()
      return currentUser
    })

    if (!user) return json({ok: false, error: 'user_not_found'}, {status: 400})

    const secure = new URL(request.url).protocol === 'https:'
    const cookie = makeSessionCookie(sessionToken, {
      secure,
      sameSite: env.COOKIE_SAME_SITE,
      maxAgeSeconds: Math.floor(ttlMs / 1000),
    })

    return new Response(JSON.stringify({ok: true, artistUpgradeRequired: purpose === 'signup_verify' && accountIntent === 'provider'}), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'Set-Cookie': cookie,
      },
    })
  } catch (err) {
    const errorId = crypto.randomUUID()
    console.error('/api/auth/set-password threw', {errorId, err})
    const message = err instanceof Error ? err.message : String(err)
    const lower = message.toLowerCase()
    const allowDebug = isLocalHost(request) || env.ALLOW_DEV_ENDPOINTS === 'true'
    if (lower.includes('no such table') || lower.includes('no such column')) {
      return json({ok: false, error: 'db_schema_out_of_date', errorId}, {status: 500})
    }
    if (lower.includes('constraint failed') || lower.includes('sqlite_constraint')) {
      return json({ok: false, error: 'db_constraint', errorId}, {status: 500})
    }
    if (allowDebug) {
      return json({ok: false, error: 'server_error', errorId, detail: message.slice(0, 600)}, {status: 500})
    }
    return json({ok: false, error: 'server_error', errorId}, {status: 500})
  }
}
