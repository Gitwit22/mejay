import {getSessionUserId, normalizeAccessType} from '../_auth'

type Env = {
  DB: any
  SESSION_PEPPER?: string
}

type AccessType = 'free' | 'pro' | 'full_program'

type AccountMeResponse =
  | {
      ok: true
      user: {id: string; email: string; createdAt?: string | null}
      entitlements: {
        accessType: AccessType
        hasFullAccess: boolean
        stripeCustomerId?: string
        subscriptionStatus?: string
        billingCadence?: 'monthly' | 'yearly'
        cancelAtPeriodEnd: boolean
        currentPeriodEnd?: string
      }
    }
  | {ok: false; error: 'unauthorized'}

const json = (body: AccountMeResponse, init?: ResponseInit) =>
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

  if (request.method !== 'GET') return json({ok: false, error: 'unauthorized'}, {status: 405})

  const userId = await getSessionUserId(request, env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})

  const userRow = (await env.DB
    .prepare('SELECT id, email, created_at FROM users WHERE id = ?1')
    .bind(userId)
    .first()) as {id: string; email: string; created_at: string | null} | null

  if (!userRow) return json({ok: false, error: 'unauthorized'}, {status: 401})

  const entRow = (await env.DB
    .prepare(
      'SELECT access_type, has_full_access, stripe_customer_id, subscription_status, billing_cadence, cancel_at_period_end, current_period_end FROM entitlements WHERE user_id = ?1',
    )
    .bind(userId)
    .first()) as {
      access_type: string
      has_full_access: number
      stripe_customer_id: string | null
      subscription_status: string | null
      billing_cadence: string | null
      cancel_at_period_end: boolean
      current_period_end: string | null
    } | null

  const accessType = entRow ? normalizeAccessType(entRow.access_type) : 'free'
  const hasFullAccess = entRow ? Boolean(entRow.has_full_access) : false

  return json(
    {
      ok: true,
      user: {id: userRow.id, email: userRow.email, createdAt: userRow.created_at},
      entitlements: {
        accessType: hasFullAccess ? (accessType as AccessType) : 'free',
        hasFullAccess: hasFullAccess,
        ...(entRow?.stripe_customer_id ? {stripeCustomerId: entRow.stripe_customer_id} : {}),
        ...(entRow?.subscription_status ? {subscriptionStatus: entRow.subscription_status} : {}),
        ...(entRow?.billing_cadence === 'monthly' || entRow?.billing_cadence === 'yearly'
          ? {billingCadence: entRow.billing_cadence}
          : {}),
        cancelAtPeriodEnd: entRow?.cancel_at_period_end === true,
        ...(entRow?.current_period_end ? {currentPeriodEnd: entRow.current_period_end} : {}),
      },
    },
    {status: 200},
  )
}
