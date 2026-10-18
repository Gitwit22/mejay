type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
}

type Database = {prepare: (sql: string) => Statement}

/** Default lowest price a release can be sold for ($3.00), so every sale clears card fees for everyone. */
export const DEFAULT_MINIMUM_RELEASE_PRICE_MINOR = 300
/** Floor enforced by the `prices_active_sale_policy_check` database constraint (migration 8). */
const DATABASE_MINIMUM_PRICE_MINOR = 100
const MAXIMUM_PRICE_MINOR = 100_000_00

/**
 * Reads MINIMUM_TRACK_PRICE_CENTS. The override can raise or lower the minimum, but never below
 * the database floor, so a misconfiguration fails at startup instead of on the first price save.
 */
export function resolveMinimumReleasePriceMinor(env: Record<string, string | undefined>): number {
  const raw = env.MINIMUM_TRACK_PRICE_CENTS?.trim()
  if (!raw) return DEFAULT_MINIMUM_RELEASE_PRICE_MINOR
  const value = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < DATABASE_MINIMUM_PRICE_MINOR || value > MAXIMUM_PRICE_MINOR) {
    throw new Error(`MINIMUM_TRACK_PRICE_CENTS must be an integer between ${DATABASE_MINIMUM_PRICE_MINOR} and ${MAXIMUM_PRICE_MINOR}`)
  }
  return value
}

/** The platform-wide minimum release price in USD cents (the single source for schemas, readiness, and UI). */
export const MINIMUM_RELEASE_PRICE_MINOR = resolveMinimumReleasePriceMinor(process.env)

export function formatMinimumPrice(): string {
  return `$${(MINIMUM_RELEASE_PRICE_MINOR / 100).toFixed(2)}`
}

export type ReleaseSaleReadiness = {
  hasMinimumPrice: boolean
  stripeReady: boolean
}

export async function getReleaseSaleReadiness(database: Database, releaseId: string): Promise<ReleaseSaleReadiness> {
  const readiness = await database.prepare(
    `SELECT
      EXISTS (
        SELECT 1 FROM products product JOIN prices price ON price.product_id = product.id
        -- product.active is not required: unpublish/takedown deactivate products and publishing
        -- re-activates them, so requiring it would block re-publishing forever.
        WHERE product.release_id = release.id AND price.active = TRUE
          AND price.currency = 'USD' AND price.amount_minor >= ?2
          AND price.effective_from <= CURRENT_TIMESTAMP
          AND (price.effective_until IS NULL OR price.effective_until > CURRENT_TIMESTAMP)
      ) AS has_minimum_price,
      (provider.suspended_at IS NULL AND provider.stripe_details_submitted AND provider.stripe_payouts_enabled
        AND provider.stripe_transfers_status = 'active') AS stripe_ready
     FROM releases release
     JOIN provider_profiles provider ON provider.id = release.provider_profile_id
     WHERE release.id = ?1`,
  ).bind(releaseId, MINIMUM_RELEASE_PRICE_MINOR).first<{has_minimum_price: boolean; stripe_ready: boolean}>()

  return {
    hasMinimumPrice: Boolean(readiness?.has_minimum_price),
    stripeReady: Boolean(readiness?.stripe_ready),
  }
}
