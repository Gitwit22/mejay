import {grantsArtistPortalAccess, type ArtistAccessEntitlement} from '../../account/artist-access'
import {bootstrapProviderAccount} from '../../marketplace/onboarding'
import {getSessionUserId, nowIso} from '../_auth'

type Context = {
  request: Request
  env: {
    DB: any
    SESSION_PEPPER?: string
  }
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      ...(init?.headers ?? {}),
    },
  })
}

export const onRequest = async ({request, env}: Context): Promise<Response> => {
  if (request.method !== 'POST') return json({ok: false, error: 'method_not_allowed'}, {status: 405})

  const userId = await getSessionUserId(request, env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})

  try {
    const provider = await env.DB.transaction(async (db: any) => {
      const user = (await db
        .prepare('SELECT id FROM users WHERE id = ?1 FOR UPDATE')
        .bind(userId)
        .first()) as {id: string} | null
      if (!user) return null

      const entitlement = (await db
        .prepare('SELECT stripe_subscription_id, subscription_status FROM entitlements WHERE user_id = ?1 FOR UPDATE')
        .bind(userId)
        .first()) as ArtistAccessEntitlement | null
      if (!grantsArtistPortalAccess(entitlement)) return false

      const updatedAt = nowIso()
      await db.prepare("UPDATE users SET account_intent = 'provider', updated_at = ?1 WHERE id = ?2").bind(updatedAt, userId).run()
      await bootstrapProviderAccount({db, userId, createdAt: updatedAt})

      return (await db
        .prepare(
          `SELECT p.id, p.status, pm.role
           FROM provider_members pm
           INNER JOIN provider_profiles p ON p.id = pm.provider_profile_id
           WHERE pm.user_id = ?1
           LIMIT 1`,
        )
        .bind(userId)
        .first()) as {id: string; status: string; role: string} | null
    })

    if (provider === null) return json({ok: false, error: 'unauthorized'}, {status: 401})
    if (provider === false) {
      return json(
        {ok: false, error: 'pro_subscription_required', message: 'An active Pro subscription is required for Artist access.'},
        {status: 403},
      )
    }
    if (!provider) throw new Error('provider_bootstrap_failed')
    return json({ok: true, provider}, {status: 200})
  } catch (error) {
    const errorId = crypto.randomUUID()
    console.error('[account/artist] conversion failed', {errorId, error})
    return json({ok: false, error: 'artist_conversion_failed', errorId}, {status: 500})
  }
}