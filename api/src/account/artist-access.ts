export type ArtistAccessEntitlement = {
  stripe_subscription_id?: string | null
  subscription_status?: string | null
}

export function grantsArtistPortalAccess(entitlement: ArtistAccessEntitlement | null | undefined): boolean {
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
    .prepare('SELECT stripe_subscription_id, subscription_status FROM entitlements WHERE user_id = ?1')
    .bind(userId)
    .first<ArtistAccessEntitlement>()
  return grantsArtistPortalAccess(entitlement)
}