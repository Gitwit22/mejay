import {cadenceFromPrice, persistSubscriptionState, stripeTimestampToIso, type SubscriptionState} from '../services/billing'
import {CommerceService} from '../marketplace/commerce-service'
import {ConnectService} from '../marketplace/connect-service'

type D1Database = any

type Env = {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  STRIPE_PRICE_PRO: string
  STRIPE_PRICE_YEARLY: string
  MARKETPLACE_PLATFORM_FEE_BPS?: string
}

type AccessType = 'free' | 'pro' | 'full_program'

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
      expires: '0',
      ...(init?.headers ?? {}),
    },
  })
}

function getRequiredEnv(env: Partial<Env>, key: keyof Env): string {
  const value = env[key]
  if (!value) throw new Error(`Missing env var: ${key}`)
  return String(value)
}

function mapToDbAccessType(accessType: AccessType): 'free' | 'pro' | 'full' {
  if (accessType === 'pro') return 'pro'
  if (accessType === 'full_program') return 'full'
  return 'free'
}

async function stripeGet(secretKey: string, path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: {authorization: `Bearer ${secretKey}`},
  })
  const text = await res.text()
  if (!res.ok) {
    let message = text.slice(0, 500)
    try {
      const parsed = JSON.parse(text) as any
      const parsedMessage = parsed?.error?.message
      if (typeof parsedMessage === 'string' && parsedMessage.trim()) message = parsedMessage
    } catch {
      // ignore
    }
    const err = new Error(message) as Error & {status?: number}
    err.status = res.status
    throw err
  }
  return JSON.parse(text)
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

  // Never persist "free" from Stripe events.
  if (!hasFullAccess) return
  if (accessType !== 'pro' && accessType !== 'full_program') return

  const effectiveUserId = await (async () => {
    const byId = (await db.prepare('SELECT id FROM users WHERE id = ?1').bind(userId).first()) as {id: string} | null
    if (byId?.id) return userId

    if (email) {
      const byEmail = (await db.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first()) as {id: string} | null
      if (byEmail?.id) return byEmail.id
    }

    await db
      .prepare('INSERT INTO users (id, email) VALUES (?1, ?2)')
      .bind(userId, email ?? `unknown+${userId}@example.invalid`)
      .run()
    return userId
  })()

  const dbAccessType = mapToDbAccessType(accessType)
  const hasFull = hasFullAccess ? 1 : 0

  const stmt = db
    .prepare(
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
    )
    .bind(effectiveUserId, dbAccessType, hasFull, customerId, subscriptionId ?? null)

  await db.batch([stmt])
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i]
  return out === 0
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function parseStripeSignatureHeader(header: string): {timestamp: string | null; signatures: string[]} {
  const parts = header
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  let t: string | null = null
  const v1: string[] = []
  for (const p of parts) {
    const idx = p.indexOf('=')
    if (idx <= 0) continue
    const k = p.slice(0, idx)
    const v = p.slice(idx + 1)
    if (k === 't') t = v
    if (k === 'v1') v1.push(v)
  }
  return {timestamp: t, signatures: v1}
}

async function verifyStripeWebhook(args: {payload: string; header: string; secret: string}): Promise<boolean> {
  const {payload, header, secret} = args
  const parsed = parseStripeSignatureHeader(header)
  if (!parsed.timestamp || parsed.signatures.length === 0) return false

  // Reject replays outside Stripe's recommended tolerance (default 5 minutes).
  // https://stripe.com/docs/webhooks/signatures
  const ts = Number(parsed.timestamp)
  if (!Number.isFinite(ts) || ts <= 0) return false
  const now = Math.floor(Date.now() / 1000)
  const toleranceSeconds = 5 * 60
  if (Math.abs(now - ts) > toleranceSeconds) return false

  const signedPayload = `${parsed.timestamp}.${payload}`
  const expected = (await hmacSha256Hex(secret, signedPayload)).toLowerCase()
  const expectedBytes = new TextEncoder().encode(expected)
  for (const sig of parsed.signatures) {
    const sigBytes = new TextEncoder().encode(String(sig).toLowerCase())
    if (timingSafeEqual(expectedBytes, sigBytes)) return true
  }
  return false
}

function getUserIdFromMetadata(meta: any): string | null {
  const raw = meta?.userId
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed ? trimmed : null
}

function getPlanFromMetadata(meta: any): AccessType | null {
  const raw = meta?.plan
  if (raw === 'pro') return 'pro'
  if (raw === 'full_program') return 'full_program'
  return null
}

function subscriptionState(sub: any, env: Env): SubscriptionState {
  const priceId = sub?.items?.data?.[0]?.price?.id
  return {
    status: typeof sub?.status === 'string' ? sub.status : 'canceled',
    cancelAtPeriodEnd: sub?.cancel_at_period_end === true,
    currentPeriodEnd: stripeTimestampToIso(sub?.current_period_end),
    cadence: cadenceFromPrice(priceId, env.STRIPE_PRICE_PRO, env.STRIPE_PRICE_YEARLY),
  }
}

async function subscriptionUserId(db: D1Database, sub: any): Promise<string | null> {
  const metadataUserId = getUserIdFromMetadata(sub?.metadata)
  if (metadataUserId) return metadataUserId

  const subscriptionId = typeof sub?.id === 'string' ? sub.id : ''
  if (!subscriptionId) return null
  const row = (await db
    .prepare('SELECT user_id FROM entitlements WHERE stripe_subscription_id = ?1 LIMIT 1')
    .bind(subscriptionId)
    .first()) as {user_id: string} | null
  return row?.user_id ?? null
}

export const onRequest = async (context: {request: Request; env: Env}): Promise<Response> => {
  const {request, env} = context

  if (request.method === 'OPTIONS') return json({ok: true}, {status: 200})
  if (request.method !== 'POST') return json({error: 'Method not allowed'}, {status: 405})

  try {
    const secretKey = getRequiredEnv(env, 'STRIPE_SECRET_KEY').trim()
    const webhookSecret = getRequiredEnv(env, 'STRIPE_WEBHOOK_SECRET').trim()

    const sigHeader = request.headers.get('stripe-signature') ?? ''
    const payload = await request.text()

    const ok = await verifyStripeWebhook({payload, header: sigHeader, secret: webhookSecret})
    if (!ok) return json({error: 'Invalid signature'}, {status: 400})

    const event = JSON.parse(payload) as any
    const type = String(event?.type ?? '')
    const obj = event?.data?.object
    const eventCreatedAt = stripeTimestampToIso(event?.created) ?? new Date().toISOString()

    if (type === 'account.updated' && typeof obj?.id === 'string') {
      await new ConnectService(env.DB, secretKey).syncAccount(obj)
      return json({ok: true})
    }

    if (type === 'checkout.session.completed') {
      const session = obj
      const meta = session?.metadata
      if (meta?.kind === 'marketplace_purchase') {
        if (session?.payment_status !== 'paid') return json({ok: true, ignored: true})
        const result = await new CommerceService(env.DB, secretKey, Number(env.MARKETPLACE_PLATFORM_FEE_BPS || 1000)).fulfillPaidSession(session)
        return json({ok: true, orderId: result.orderId})
      }
      const userId = getUserIdFromMetadata(meta)
      const plan = getPlanFromMetadata(meta)

      if (!userId || !plan) {
        // Still return 200 so Stripe doesn't retry forever; log for debugging.
        console.warn('[stripe-webhook] Missing metadata', {type, userId, plan})
        return json({ok: true, ignored: true})
      }

      const customerId = typeof session?.customer === 'string' ? session.customer : null
      const email = (session?.customer_details?.email ?? session?.customer_email ?? null) as string | null

      if (plan === 'full_program') {
        const paid = session?.payment_status === 'paid'
        if (paid) {
          await upsertEntitlementsInD1({
            db: env.DB,
            userId,
            customerId,
            email,
            subscriptionId: null,
            accessType: 'full_program',
            hasFullAccess: true,
          })
        }
        return json({ok: true})
      }

      if (plan === 'pro') {
        const subId = typeof session?.subscription === 'string' ? session.subscription : null
        if (!subId) return json({ok: true, ignored: true})

        const sub = await stripeGet(secretKey, `/v1/subscriptions/${encodeURIComponent(subId)}`)
        await persistSubscriptionState({
          db: env.DB,
          userId,
          customerId: customerId ?? (typeof sub?.customer === 'string' ? sub.customer : null),
          subscriptionId: subId,
          state: subscriptionState(sub, env),
          eventCreatedAt,
        })
        return json({ok: true})
      }

      return json({ok: true, ignored: true})
    }

    if (type === 'checkout.session.async_payment_succeeded' && obj?.metadata?.kind === 'marketplace_purchase') {
      const result = await new CommerceService(env.DB, secretKey, Number(env.MARKETPLACE_PLATFORM_FEE_BPS || 1000)).fulfillPaidSession(obj)
      return json({ok: true, orderId: result.orderId})
    }

    if (type === 'charge.refunded') {
      await new CommerceService(env.DB, secretKey, Number(env.MARKETPLACE_PLATFORM_FEE_BPS || 1000)).handleRefund(obj)
      return json({ok: true})
    }

    if (type === 'charge.dispute.created') {
      await new CommerceService(env.DB, secretKey, Number(env.MARKETPLACE_PLATFORM_FEE_BPS || 1000)).handleDispute(obj, true)
      return json({ok: true})
    }

    if (type === 'charge.dispute.closed') {
      await new CommerceService(env.DB, secretKey, Number(env.MARKETPLACE_PLATFORM_FEE_BPS || 1000)).handleDispute(obj, false)
      return json({ok: true})
    }

    if (type === 'customer.subscription.updated' || type === 'customer.subscription.created') {
      const sub = obj
      const userId = await subscriptionUserId(env.DB, sub)
      const plan = getPlanFromMetadata(sub?.metadata)
      if (!userId || plan !== 'pro') return json({ok: true, ignored: true})

      const customerId = typeof sub?.customer === 'string' ? sub.customer : null
      const subId = typeof sub?.id === 'string' ? sub.id : null

      await persistSubscriptionState({
        db: env.DB,
        userId,
        customerId,
        subscriptionId: subId,
        state: subscriptionState(sub, env),
        eventCreatedAt,
      })

      return json({ok: true})
    }

    if (type === 'customer.subscription.deleted') {
      const sub = obj
      const userId = await subscriptionUserId(env.DB, sub)
      if (!userId) return json({ok: true, ignored: true})

      await persistSubscriptionState({
        db: env.DB,
        userId,
        customerId: typeof sub?.customer === 'string' ? sub.customer : null,
        subscriptionId: typeof sub?.id === 'string' ? sub.id : null,
        state: {...subscriptionState(sub, env), status: 'canceled'},
        eventCreatedAt,
      })
      return json({ok: true})
    }

    return json({ok: true, ignored: true})
  } catch (e) {
    console.error('[stripe-webhook] Handler failed', e)
    // 500 triggers retry by Stripe.
    return json({error: 'Webhook error'}, {status: 500})
  }
}
