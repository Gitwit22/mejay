import {MarketplaceError} from './service'
import {isMarketplaceStorageKey} from './storage-keys'
import {artistPubliclyVisibleSql} from './artist-visibility'
import {formatArtistCredit, parseCredits, releaseCreditsJsonSql} from './artist-credit'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
  run: () => Promise<unknown>
}

type Database = {prepare: (sql: string) => Statement}

export type StoreAsset = {storageKey: string; mimeType: string; byteSize: number; durationMs: number | null; kind: string}

/** Only objects created through the signed-upload flow live under this prefix. */

export const PREVIEW_SECONDS = 30
const PREVIEW_MAX_FILE_FRACTION = 0.2
const PREVIEW_FALLBACK_BYTES = 1_048_576

/**
 * Number of leading bytes of an audio master that may be streamed as a public preview: roughly
 * PREVIEW_SECONDS of audio, never more than 20% of the file, so short tracks are never given away.
 */
export function previewByteLimit(byteSize: number, durationMs: number | null): number {
  const size = Math.max(0, Math.floor(byteSize))
  const fractionCap = Math.floor(size * PREVIEW_MAX_FILE_FRACTION)
  const durationCap = durationMs && durationMs > 0
    ? Math.floor((size / durationMs) * PREVIEW_SECONDS * 1000)
    : PREVIEW_FALLBACK_BYTES
  return Math.max(0, Math.min(fractionCap, durationCap))
}

/**
 * Resolve a client Range header against the preview window. Returns null when the requested
 * range starts beyond the window (416).
 */
export function resolvePreviewRange(rangeHeader: string | null, limit: number): {start: number; end: number} | null {
  if (limit <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec((rangeHeader ?? '').trim())
  if (!match || (!match[1] && !match[2])) return {start: 0, end: limit - 1}
  if (!match[1]) {
    const suffix = Math.min(Number(match[2]), limit)
    return suffix > 0 ? {start: limit - suffix, end: limit - 1} : null
  }
  const start = Number(match[1])
  if (start >= limit) return null
  const end = match[2] ? Math.min(Number(match[2]), limit - 1) : limit - 1
  return end >= start ? {start, end} : null
}

/**
 * Releases the store may list: LIVE releases, and approved SCHEDULED releases whose artist enabled
 * pre-orders. `r` is the releases alias.
 */
export const STORE_LISTED_RELEASE_SQL = `(r.status = 'LIVE' OR (r.status = 'SCHEDULED' AND r.preorders_enabled AND r.scheduled_release_at IS NOT NULL))`

/**
 * Whether listed release `r` may play its preview clips: always once LIVE, and during pre-orders
 * only when the artist chose "before release".
 */
export const PREVIEW_PLAYABLE_SQL = `(r.status = 'LIVE' OR r.preview_timing = 'before_release')`

/** Adds `artist_credit` ("A & B feat. C") while `artist_name`/`artist_slug` stay the lead artist for links. */
function withArtistCredit<T extends Record<string, unknown>>(row: T): T & {artist_credit: string} {
  const {artist_credits: credits, ...rest} = row as T & {artist_credits?: unknown}
  return {...rest, artist_credit: formatArtistCredit(row.artist_name as string, parseCredits(credits))} as T & {artist_credit: string}
}

export class StoreService {
  constructor(private readonly database: Database) {}

  /** Public LIVE catalog; `artistId` narrows it to one artist's primary releases (artist pages). */
  async listCatalog(artistId?: string): Promise<unknown[]> {
    const {results} = await this.database.prepare(
      `SELECT r.id, r.title, r.release_type, r.genre, r.original_release_date, r.published_at,
        CASE WHEN r.status = 'LIVE' THEN 'available' ELSE 'preorder' END AS availability,
        CASE WHEN r.status = 'LIVE' THEN NULL ELSE r.scheduled_release_at END AS release_at,
        r.release_timezone,
        artist.id AS artist_id, artist.name AS artist_name, artist.slug AS artist_slug, ${releaseCreditsJsonSql('r')} AS artist_credits,
        artwork.id AS artwork_asset_id,
        offer.product_id, offer.amount_minor, offer.currency,
        (provider.suspended_at IS NULL AND provider.stripe_details_submitted AND provider.stripe_payouts_enabled
          AND provider.stripe_transfers_status = 'active') AS purchase_available,
        COUNT(DISTINCT track.id)::integer AS track_count,
        -- Only MeJay-made 10-second clips are ever public; pre-orders play them only if the artist allows.
        CASE WHEN ${PREVIEW_PLAYABLE_SQL} THEN (ARRAY_AGG(preview.id ORDER BY track.disc_number, track.track_number, preview.created_at DESC) FILTER (WHERE preview.id IS NOT NULL))[1] END AS preview_asset_id
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
         AND preview.kind = 'audio_preview' AND preview.processing_status = 'ready'
       WHERE ${STORE_LISTED_RELEASE_SQL} AND (?1 = '' OR artist.id = ?1)
      GROUP BY r.id, artist.id, artist.name, artwork.id, offer.product_id, offer.amount_minor, offer.currency,
        provider.suspended_at, provider.stripe_details_submitted, provider.stripe_payouts_enabled, provider.stripe_transfers_status
       ORDER BY (r.status = 'LIVE') DESC, r.published_at DESC NULLS LAST, r.scheduled_release_at, r.updated_at DESC`,
    ).bind(artistId ?? '').all<Record<string, unknown>>()
    return results.map(withArtistCredit)
  }

  async getRelease(releaseId: string): Promise<unknown> {
    const release = await this.database.prepare(
      `SELECT r.id, r.title, r.version_title, r.release_type, r.genre, r.subgenre,
        r.original_release_date, r.published_at, r.label_name,
        CASE WHEN r.status = 'LIVE' THEN 'available' ELSE 'preorder' END AS availability,
        CASE WHEN r.status = 'LIVE' THEN NULL ELSE r.scheduled_release_at END AS release_at,
        r.release_timezone,
        artist.id AS artist_id, artist.name AS artist_name, artist.slug AS artist_slug, ${releaseCreditsJsonSql('r')} AS artist_credits,
        artwork.id AS artwork_asset_id,
        offer.product_id, offer.amount_minor, offer.currency,
        (provider.suspended_at IS NULL AND provider.stripe_details_submitted AND provider.stripe_payouts_enabled
          AND provider.stripe_transfers_status = 'active') AS purchase_available
       FROM releases r
       JOIN provider_profiles provider ON provider.id = r.provider_profile_id
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
       WHERE r.id = ?1 AND ${STORE_LISTED_RELEASE_SQL}
       LIMIT 1`,
    ).bind(releaseId).first<Record<string, unknown>>().then((row) => row && withArtistCredit(row))
    if (!release) throw new MarketplaceError(404, 'not_found', 'Catalog release was not found')

    const {results: tracks} = await this.database.prepare(
      `SELECT t.id, t.title, t.version_title, t.disc_number, t.track_number,
        t.duration_ms, t.explicit, CASE WHEN ${PREVIEW_PLAYABLE_SQL} THEN preview.id END AS preview_asset_id,
        song.product_id, song.amount_minor, song.currency
       FROM tracks t
       JOIN releases r ON r.id = t.release_id AND ${STORE_LISTED_RELEASE_SQL}
       LEFT JOIN LATERAL (
         SELECT asset.id FROM marketplace_assets asset
         WHERE asset.track_id = t.id AND asset.kind = 'audio_preview' AND asset.processing_status = 'ready'
         ORDER BY asset.created_at DESC LIMIT 1
       ) preview ON TRUE
       -- Optional single-song offer; null when the song is only sold as part of the release.
       LEFT JOIN LATERAL (
         SELECT product.id AS product_id, price.amount_minor, price.currency
         FROM products product JOIN prices price ON price.product_id = product.id
         WHERE product.track_id = t.id AND product.active = TRUE AND price.active = TRUE
           AND price.effective_from <= CURRENT_TIMESTAMP
           AND (price.effective_until IS NULL OR price.effective_until > CURRENT_TIMESTAMP)
         ORDER BY price.effective_from DESC, product.created_at DESC LIMIT 1
       ) song ON TRUE
       WHERE t.release_id = ?1
       ORDER BY t.disc_number, t.track_number`,
    ).bind(releaseId).all()
    return {release, tracks}
  }

  async recordPreview(assetId: string, userId: string | null): Promise<void> {
    const preview = await this.database.prepare(
      `SELECT asset.id, asset.track_id, track.release_id
       FROM marketplace_assets asset
       JOIN tracks track ON track.id = asset.track_id
       JOIN releases release ON release.id = track.release_id
       WHERE asset.id = ?1 AND asset.kind = 'audio_preview'
         AND asset.processing_status = 'ready' AND (release.status = 'LIVE' OR (release.status = 'SCHEDULED'
           AND release.preorders_enabled AND release.preview_timing = 'before_release'))
       LIMIT 1`,
    ).bind(assetId).first<{id: string; track_id: string; release_id: string}>()
    if (!preview) throw new MarketplaceError(404, 'preview_not_found', 'Preview audio was not found')

    await this.database.prepare(
      `INSERT INTO marketplace_preview_events (id, release_id, track_id, asset_id, user_id)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(crypto.randomUUID(), preview.release_id, preview.track_id, preview.id, userId).run()
  }

  async getAsset(assetId: string): Promise<StoreAsset> {
    const asset = await this.database.prepare(
      // Only public kinds: release artwork and audio previews of LIVE releases, and profile imagery
      // of artists whose page is public (artistPubliclyVisibleSql). Rights documents are never served from here.
      `SELECT asset.storage_key, asset.mime_type, asset.byte_size, asset.kind, track.duration_ms
       FROM marketplace_assets asset
       LEFT JOIN tracks track ON track.id = asset.track_id
       WHERE asset.id = ?1 AND asset.processing_status = 'ready' AND (
         -- Cover art of any listed release (LIVE or open for pre-order).
         (asset.kind = 'artwork' AND EXISTS (
           SELECT 1 FROM releases r WHERE r.id = asset.release_id AND ${STORE_LISTED_RELEASE_SQL}))
         -- Audio only as the 10-second preview clip, never the uploaded master.
         OR (asset.kind = 'audio_preview' AND EXISTS (
           SELECT 1 FROM releases r WHERE r.id = track.release_id AND ${STORE_LISTED_RELEASE_SQL} AND ${PREVIEW_PLAYABLE_SQL}))
         OR (asset.kind IN ('artist_photo', 'artist_banner', 'artist_cutout', 'artist_gallery') AND EXISTS (
           SELECT 1 FROM artists a JOIN provider_profiles provider ON provider.id = a.provider_profile_id
           WHERE a.id = asset.artist_id AND ${artistPubliclyVisibleSql('a', 'provider')}))
       )`,
    ).bind(assetId).first<{storage_key: string; mime_type: string; byte_size: number | string; duration_ms: number | null; kind: string}>()
    if (!asset || !isMarketplaceStorageKey(asset.storage_key)) {
      throw new MarketplaceError(404, 'not_found', 'Catalog asset was not found')
    }
    return {
      storageKey: asset.storage_key,
      mimeType: asset.mime_type,
      byteSize: Number(asset.byte_size),
      durationMs: asset.duration_ms === null ? null : Number(asset.duration_ms),
      kind: asset.kind,
    }
  }
}