import {getSessionUserId} from '../_auth'

type D1Database = any

type Env = {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_PRICE_PRO: string
  STRIPE_PRICE_FULL_PROGRAM: string
}

type AccessType = 'free' | 'pro' | 'full_program'

type SyncRequestBody = {
  sessionId?: string
}

type SyncResponse = {
  ok: true
  accessType: AccessType
  hasFullAccess: boolean
  stripeCustomerId?: string
  stripeSubscriptionId?: string
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
      expires: '0',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      ...(init?.headers ?? {}),
    },
  })

function getRequiredEnv(env: Partial<Env>, key: keyof Env): string {
  const value = env[key]
  if (!value) throw new Error(`Missing env var: ${key}`)
  return String(value)
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
      if (typeof parsedMessage === 'string' && parsedMessage.trim()) {
        message = parsedMessage
      }
    } catch {
      // ignore
    }
    const err = new Error(message) as Error & {status?: number}
    err.status = res.status
    throw err
  }
  return JSON.parse(text)
}

function mapToDbAccessType(accessType: AccessType): 'free' | 'pro' | 'full' {
  if (accessType === 'pro') return 'pro'
  if (accessType === 'full_program') return 'full'
  return 'free'
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

  // Never persist "free" as a result of a sync call.
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

function normalizeSessionPlan(raw: unknown): AccessType | null {
  if (raw === 'pro') return 'pro'
  if (raw === 'full_program') return 'full_program'
  return null
}

export const onRequest = async (context: {request: Request; env: Env}): Promise<Response> => {
  const {request, env} = context

  if (request.method === 'OPTIONS') return json({ok: true}, {status: 200})
  if (request.method !== 'POST') return json({error: 'Method not allowed'}, {status: 405})

  const userId = await getSessionUserId(request, env as any)
  if (!userId) return json({error: 'Unauthorized'}, {status: 401})

  let body: SyncRequestBody
  try {
    body = (await request.json()) as SyncRequestBody
  } catch {
    return json({error: 'Invalid JSON'}, {status: 400})
  }

  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) return json({error: 'Missing sessionId'}, {status: 400})
  if (!sessionId.startsWith('cs_')) return json({error: 'Invalid sessionId'}, {status: 400})

  try {
    const secretKey = getRequiredEnv(env, 'STRIPE_SECRET_KEY').trim()
    const pricePro = getRequiredEnv(env, 'STRIPE_PRICE_PRO').trim()
    const priceFull = getRequiredEnv(env, 'STRIPE_PRICE_FULL_PROGRAM').trim()

    const session = await stripeGet(
      secretKey,
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items&expand[]=subscription`,
    )

    const metaUserIdRaw = (session?.metadata?.userId ?? '') as string
    const metaUserId = typeof metaUserIdRaw === 'string' && metaUserIdRaw.trim() ? metaUserIdRaw.trim() : null
    const refUserId = typeof session?.client_reference_id === 'string' && session.client_reference_id.trim() ? session.client_reference_id.trim() : null
    const boundUserId = metaUserId ?? refUserId
    if (!boundUserId) return json({error: 'Session missing user binding'}, {status: 400})
    if (boundUserId !== userId) return json({error: 'Session does not match current user'}, {status: 403})

    const email = (session?.customer_details?.email ?? session?.customer_email ?? null) as string | null
    const customerId = typeof session?.customer === 'string' ? session.customer : null

    const metaPlan = normalizeSessionPlan(session?.metadata?.plan)
    const inferredPlan = (() => {
      const lineItems = session?.line_items?.data as Array<{price?: {id?: string}}> | undefined
      const priceId = lineItems?.[0]?.price?.id
      if (priceId === priceFull) return 'full_program' as const
      if (priceId === pricePro) return 'pro' as const
      return null
    })()
    const plan: AccessType | null = metaPlan ?? inferredPlan
    if (!plan) return json({error: 'Could not determine plan'}, {status: 400})

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

      const out: SyncResponse = {
        ok: true,
        accessType: paid ? 'full_program' : 'free',
        hasFullAccess: !!paid,
        ...(customerId ? {stripeCustomerId: customerId} : {}),
      }
      return json(out, {status: 200})
    }

    const sub = session?.subscription
    const status: string | undefined = sub?.status
    const active = status === 'active' || status === 'trialing'
    const subscriptionId = typeof sub?.id === 'string' ? sub.id : null
    const effectiveCustomerId =
      customerId ?? (typeof sub?.customer === 'string' ? sub.customer : null)

    if (active) {
      await upsertEntitlementsInD1({
        db: env.DB,
        userId,
        customerId: effectiveCustomerId,
        email,
        subscriptionId,
        accessType: 'pro',
        hasFullAccess: true,
      })
    }

    const out: SyncResponse = {
      ok: true,
      accessType: active ? 'pro' : 'free',
      hasFullAccess: !!active,
      ...(effectiveCustomerId ? {stripeCustomerId: effectiveCustomerId} : {}),
      ...(subscriptionId ? {stripeSubscriptionId: subscriptionId} : {}),
    }
    return json(out, {status: 200})
  } catch (e) {
    const err = e as Error & {status?: number}
    const status = typeof err.status === 'number' ? err.status : 500
    if (status >= 400 && status < 500) {
      return json({error: 'Invalid session', message: err.message}, {status})
    }
    return json({error: 'Sync failed', message: err.message || 'Unknown error'}, {status: 500})
  }
}
