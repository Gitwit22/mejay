import {grantsArtistPortalAccess} from '../../account/artist-access'
import {claimMarketplaceAccess, marketplaceRoleForUser, type MarketplaceRole} from '../../marketplace/staff-access'
import {getSessionUserId, normalizeAccessType} from '../_auth'

type Env = {
  DB: {
    prepare: (sql: string) => {
      bind: (...values: unknown[]) => {
        first: <T = Record<string, unknown>>() => Promise<T | null>
        run: () => Promise<unknown>
      }
    }
    transaction?: <T>(callback: (database: Env['DB']) => Promise<T>) => Promise<T>
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
      marketplaceRole?: MarketplaceRole
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

  const claimedAccess = await claimMarketplaceAccess(env.DB, userRow.id, userRow.email)

  const entRow = (await env.DB
    .prepare(
      `SELECT e.access_type, e.has_full_access, e.stripe_customer_id, e.stripe_subscription_id,
        e.subscription_status, e.billing_cadence, e.cancel_at_period_end, e.current_period_end,
        COALESCE(g.full_site_access, FALSE) AS full_site_access,
        COALESCE(g.artist_portal_access, FALSE) AS artist_portal_access
       FROM users u
       LEFT JOIN entitlements e ON e.user_id = u.id
       LEFT JOIN platform_access_grants g ON g.user_id = u.id
       WHERE u.id = ?1`,
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
      full_site_access: boolean
      artist_portal_access: boolean
    } | null

  const accessType = entRow ? normalizeAccessType(entRow.access_type) : 'free'
  const hasFullAccess = Boolean(entRow?.has_full_access) || entRow?.full_site_access === true
  const marketplaceRole = claimedAccess?.role ?? await marketplaceRoleForUser(env.DB, userId)
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
        accountIntent: claimedAccess?.protectedOwner || userRow.account_intent === 'provider' ? 'provider' : 'consumer',
      },
      entitlements: {
        accessType: hasFullAccess ? (entRow?.full_site_access ? 'full_program' : accessType as AccessType) : 'free',
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
      ...(marketplaceRole ? {marketplaceRole} : {}),
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
