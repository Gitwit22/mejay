import {grantsArtistPortalAccess} from '../../account/artist-access'
import {getSessionUserId, normalizeAccessType} from '../_auth'

type Env = {
  DB: {
    prepare: (sql: string) => {
      bind: (...values: unknown[]) => {
        first: <T = Record<string, unknown>>() => Promise<T | null>
      }
    }
  }
  SESSION_PEPPER?: string
}

type AccessType = 'free' | 'pro' | 'full_program'

type AccountMeResponse =
  | {
      ok: true
      user: {id: string; email: string; createdAt?: string | null; accountIntent: 'consumer' | 'provider'}
      entitlements: {
        accessType: AccessType
        hasFullAccess: boolean
        artistPortalAccess: boolean
        stripeCustomerId?: string
        subscriptionStatus?: string
        billingCadence?: 'monthly' | 'yearly'
        cancelAtPeriodEnd: boolean
        currentPeriodEnd?: string
      }
      provider?: {
        id: string
        status: string
        role: string
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
    .prepare('SELECT id, email, created_at, account_intent FROM users WHERE id = ?1')
    .bind(userId)
    .first()) as {id: string; email: string; created_at: string | null; account_intent: string | null} | null

  if (!userRow) return json({ok: false, error: 'unauthorized'}, {status: 401})

  const entRow = (await env.DB
    .prepare(
      'SELECT access_type, has_full_access, stripe_customer_id, stripe_subscription_id, subscription_status, billing_cadence, cancel_at_period_end, current_period_end FROM entitlements WHERE user_id = ?1',
    )
    .bind(userId)
    .first()) as {
      access_type: string
      has_full_access: number
      stripe_customer_id: string | null
      stripe_subscription_id: string | null
      subscription_status: string | null
      billing_cadence: string | null
      cancel_at_period_end: boolean
      current_period_end: string | null
    } | null

  const accessType = entRow ? normalizeAccessType(entRow.access_type) : 'free'
  const hasFullAccess = entRow ? Boolean(entRow.has_full_access) : false
  const providerRow = (await env.DB
    .prepare(
      [
        'SELECT p.id AS provider_id, p.status AS provider_status, pm.role AS provider_role',
        'FROM provider_members pm',
        'INNER JOIN provider_profiles p ON p.id = pm.provider_profile_id',
        'WHERE pm.user_id = ?1',
        'LIMIT 1',
      ].join(' '),
    )
    .bind(userId)
    .first()) as {provider_id: string; provider_status: string; provider_role: string} | null

  return json(
    {
      ok: true,
      user: {
        id: userRow.id,
        email: userRow.email,
        createdAt: userRow.created_at,
        accountIntent: userRow.account_intent === 'provider' ? 'provider' : 'consumer',
      },
      entitlements: {
        accessType: hasFullAccess ? (accessType as AccessType) : 'free',
        hasFullAccess: hasFullAccess,
        artistPortalAccess: grantsArtistPortalAccess(entRow),
        ...(entRow?.stripe_customer_id ? {stripeCustomerId: entRow.stripe_customer_id} : {}),
        ...(entRow?.subscription_status ? {subscriptionStatus: entRow.subscription_status} : {}),
        ...(entRow?.billing_cadence === 'monthly' || entRow?.billing_cadence === 'yearly'
          ? {billingCadence: entRow.billing_cadence}
          : {}),
        cancelAtPeriodEnd: entRow?.cancel_at_period_end === true,
        ...(entRow?.current_period_end ? {currentPeriodEnd: entRow.current_period_end} : {}),
      },
      ...(providerRow
        ? {
            provider: {
              id: providerRow.provider_id,
              status: providerRow.provider_status,
              role: providerRow.provider_role,
            },
          }
        : {}),
    },
    {status: 200},
  )
}
