import {verifyPassword} from '../_password'

import {SESSION_TTL_MS, addMsIso, makeSessionCookie, normalizeEmail, readJson, sha256Hex} from '../_auth'

type Env = {
  DB: any
  SESSION_PEPPER?: string
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
    const password = String((body as any).password || '')

    if (!email || !password) return json({ok: false, error: 'missing'}, {status: 400})

    const user = (await env.DB
      .prepare('SELECT id, password_hash FROM users WHERE email = ?1')
      .bind(email)
      .first()) as {id: string; password_hash: string | null} | null

    if (!user) return json({ok: false, error: 'invalid_credentials'}, {status: 401})
    if (!user.password_hash) return json({ok: false, error: 'password_not_set'}, {status: 400})

    const ok = await verifyPassword(password, user.password_hash)

    if (!ok) return json({ok: false, error: 'invalid_credentials'}, {status: 401})

    const sessionToken = crypto.randomUUID() + crypto.randomUUID()
    const pepper = env.SESSION_PEPPER || 'dev-session-pepper'
    const tokenHash = await sha256Hex(`session:${sessionToken}:${pepper}`)
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
    console.error('/api/auth/login threw', err)
    const message = err instanceof Error ? err.message : String(err)
    const lower = message.toLowerCase()
    if (lower.includes('no such table') || lower.includes('no such column')) {
      return json({ok: false, error: 'db_schema_out_of_date'}, {status: 500})
    }
    return json({ok: false, error: 'server_error'}, {status: 500})
  }
}
