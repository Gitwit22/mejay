type D1Database = any

type Env = {
  STRIPE_SECRET_KEY: string
  STRIPE_PRICE_PRO: string
  STRIPE_PRICE_FULL_PROGRAM: string
  CHECKOUT_VERIFY_MAX_AGE_SECONDS?: string
  DB: D1Database
  SESSION_PEPPER?: string
  RESEND_API_KEY?: string
  RESEND_FROM?: string
  // Fallback names (some hosting dashboards use these)
  EMAIL_FROM?: string
  FROM_EMAIL?: string
  MAIL_FROM?: string
}

type AccessType = 'free' | 'pro' | 'full_program'

type CheckoutStatusResponse = {
  accessType: AccessType
  hasFullAccess: boolean
  stripeCustomerId?: string
  stripeSubscriptionId?: string
}

type SessionPlan = 'pro' | 'full_program'

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
      expires: '0',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type, x-checkout-token',
      ...(init?.headers ?? {}),
    },
  })

function getRequiredEnv(env: Partial<Env>, key: keyof Env): string {
  const value = env[key]
  if (!value) throw new Error(`Missing env var: ${key}`)
  return value
}

async function stripeGet(secretKey: string, path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: {
      authorization: `Bearer ${secretKey}`,
    },
  })
  const text = await res.text()
  if (!res.ok) {
    let message = text.slice(0, 500)
    let code: string | undefined
    try {
      const parsed = JSON.parse(text) as any
      const parsedMessage = parsed?.error?.message
      if (typeof parsedMessage === 'string' && parsedMessage.trim()) {
        message = parsedMessage
      }
      const parsedCode = parsed?.error?.code
      if (typeof parsedCode === 'string' && parsedCode.trim()) {
        code = parsedCode
      }
    } catch {
      // ignore
    }
    const err = new Error(message) as Error & {status?: number; code?: string}
    err.status = res.status
    err.code = code
    throw err
  }
  return JSON.parse(text)
}

function getExpectedLivemode(secretKey: string): boolean {
  // Stripe secret keys are sk_test_... or sk_live_...
  return secretKey.startsWith('sk_live_')
}

function readMaxAgeSeconds(env: Partial<Env>): number {
  const raw = env.CHECKOUT_VERIFY_MAX_AGE_SECONDS
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  // Default: 30 minutes.
  return 30 * 60
}

async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input)
  const hashBuf = await crypto.subtle.digest('SHA-256', enc)
  return [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function parseCookies(req: Request) {
  const raw = req.headers.get('cookie') || ''
  const out: Record<string, string> = {}
  raw.split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=')
    if (!k) return
    out[k] = decodeURIComponent(v.join('=') || '')
  })
  return out
}

async function getSessionUserId(req: Request, env: Partial<Env>): Promise<string | null> {
  const cookies = parseCookies(req)
  const token = cookies['mejay_session']
  if (!token) return null

  const pepper = (env.SESSION_PEPPER || 'dev-session-pepper').trim() || 'dev-session-pepper'
  const tokenHash = await sha256Hex(`session:${token}:${pepper}`)
  const row = (await env.DB
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?1')
    .bind(tokenHash)
    .first()) as {user_id: string; expires_at: string} | null

  if (!row) return null
  if (row.expires_at < new Date().toISOString()) return null
  return row.user_id
}

function mapToDbAccessType(accessType: AccessType): 'free' | 'pro' | 'full' {
  if (accessType === 'pro') return 'pro'
  if (accessType === 'full_program') return 'full'
  return 'free'
}

async function sendFullProgramEmail(args: {env: Partial<Env>; to: string; downloadUrl: string; origin: string}) {
  const {env, to, downloadUrl, origin} = args
  const apiKey = (env.RESEND_API_KEY ?? '').trim()
  const from = (
    (env.RESEND_FROM ?? '').trim() ||
    (env.EMAIL_FROM ?? '').trim() ||
    (env.FROM_EMAIL ?? '').trim() ||
    (env.MAIL_FROM ?? '').trim()
  )
  if (!apiKey || !from) return

  const subject = 'Your MEJay Full Program download'
  const text = `Thanks for purchasing MEJay Full Program.\n\nDownload: ${downloadUrl}\n\nIf you have any issues, reply to this email or visit: ${origin}`
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.5; color: #111">
      <h2 style="margin:0 0 12px 0;">MEJay Full Program</h2>
      <p style="margin:0 0 12px 0;">Thanks for your purchase. Your download link is below:</p>
      <p style="margin:0 0 18px 0;"><a href="${downloadUrl}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;">Download Full Program</a></p>
      <p style="margin:0; font-size: 12px; color:#555;">If the button doesn’t work, copy/paste this URL: <br/>${downloadUrl}</p>
    </div>
  `.trim()

  await fetch('https://api.resend.com/emails', {
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
  }).catch(() => null)
}

async function wasAlreadyFullProgram(db: D1Database, userId: string): Promise<boolean> {
  const row = (await db
    .prepare('SELECT access_type, has_full_access FROM entitlements WHERE user_id = ?1 LIMIT 1')
    .bind(userId)
    .first()) as {access_type: string; has_full_access: number} | null
  if (!row) return false
  const hasFull = !!row.has_full_access
  const access = row.access_type
  return hasFull && (access === 'full' || access === 'full_program')
}

async function upsertEntitlementsInD1(args: {
  db: D1Database
  userId: string
  customerId: string | null
  email?: string | null
  subscriptionId?: string | null
  accessType: AccessType
  hasFullAccess: boolean
}): Promise<void> {
  const {db, userId, customerId, email, subscriptionId, accessType, hasFullAccess} = args

  // Never persist "free" as a result of a verification call.
  // (Avoid accidentally downgrading users if a session is incomplete or temporary.)
  if (!hasFullAccess) return
  if (accessType !== 'pro' && accessType !== 'full_program') return

  const effectiveUserId = await (async () => {
    // Ensure a user row exists for FK(user_id) even if email uniqueness collides.
    const byId = (await db.prepare('SELECT id FROM users WHERE id = ?1').bind(userId).first()) as {id: string} | null
    if (byId?.id) return userId

    if (email) {
      const byEmail = (await db.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first()) as {id: string} | null
      if (byEmail?.id) return byEmail.id
    }

    await db.prepare('INSERT INTO users (id, email) VALUES (?1, ?2)').bind(userId, email ?? `unknown+${userId}@example.invalid`).run()
    return userId
  })()
  const dbAccessType = mapToDbAccessType(accessType)
  const hasFull = hasFullAccess ? 1 : 0

  const statements = [
    db.prepare(
      [
        'INSERT INTO entitlements (user_id, access_type, has_full_access, stripe_customer_id, stripe_subscription_id, updated_at)',
        'VALUES (?1, ?2, ?3, ?4, ?5, (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')))',
        'ON CONFLICT(user_id) DO UPDATE SET',
        'access_type=excluded.access_type,',
        'has_full_access=excluded.has_full_access,',
        'stripe_customer_id=excluded.stripe_customer_id,',
        'stripe_subscription_id=excluded.stripe_subscription_id,',
        'updated_at=excluded.updated_at',
      ].join(' '),
    ).bind(effectiveUserId, dbAccessType, hasFull, customerId, subscriptionId ?? null),
  ]

  await db.batch(statements)
}

export const onRequest = async (context: {request: Request; env: Env}): Promise<Response> => {
  const {request, env} = context

  if (request.method === 'OPTIONS') return json({ok: true}, {status: 200})
  if (request.method !== 'GET') return json({error: 'Method not allowed'}, {status: 405})

  try {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('session_id') ?? ''

    // Basic shape validation to avoid accidentally proxying junk to Stripe.
    if (!sessionId) {
      return json({error: 'Missing session_id'}, {status: 400})
    }
    if (!sessionId.startsWith('cs_')) {
      return json({error: 'Invalid session_id'}, {status: 400})
    }

    const checkoutTokenHeader = (request.headers.get('x-checkout-token') ?? '').trim()

    const secretKey = getRequiredEnv(env, 'STRIPE_SECRET_KEY').trim()
    const pricePro = getRequiredEnv(env, 'STRIPE_PRICE_PRO').trim()
    const priceFull = getRequiredEnv(env, 'STRIPE_PRICE_FULL_PROGRAM').trim()

    const expectedLivemode = getExpectedLivemode(secretKey)
    const maxAgeSeconds = readMaxAgeSeconds(env)

    let session: any
    try {
      session = await stripeGet(secretKey, `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items&expand[]=subscription`)
    } catch (e) {
      const err = e as Error & {status?: number}
      const status = typeof err.status === 'number' ? err.status : 500
      if (status >= 400 && status < 500) {
        return json({error: 'Invalid session', message: err.message}, {status})
      }
      throw e
    }

    // Safety: ensure test/live environment matches the configured secret key.
    if (typeof session?.livemode === 'boolean' && session.livemode !== expectedLivemode) {
      return json({error: 'Session environment mismatch'}, {status: 400})
    }

    const metaPlanRaw = (session?.metadata?.plan ?? '') as string
    const metaPlan: SessionPlan | null =
      metaPlanRaw === 'pro' || metaPlanRaw === 'full_program' ? metaPlanRaw : null

    const metaUserIdRaw = (session?.metadata?.userId ?? '') as string
    const metaUserId = typeof metaUserIdRaw === 'string' && metaUserIdRaw.trim() ? metaUserIdRaw.trim() : null
    const refUserId = typeof session?.client_reference_id === 'string' && session.client_reference_id.trim() ? session.client_reference_id.trim() : null
    const userId = metaUserId ?? refUserId

    // Safety: bind verification to the initiating browser or to the logged-in user.
    // - checkoutToken (preferred) ties verification to the browser
    // - login-session ties verification to the authenticated user
    const metaToken = (session?.metadata?.checkoutToken ?? '') as string
    const hasMetaToken = typeof metaToken === 'string' && !!metaToken.trim()
    const tokenOk = hasMetaToken && !!checkoutTokenHeader && checkoutTokenHeader === metaToken
    const sessionOk = userId ? (await getSessionUserId(request, env).catch(() => null)) === userId : false

    if (hasMetaToken && !tokenOk && !sessionOk) {
      return json({error: 'Session token mismatch'}, {status: 403})
    }

    // Safety: expire ability to verify old sessions.
    const created = typeof session?.created === 'number' ? session.created : null
    if (created) {
      const now = Math.floor(Date.now() / 1000)
      if (now - created > maxAgeSeconds) {
        // If the request is properly bound (token or login session), allow verification
        // even if the checkout session is old.
        if (!tokenOk && !sessionOk) {
          return json({error: 'Session verification expired'}, {status: 410})
        }
      }
    }

    // Prefer session metadata written at session creation time.

    let accessType: AccessType = 'free'
    if (metaPlan) {
      accessType = metaPlan
    } else {
      const lineItems = session?.line_items?.data as Array<{price?: {id?: string}}> | undefined
      const priceId = lineItems?.[0]?.price?.id
      accessType = priceId === priceFull ? 'full_program' : priceId === pricePro ? 'pro' : 'free'
    }

    if (accessType === 'full_program') {
      const paid = session?.payment_status === 'paid'

      const customerId = typeof session?.customer === 'string' ? session.customer : null
      const email = (session?.customer_details?.email ?? session?.customer_email ?? null) as string | null

      const origin = `${url.protocol}//${url.host}`
      const downloadUrl = `${origin}/api/download/full-program`
      const alreadyHadFull = userId ? await wasAlreadyFullProgram(env.DB, userId) : false

      if (userId) {
        try {
          await upsertEntitlementsInD1({
            db: env.DB,
            userId,
            customerId,
            email,
            subscriptionId: null,
            accessType: 'full_program',
            hasFullAccess: !!paid,
          })

          // Send fulfillment email once, when entitlement first becomes active.
          if (!!paid && !alreadyHadFull && email) {
            void sendFullProgramEmail({env, to: email, downloadUrl, origin})
          }
        } catch {
          // Best-effort persistence; never fail verification because D1 is down.
        }
      }

      return json({
        accessType: paid ? 'full_program' : 'free',
        hasFullAccess: !!paid,
        ...(customerId ? {stripeCustomerId: customerId} : {}),
      } satisfies CheckoutStatusResponse)
    }

    if (accessType === 'pro') {
      const sub = session?.subscription
      const status: string | undefined = sub?.status
      const active = status === 'active' || status === 'trialing'

      const subscriptionId = typeof sub?.id === 'string' ? sub.id : null
      const customerId =
        typeof session?.customer === 'string'
          ? session.customer
          : typeof sub?.customer === 'string'
            ? sub.customer
            : null
      const email = (session?.customer_details?.email ?? session?.customer_email ?? null) as string | null

      if (userId) {
        try {
          await upsertEntitlementsInD1({
            db: env.DB,
            userId,
            customerId,
            email,
            subscriptionId,
            accessType: 'pro',
            hasFullAccess: !!active,
          })
        } catch {
          // Best-effort persistence; never fail verification because D1 is down.
        }
      }

      return json({
        accessType: active ? 'pro' : 'free',
        hasFullAccess: !!active,
        ...(customerId ? {stripeCustomerId: customerId} : {}),
        ...(subscriptionId ? {stripeSubscriptionId: subscriptionId} : {}),
      } satisfies CheckoutStatusResponse)
    }

    return json({accessType: 'free', hasFullAccess: false} satisfies CheckoutStatusResponse)
  } catch (e) {
    return json(
      {
        error: 'Status check failed',
        message: e instanceof Error ? e.message : 'Unknown error',
      },
      {status: 500},
    )
  }
}
