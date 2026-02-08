import {
  LOCKOUT_MS,
  MAX_ATTEMPTS,
  SESSION_TTL_MS,
  addMsIso,
  makeSessionCookie,
  normalizeEmail,
  nowIso,
  readJson,
  sha256Hex,
} from '../_auth'

type Env = {
  DB: any
  AUTH_CODE_PEPPER?: string
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

  const body = await readJson(request)
  const email = normalizeEmail(String((body as any).email || ''))
  const code = String((body as any).code || '').trim()

  if (!email || !code) return json({ok: false, error: 'missing'}, {status: 400})

  const row = (await env.DB
    .prepare('SELECT code_hash, expires_at, attempts, locked_until FROM auth_codes WHERE email = ?1')
    .bind(email)
    .first()) as
    | {code_hash: string; expires_at: string; attempts: number; locked_until: string | null}
    | null

  if (!row) return json({ok: false, error: 'no_code'}, {status: 400})
  if (row.locked_until && row.locked_until > nowIso()) return json({ok: false, error: 'locked'}, {status: 429})
  if (row.expires_at < nowIso()) return json({ok: false, error: 'expired'}, {status: 400})

  const pepper = env.AUTH_CODE_PEPPER || 'dev-pepper-change-me'
  const attemptHash = await sha256Hex(`${email}:${code}:${pepper}`)

  if (attemptHash !== row.code_hash) {
    const newAttempts = (row.attempts ?? 0) + 1
    const lockedUntil = newAttempts >= MAX_ATTEMPTS ? addMsIso(LOCKOUT_MS) : null
    await env.DB
      .prepare('UPDATE auth_codes SET attempts = ?1, locked_until = ?2 WHERE email = ?3')
      .bind(newAttempts, lockedUntil, email)
      .run()
    return json({ok: false, error: 'bad_code'}, {status: 400})
  }

  // Find or create user
  let user = (await env.DB
    .prepare('SELECT id, email FROM users WHERE email = ?1')
    .bind(email)
    .first()) as {id: string; email: string} | null

  if (!user) {
    const userId = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO users (id, email) VALUES (?1, ?2)').bind(userId, email).run()
    user = {id: userId, email}
  }

  // Create session
  const sessionToken = crypto.randomUUID() + crypto.randomUUID()
  const sessionPepper = env.SESSION_PEPPER || 'dev-session-pepper'
  const tokenHash = await sha256Hex(`session:${sessionToken}:${sessionPepper}`)
  const expiresAt = addMsIso(SESSION_TTL_MS)

  await env.DB
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)')
    .bind(tokenHash, user.id, expiresAt)
    .run()

  // Delete code so it can't be reused
  await env.DB.prepare('DELETE FROM auth_codes WHERE email = ?1').bind(email).run()

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
}
