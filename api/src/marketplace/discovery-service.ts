type Statement = {
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
}

type Database = {prepare: (sql: string) => Statement}

const releaseProjection = `
  SELECT r.id, r.title, r.release_type, r.genre, r.original_release_date, r.published_at,
    artist.id AS artist_id, artist.name AS artist_name,
    artwork.id AS artwork_asset_id,
    offer.product_id, offer.amount_minor, offer.currency,
    (provider.stripe_details_submitted AND provider.stripe_payouts_enabled
      AND provider.stripe_transfers_status = 'active') AS purchase_available,
    COUNT(DISTINCT track.id)::integer AS track_count,
    MIN(preview.id) AS preview_asset_id`

const releaseJoins = `
  FROM releases r
  JOIN provider_profiles provider ON provider.id = r.provider_profile_id
  JOIN release_artists credit ON credit.release_id = r.id AND credit.is_primary = TRUE
  JOIN artists artist ON artist.id = credit.artist_id
  JOIN LATERAL (
    SELECT product.id AS product_id, price.amount_minor, price.currency
    FROM products product JOIN prices price ON price.product_id = product.id
    WHERE product.release_id = r.id AND product.active = TRUE AND price.active = TRUE
      AND price.effective_from <= CURRENT_TIMESTAMP
      AND (price.effective_until IS NULL OR price.effective_until > CURRENT_TIMESTAMP)
    ORDER BY price.effective_from DESC, product.created_at DESC LIMIT 1
  ) offer ON TRUE
  LEFT JOIN LATERAL (
    SELECT asset.id FROM marketplace_assets asset
    WHERE asset.release_id = r.id AND asset.kind = 'artwork' AND asset.processing_status = 'ready'
    ORDER BY asset.created_at DESC LIMIT 1
  ) artwork ON TRUE
  LEFT JOIN tracks track ON track.release_id = r.id
  LEFT JOIN marketplace_assets preview ON preview.track_id = track.id
    AND preview.kind = 'audio' AND preview.processing_status = 'ready'`

const releaseGroup = `
  GROUP BY r.id, artist.id, artist.name, artwork.id, offer.product_id, offer.amount_minor, offer.currency,
    provider.stripe_details_submitted, provider.stripe_payouts_enabled, provider.stripe_transfers_status`

export type DiscoveryRelease = Record<string, unknown>
export type DiscoveryArtist = {
  id: string
  name: string
  artwork_asset_id: string | null
  release_count: number
}

export type MusicDiscovery = {
  newestReleases: DiscoveryRelease[]
  newestSingles: DiscoveryRelease[]
  newestProjects: DiscoveryRelease[]
  mostPurchased: DiscoveryRelease[]
  mostPreviewed: DiscoveryRelease[]
  featuredReleases: DiscoveryRelease[]
  featuredArtists: DiscoveryArtist[]
}

export class DiscoveryService {
  constructor(private readonly database: Database) {}

  async getOverview(): Promise<MusicDiscovery> {
    const [newestReleases, newestSingles, newestProjects, mostPurchased, mostPreviewed, featuredReleases, featuredArtists] = await Promise.all([
      this.releases("r.status = 'LIVE'", 'r.published_at DESC, r.updated_at DESC'),
      this.releases("r.status = 'LIVE' AND r.release_type = 'single'", 'r.published_at DESC, r.updated_at DESC'),
      this.releases("r.status = 'LIVE' AND r.release_type IN ('ep', 'album')", 'r.published_at DESC, r.updated_at DESC'),
      this.releases("r.status = 'LIVE' AND purchased.order_item_id IS NOT NULL", 'COUNT(DISTINCT purchased.order_item_id) DESC, r.published_at DESC', `
        LEFT JOIN (
          SELECT item.release_id, item.id AS order_item_id
          FROM marketplace_order_items item
          JOIN marketplace_orders purchase_order ON purchase_order.id = item.order_id
          WHERE purchase_order.payment_status IN ('paid', 'partially_refunded')
        ) purchased ON purchased.release_id = r.id`),
      this.releases("r.status = 'LIVE' AND preview_event.id IS NOT NULL", 'COUNT(DISTINCT preview_event.id) DESC, r.published_at DESC', `
        LEFT JOIN marketplace_preview_events preview_event ON preview_event.release_id = r.id`),
      this.releases("r.status = 'LIVE' AND feature.release_id IS NOT NULL", 'MIN(feature.position) ASC', `
        JOIN marketplace_discovery_features feature ON feature.release_id = r.id`),
      this.featuredArtists(),
    ])

    return {
      newestReleases,
      newestSingles,
      newestProjects,
      mostPurchased,
      mostPreviewed,
      featuredReleases,
      featuredArtists,
    }
  }

  private async releases(where: string, order: string, extraJoin = ''): Promise<DiscoveryRelease[]> {
    const {results} = await this.database.prepare(
      `${releaseProjection}${releaseJoins}${extraJoin}
       WHERE ${where}${releaseGroup}
       ORDER BY ${order}
       LIMIT 8`,
    ).all<DiscoveryRelease>()
    return results
  }

  private async featuredArtists(): Promise<DiscoveryArtist[]> {
    const {results} = await this.database.prepare(
      `SELECT artist.id, artist.name, latest_artwork.artwork_asset_id,
        COUNT(DISTINCT release_credit.release_id)::integer AS release_count
       FROM marketplace_discovery_features feature
       JOIN artists artist ON artist.id = feature.artist_id
       JOIN release_artists release_credit ON release_credit.artist_id = artist.id
       JOIN releases live_release ON live_release.id = release_credit.release_id AND live_release.status = 'LIVE'
       LEFT JOIN LATERAL (
         SELECT artwork.id AS artwork_asset_id
         FROM release_artists latest_credit
         JOIN releases latest_release ON latest_release.id = latest_credit.release_id AND latest_release.status = 'LIVE'
         LEFT JOIN marketplace_assets artwork ON artwork.release_id = latest_release.id
           AND artwork.kind = 'artwork' AND artwork.processing_status = 'ready'
         WHERE latest_credit.artist_id = artist.id
         ORDER BY latest_release.published_at DESC, artwork.created_at DESC LIMIT 1
       ) latest_artwork ON TRUE
       WHERE feature.artist_id IS NOT NULL
       GROUP BY artist.id, artist.name, latest_artwork.artwork_asset_id, feature.position
       ORDER BY feature.position ASC
       LIMIT 6`,
    ).all<DiscoveryArtist>()
    return results
  }
}
