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
  // Optional safety switch: allow dev-only behavior outside localhost.
  ALLOW_DEV_ENDPOINTS?: string

  // Email (Resend) for login codes
  RESEND_API_KEY?: string
  RESEND_FROM?: string
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

async function sendLoginCodeEmail(args: {env: Env; to: string; code: string; origin: string}) {
  const {env, to, code, origin} = args

  const apiKey = (env.RESEND_API_KEY ?? '').trim()
  const from = (env.RESEND_FROM ?? '').trim()
  if (!apiKey || !from) {
    return {
      sent: false as const,
      reason: 'resend_not_configured' as const,
      details: {
        apiKeyPresent: !!apiKey,
        fromPresent: !!from,
      },
    }
  }

  const subject = 'Your MEJay sign-in code'
  const text = `Your MEJay sign-in code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn’t request this, you can ignore this email.\n\n${origin}`
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.5; color: #111">
      <h2 style="margin:0 0 12px 0;">MEJay sign-in</h2>
      <p style="margin:0 0 12px 0;">Your 6-digit code:</p>
      <div style="display:inline-block; padding:12px 16px; border-radius:12px; background:#111; color:#fff; font-size:22px; letter-spacing:6px; font-weight:800;">${code}</div>
      <p style="margin:12px 0 0 0; font-size:12px; color:#555;">Expires in 10 minutes. If you didn’t request this, you can ignore this email.</p>
      <p style="margin:12px 0 0 0; font-size:12px; color:#555;">${origin}</p>
    </div>
  `.trim()

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        text,
        html,
      }),
    })

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      const details = bodyText.slice(0, 4000)
      console.error('Resend sendLoginCodeEmail failed', res.status, details)
      return {
        sent: false as const,
        reason: 'resend_failed' as const,
        details: {
          status: res.status,
          body: details,
        },
      }
    }

    return {sent: true as const}
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Resend sendLoginCodeEmail threw', err)
    return {
      sent: false as const,
      reason: 'resend_failed' as const,
      details: {
        message,
      },
    }
  }
}

export const onRequest = async (ctx: {request: Request; env: Env}): Promise<Response> => {
  const {request, env} = ctx

  if (request.method !== 'POST') return json({ok: false, error: 'Method not allowed'}, {status: 405})

  if (!env.DB) {
    console.error('/api/auth/start missing DB binding')
    return json({ok: false, error: 'db_not_configured'}, {status: 500})
  }

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

  const allowDevReturn = isLocalHost(request) || env.ALLOW_DEV_ENDPOINTS === 'true'

  const origin = new URL(request.url).origin
  const sent = await sendLoginCodeEmail({env, to: email, code, origin})
  if (!sent.sent && !allowDevReturn) {
    // Don't leak the code if we couldn't email it.
    return json(
      {
        ok: false,
        error: sent.reason ?? 'email_failed',
        ...(sent.reason === 'resend_failed' || sent.reason === 'resend_not_configured'
          ? {resend: (sent as any).details}
          : null),
      },
      {status: 500},
    )
  }

  return json({ok: true, ...(allowDevReturn ? {devCode: code} : {})}, {status: 200})
}
