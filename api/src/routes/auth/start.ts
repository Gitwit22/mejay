import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  addMsIso,
  normalizeEmail,
  nowIso,
  random6DigitCode,
  readJson,
  sha256Hex,
} from '../_auth'
import {applyRateLimit, getClientIp, isDevEnvironment} from '../_security'

type Purpose = 'signup_verify' | 'password_reset'

type Env = {
  DB: any
  AUTH_CODE_PEPPER?: string
  NODE_ENV?: string
  // Optional safety switch: allow dev-only behavior (returning codes) outside development.
  ALLOW_DEV_ENDPOINTS?: string

  // Email (Resend) for login codes
  RESEND_API_KEY?: string
  RESEND_FROM?: string
  // Fallback names (some hosting dashboards use these)
  EMAIL_FROM?: string
  FROM_EMAIL?: string
  MAIL_FROM?: string
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

function parsePurpose(raw: unknown): Purpose {
  if (raw === 'password_reset') return 'password_reset'
  return 'signup_verify'
}

/** Max codes issued per email+purpose per hour, independent of caller IP. */
const MAX_CODES_PER_EMAIL_PER_HOUR = 5

async function sendLoginCodeEmail(args: {env: Env; to: string; code: string; origin: string}) {
  const {env, to, code, origin} = args

  const resolveFrom = () => {
    const candidates: Array<[key: string, value: string]> = [
      ['RESEND_FROM', (env.RESEND_FROM ?? '').trim()],
      ['EMAIL_FROM', (env.EMAIL_FROM ?? '').trim()],
      ['FROM_EMAIL', (env.FROM_EMAIL ?? '').trim()],
      ['MAIL_FROM', (env.MAIL_FROM ?? '').trim()],
    ]
    const chosen = candidates.find(([, v]) => !!v)
    return {
      from: chosen?.[1] ?? '',
      fromKey: chosen?.[0] ?? null,
      checkedKeys: candidates.map(([k]) => k),
      presentByKey: Object.fromEntries(candidates.map(([k, v]) => [k, !!v])) as Record<string, boolean>,
    }
  }

  const apiKey = (env.RESEND_API_KEY ?? '').trim()
  const fromInfo = resolveFrom()
  const from = fromInfo.from
  if (!apiKey || !from) {
    return {
      sent: false as const,
      reason: 'resend_not_configured' as const,
      details: {
        apiKeyPresent: !!apiKey,
        fromPresent: !!from,
        fromKeyUsed: fromInfo.fromKey,
        fromKeysChecked: fromInfo.checkedKeys,
        fromPresentByKey: fromInfo.presentByKey,
      },
    }
  }

  const subject = 'Your MEJay code'
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

  try {
    const body = await readJson(request)
    const emailRaw = String((body as any).email || '')
    const email = normalizeEmail(emailRaw)
    const purpose = parsePurpose((body as any).purpose)

    if (!email || !email.includes('@')) {
      return json({ok: false, error: 'invalid_email'}, {status: 400})
    }

    const ipLimit = await applyRateLimit({db: env.DB, key: getClientIp(request), purpose, kind: 'start', maxPerWindow: 8})
    if (!ipLimit.ok) {
      return json({ok: false, error: 'rate_limited'}, {status: 429})
    }
    const emailLimit = await applyRateLimit({
      db: env.DB,
      key: `email:${email}`,
      purpose,
      kind: 'start',
      maxPerWindow: MAX_CODES_PER_EMAIL_PER_HOUR,
      windowSeconds: 60 * 60,
    })
    if (!emailLimit.ok) {
      return json({ok: false, error: 'rate_limited'}, {status: 429})
    }

    const existing = (await env.DB
      .prepare('SELECT attempts, locked_until FROM email_codes WHERE email = ?1 AND purpose = ?2')
      .bind(email, purpose)
      .first()) as {attempts: number; locked_until: string | null} | null

    if (existing?.locked_until && existing.locked_until > nowIso()) {
      return json({ok: false, error: 'locked'}, {status: 429})
    }

    // Failed-attempt counters carry over to the new code so reissuing a code can't be used to
    // reset the guess budget. They only reset once a lockout has fully expired.
    const lockExpired = Boolean(existing?.attempts && existing.attempts >= MAX_ATTEMPTS)
      && (!existing?.locked_until || existing.locked_until <= nowIso())
    const carriedAttempts = lockExpired ? 0 : Number(existing?.attempts ?? 0)

    const code = random6DigitCode()
    const pepper = env.AUTH_CODE_PEPPER || 'dev-pepper-change-me'
    const codeHash = await sha256Hex(`${email}:${code}:${pepper}`)

    await env.DB
      .prepare(
        [
          'INSERT INTO email_codes (email, purpose, code_hash, expires_at, attempts, locked_until)',
          'VALUES (?1, ?2, ?3, ?4, ?5, NULL)',
          'ON CONFLICT(email, purpose) DO UPDATE SET',
          'code_hash = excluded.code_hash,',
          'expires_at = excluded.expires_at,',
          'attempts = excluded.attempts,',
          'locked_until = NULL',
        ].join(' '),
      )
      .bind(email, purpose, codeHash, addMsIso(CODE_TTL_MS), carriedAttempts)
      .run()

    const allowDevReturn = isDevEnvironment(env)

    const origin = new URL(request.url).origin
    const sent = await sendLoginCodeEmail({env, to: email, code, origin})
    if (!sent.sent && !allowDevReturn) {
      // Don't leak the code if we couldn't email it.
      return json({ok: false, error: sent.reason ?? 'email_failed', ...(sent.details ? {resend: sent.details} : {})}, {status: 500})
    }

    return json({ok: true, ...(allowDevReturn ? {devCode: code} : {})}, {status: 200})
  } catch (err) {
    console.error('/api/auth/start threw', err)
    const message = err instanceof Error ? err.message : String(err)
    const lower = message.toLowerCase()
    if (lower.includes('no such table') || lower.includes('no such column')) {
      return json({ok: false, error: 'db_schema_out_of_date'}, {status: 500})
    }
    return json({ok: false, error: 'server_error'}, {status: 500})
  }

  // Fallback (should be unreachable).
  return json({ok: false, error: 'server_error'}, {status: 500})
}
