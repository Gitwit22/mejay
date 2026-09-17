type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
}

type Database = {prepare: (sql: string) => Statement}

export const MINIMUM_RELEASE_PRICE_MINOR = 100

export type ReleaseSaleReadiness = {
  hasMinimumPrice: boolean
  stripeReady: boolean
}

export async function getReleaseSaleReadiness(database: Database, releaseId: string): Promise<ReleaseSaleReadiness> {
  const readiness = await database.prepare(
    `SELECT
      EXISTS (
        SELECT 1 FROM products product JOIN prices price ON price.product_id = product.id
        WHERE product.release_id = release.id AND product.active = TRUE AND price.active = TRUE
          AND price.currency = 'USD' AND price.amount_minor >= 100
          AND price.effective_from <= CURRENT_TIMESTAMP
          AND (price.effective_until IS NULL OR price.effective_until > CURRENT_TIMESTAMP)
      ) AS has_minimum_price,
      (provider.stripe_details_submitted AND provider.stripe_payouts_enabled
        AND provider.stripe_transfers_status = 'active') AS stripe_ready
     FROM releases release
     JOIN provider_profiles provider ON provider.id = release.provider_profile_id
     WHERE release.id = ?1`,
  ).bind(releaseId).first<{has_minimum_price: boolean; stripe_ready: boolean}>()

  return {
    hasMinimumPrice: Boolean(readiness?.has_minimum_price),
    stripeReady: Boolean(readiness?.stripe_ready),
  }
}
