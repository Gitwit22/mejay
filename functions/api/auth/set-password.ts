import {hashPassword} from '../_password'

import {
  SESSION_TTL_MS,
  addMsIso,
  makeSessionCookie,
  normalizeEmail,
  nowIso,
  readJson,
  sha256Hex,
  verifyVerifiedToken,
} from '../_auth'

type Env = {
  DB: any
  SESSION_PEPPER?: string
  AUTH_TOKEN_SECRET?: string
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
    const body = await readJson(request)
    const email = normalizeEmail(String((body as any).email || ''))
    const token = String((body as any).verifiedToken || '').trim()
    const password = String((body as any).password || '')

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

    // Find or create user.
    let user = (await env.DB
      .prepare('SELECT id, email FROM users WHERE email = ?1')
      .bind(email)
      .first()) as {id: string; email: string} | null

    if (purpose === 'password_reset') {
      if (!user) return json({ok: false, error: 'user_not_found'}, {status: 400})

      await env.DB
        .prepare('UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3')
        .bind(passwordHash, nowIso(), user.id)
        .run()
    } else {
      // signup_verify: create-or-update in a race-safe way.
      const userId = user?.id ?? crypto.randomUUID()
      await env.DB
        .prepare(
          [
            'INSERT INTO users (id, email, password_hash, updated_at) VALUES (?1, ?2, ?3, ?4)',
            'ON CONFLICT(email) DO UPDATE SET',
            'password_hash=excluded.password_hash,',
            'updated_at=excluded.updated_at',
          ].join(' '),
        )
        .bind(userId, email, passwordHash, nowIso())
        .run()

      user = (await env.DB
        .prepare('SELECT id, email FROM users WHERE email = ?1')
        .bind(email)
        .first()) as {id: string; email: string} | null

      if (!user) throw new Error('user_upsert_failed')
    }

    // Create session.
    const sessionToken = crypto.randomUUID() + crypto.randomUUID()
    const sessionPepper = env.SESSION_PEPPER || 'dev-session-pepper'
    const tokenHash = await sha256Hex(`session:${sessionToken}:${sessionPepper}`)
    const expiresAt = addMsIso(SESSION_TTL_MS)

    await env.DB
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)')
      .bind(tokenHash, user.id, expiresAt)
      .run()

    const secure = new URL(request.url).protocol === 'https:'
    const cookie = makeSessionCookie(sessionToken, {secure, maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000)})

    return new Response(JSON.stringify({ok: true}), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'Set-Cookie': cookie,
      },
    })
  } catch (err) {
    console.error('/api/auth/set-password threw', err)
    const message = err instanceof Error ? err.message : String(err)
    const lower = message.toLowerCase()
    const allowDebug = isLocalHost(request) || env.ALLOW_DEV_ENDPOINTS === 'true'
    if (lower.includes('no such table') || lower.includes('no such column')) {
      return json({ok: false, error: 'db_schema_out_of_date'}, {status: 500})
    }
    if (allowDebug) {
      return json({ok: false, error: 'server_error', detail: message.slice(0, 600)}, {status: 500})
    }
    return json({ok: false, error: 'server_error'}, {status: 500})
  }
}
