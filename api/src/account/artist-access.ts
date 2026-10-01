export type ArtistAccessEntitlement = {
  stripe_subscription_id?: string | null
  subscription_status?: string | null
  artist_portal_access?: boolean | null
}

export function grantsArtistPortalAccess(entitlement: ArtistAccessEntitlement | null | undefined): boolean {
  if (entitlement?.artist_portal_access === true) return true
  const subscriptionId = entitlement?.stripe_subscription_id?.trim()
  if (!subscriptionId) return false
  return entitlement?.subscription_status === 'active' || entitlement?.subscription_status === 'trialing'
}

type Queryable = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>
    }
  }
}

export async function userHasArtistPortalAccess(db: Queryable, userId: string): Promise<boolean> {
  const entitlement = await db
    .prepare(
      `SELECT e.stripe_subscription_id, e.subscription_status,
        COALESCE(g.artist_portal_access, FALSE) AS artist_portal_access
       FROM users u
       LEFT JOIN entitlements e ON e.user_id = u.id
       LEFT JOIN platform_access_grants g ON g.user_id = u.id
       WHERE u.id = ?1`,
    )
    .bind(userId)
    .first<ArtistAccessEntitlement>()
  return grantsArtistPortalAccess(entitlement)
}