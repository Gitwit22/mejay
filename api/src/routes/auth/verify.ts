import {
  LOCKOUT_MS,
  MAX_ATTEMPTS,
  addMsIso,
  addMs,
  normalizeEmail,
  nowIso,
  readJson,
  sha256Hex,
  signVerifiedToken,
  type VerifiedPurpose,
} from '../_auth'

type Purpose = VerifiedPurpose

type Env = {
  DB: any
  AUTH_CODE_PEPPER?: string
  SESSION_PEPPER?: string
  AUTH_TOKEN_SECRET?: string
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

  try {
    const body = await readJson(request)
    const email = normalizeEmail(String((body as any).email || ''))
    const code = String((body as any).code || '').trim()
    const purpose = ((body as any).purpose === 'password_reset' ? 'password_reset' : 'signup_verify') as Purpose

    if (!email || !code) return json({ok: false, error: 'missing'}, {status: 400})

    const row = (await env.DB
      .prepare('SELECT code_hash, expires_at, attempts, locked_until FROM email_codes WHERE email = ?1 AND purpose = ?2')
      .bind(email, purpose)
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
        .prepare('UPDATE email_codes SET attempts = ?1, locked_until = ?2 WHERE email = ?3 AND purpose = ?4')
        .bind(newAttempts, lockedUntil, email, purpose)
        .run()
      return json({ok: false, error: 'bad_code'}, {status: 400})
    }

    // Delete code so it can't be reused.
    await env.DB.prepare('DELETE FROM email_codes WHERE email = ?1 AND purpose = ?2').bind(email, purpose).run()

    // Return short-lived token proving the user verified their email recently.
    const verifiedToken = await signVerifiedToken({
      env,
      email,
      purpose,
      expMs: addMs(15 * 60 * 1000),
    })

    return json({ok: true, verifiedToken}, {status: 200})
  } catch (err) {
    console.error('/api/auth/verify threw', err)
    const message = err instanceof Error ? err.message : String(err)
    const lower = message.toLowerCase()
    if (lower.includes('no such table') || lower.includes('no such column')) {
      return json({ok: false, error: 'db_schema_out_of_date'}, {status: 500})
    }
    return json({ok: false, error: 'server_error'}, {status: 500})
  }
}
