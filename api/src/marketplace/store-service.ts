import {MarketplaceError} from './service'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
}

type Database = {prepare: (sql: string) => Statement}

export type StoreAsset = {storageKey: string; mimeType: string}

export class StoreService {
  constructor(private readonly database: Database) {}

  async listCatalog(): Promise<unknown[]> {
    const {results} = await this.database.prepare(
      `SELECT r.id, r.title, r.release_type, r.genre, r.original_release_date, r.published_at,
        artist.id AS artist_id, artist.name AS artist_name,
        artwork.id AS artwork_asset_id,
        offer.product_id, offer.amount_minor, offer.currency,
        COUNT(DISTINCT track.id)::integer AS track_count,
        MIN(preview.id) AS preview_asset_id
       FROM releases r
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
         AND preview.kind = 'audio' AND preview.processing_status = 'ready'
       WHERE r.status = 'LIVE'
      GROUP BY r.id, artist.id, artist.name, artwork.id, offer.product_id, offer.amount_minor, offer.currency
       ORDER BY r.published_at DESC, r.updated_at DESC`,
    ).all()
    return results
  }

  async getRelease(releaseId: string): Promise<unknown> {
    const release = await this.database.prepare(
      `SELECT r.id, r.title, r.version_title, r.release_type, r.genre, r.subgenre,
        r.original_release_date, r.published_at, r.label_name,
        artist.id AS artist_id, artist.name AS artist_name,
        artwork.id AS artwork_asset_id,
        offer.product_id, offer.amount_minor, offer.currency
       FROM releases r
       JOIN release_artists credit ON credit.release_id = r.id AND credit.is_primary = TRUE
       JOIN artists artist ON artist.id = credit.artist_id
       JOIN LATERAL (
         SELECT product.id AS product_id, price.amount_minor, price.currency, price.effective_from
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
       WHERE r.id = ?1 AND r.status = 'LIVE'
       LIMIT 1`,
    ).bind(releaseId).first()
    if (!release) throw new MarketplaceError(404, 'not_found', 'Catalog release was not found')

    const {results: tracks} = await this.database.prepare(
      `SELECT t.id, t.title, t.version_title, t.disc_number, t.track_number,
        t.duration_ms, t.explicit, preview.id AS preview_asset_id
       FROM tracks t
       JOIN releases r ON r.id = t.release_id AND r.status = 'LIVE'
       LEFT JOIN LATERAL (
         SELECT asset.id FROM marketplace_assets asset
         WHERE asset.track_id = t.id AND asset.kind = 'audio' AND asset.processing_status = 'ready'
         ORDER BY asset.created_at DESC LIMIT 1
       ) preview ON TRUE
       WHERE t.release_id = ?1
       ORDER BY t.disc_number, t.track_number`,
    ).bind(releaseId).all()
    return {release, tracks}
  }

  async getAsset(assetId: string): Promise<StoreAsset> {
    const asset = await this.database.prepare(
      `SELECT asset.storage_key, asset.mime_type
       FROM marketplace_assets asset
       LEFT JOIN tracks track ON track.id = asset.track_id
       JOIN releases r ON r.id = COALESCE(asset.release_id, track.release_id)
       WHERE asset.id = ?1 AND asset.processing_status = 'ready' AND r.status = 'LIVE'`,
    ).bind(assetId).first<{storage_key: string; mime_type: string}>()
    if (!asset) throw new MarketplaceError(404, 'not_found', 'Catalog asset was not found')
    return {storageKey: asset.storage_key, mimeType: asset.mime_type}
  }
}