/**
 * The one rule for whether an artist's public page (and its profile imagery) can be shown.
 *
 * An artist is public while their provider account is not suspended AND either:
 * - they are the primary artist on at least one LIVE release, or
 * - their provider has finished Stripe Connect onboarding and can be paid (details submitted,
 *   payouts enabled, transfers active) — the same readiness test checkout uses.
 *
 * `artist` and `provider` are the SQL aliases of the `artists` and `provider_profiles` rows.
 */
export function artistPubliclyVisibleSql(artist: string, provider: string): string {
  return `(${provider}.suspended_at IS NULL AND (
    EXISTS (
      SELECT 1 FROM release_artists visible_credit JOIN releases visible_release ON visible_release.id = visible_credit.release_id
      WHERE visible_credit.artist_id = ${artist}.id AND visible_credit.is_primary = TRUE AND visible_release.status = 'LIVE'
    )
    OR (${provider}.stripe_details_submitted AND ${provider}.stripe_payouts_enabled AND ${provider}.stripe_transfers_status = 'active')
  ))`
}
