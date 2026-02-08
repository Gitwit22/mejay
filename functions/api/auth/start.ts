import {
  CODE_TTL_MS,
  LOCKOUT_MS,
  MAX_ATTEMPTS,
  addMsIso,
  normalizeEmail,
  nowIso,
  random6DigitCode,
  readJson,
  sha256Hex,
} from '../_auth'

type Env = {
  DB: any
  AUTH_CODE_PEPPER?: string
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

function isLocalHost(req: Request) {
  const host = new URL(req.url).hostname
  return host === '127.0.0.1' || host === 'localhost'
}

export const onRequest = async (ctx: {request: Request; env: Env}): Promise<Response> => {
  const {request, env} = ctx

  if (request.method !== 'POST') return json({ok: false, error: 'Method not allowed'}, {status: 405})

  const body = await readJson(request)
  const emailRaw = String((body as any).email || '')
  const email = normalizeEmail(emailRaw)

  if (!email || !email.includes('@')) {
    return json({ok: false, error: 'invalid_email'}, {status: 400})
  }

  const existing = (await env.DB
    .prepare('SELECT attempts, locked_until FROM auth_codes WHERE email = ?1')
    .bind(email)
    .first()) as {attempts: number; locked_until: string | null} | null

  if (existing?.locked_until && existing.locked_until > nowIso()) {
    return json({ok: false, error: 'locked'}, {status: 429})
  }

  // Reset attempts if previously locked and lock expired.
  if (existing?.attempts && existing.attempts >= MAX_ATTEMPTS && (!existing.locked_until || existing.locked_until <= nowIso())) {
    await env.DB
      .prepare('UPDATE auth_codes SET attempts = 0, locked_until = NULL WHERE email = ?1')
      .bind(email)
      .run()
  }

  const code = random6DigitCode()
  const pepper = env.AUTH_CODE_PEPPER || 'dev-pepper-change-me'
  const codeHash = await sha256Hex(`${email}:${code}:${pepper}`)

  await env.DB
    .prepare(
      [
        'INSERT INTO auth_codes (email, code_hash, expires_at, attempts, locked_until)',
        'VALUES (?1, ?2, ?3, 0, NULL)',
        'ON CONFLICT(email) DO UPDATE SET',
        'code_hash = excluded.code_hash,',
        'expires_at = excluded.expires_at,',
        'attempts = 0,',
        'locked_until = NULL',
      ].join(' '),
    )
    .bind(email, codeHash, addMsIso(CODE_TTL_MS))
    .run()

  const allowDevReturn = isLocalHost(request)

  // TODO: email delivery (Resend/etc). We only return a dev code on localhost.
  return json({ok: true, ...(allowDevReturn ? {devCode: code} : {})}, {status: 200})
}
