import {compactLinks, type ArtistGalleryInput, type ArtistProfileInput} from './artist-profile'
import {audit, MarketplaceError, providerContext, uniqueArtistSlug, type Database} from './service'
import {StoreService} from './store-service'
import {artistPubliclyVisibleSql} from './artist-visibility'
import {isMarketplaceStorageKey} from './storage-keys'

type ArtistRow = {
  id: string
  provider_profile_id: string
  name: string
  slug: string
  tagline: string | null
  bio: string | null
  location: string | null
  genres: string[]
  links: Record<string, string>
  spotify_artist_id: string | null
  apple_music_artist_id: string | null
  profile_photo_asset_id: string | null
  banner_asset_id: string | null
  cutout_asset_id: string | null
  story_photo_asset_id: string | null
  featured_release_id: string | null
  accent_color: string | null
  highlight_quote: string | null
  profile_updated_at: string | null
}

export type ArtistGalleryImage = {asset_id: string; caption: string | null; position: number}

export type PublicArtistProfile = Omit<ArtistRow, 'provider_profile_id' | 'profile_updated_at'> & {verified: boolean; gallery: ArtistGalleryImage[]}

/** Why an artist page is or is not public, shown to its owner. */
export type ArtistPageVisibility = {public: boolean; suspended: boolean; payoutsReady: boolean; hasLiveRelease: boolean}

const PROFILE_FIELDS = `id, provider_profile_id, name, slug, tagline, bio, location, genres, links,
  spotify_artist_id, apple_music_artist_id, profile_photo_asset_id, banner_asset_id, cutout_asset_id,
  story_photo_asset_id, featured_release_id, accent_color, highlight_quote, profile_updated_at`
const PROFILE_COLUMNS = PROFILE_FIELDS.split(',').map((column) => `a.${column.trim()}`).join(', ')

/** Profile image slots and the asset kind each must be. */
const IMAGE_SLOTS = [
  ['profilePhotoAssetId', 'artist_photo', 'profile photo'],
  ['bannerAssetId', 'artist_banner', 'city background'],
  ['cutoutAssetId', 'artist_cutout', 'artist cutout'],
  ['storyPhotoAssetId', 'artist_photo', 'story photo'],
] as const

async function listGallery(db: Database, artistId: string): Promise<ArtistGalleryImage[]> {
  const {results} = await db.prepare(
    `SELECT gallery.asset_id, gallery.caption, gallery.position
     FROM artist_gallery_images gallery JOIN marketplace_assets asset ON asset.id = gallery.asset_id
     WHERE gallery.artist_id = ?1 AND asset.processing_status = 'ready'
     ORDER BY gallery.position`,
  ).bind(artistId).all<ArtistGalleryImage>()
  return results.map((image) => ({...image, position: Number(image.position)}))
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as {code?: string}).code === '23505'
}

/**
 * Artist profiles on the existing `artists` catalog identity. Every write resolves the caller's
 * artist account from the session and only touches artists that account owns; IDs in the request
 * never grant access.
 */
export class ArtistProfileService {
  constructor(private readonly database: Database) {}

  async getProfile(userId: string, artistId: string): Promise<ArtistRow & {liveReleaseCount: number; gallery: ArtistGalleryImage[]; liveReleases: Array<{id: string; title: string}>}> {
    const context = await providerContext(this.database, userId, false)
    const artist = await this.database.prepare(
      `SELECT ${PROFILE_COLUMNS},
        (SELECT COUNT(*)::integer FROM release_artists credit JOIN releases r ON r.id = credit.release_id
          WHERE credit.artist_id = a.id AND credit.is_primary = TRUE AND r.status = 'LIVE') AS live_release_count
       FROM artists a WHERE a.id = ?1 AND a.provider_profile_id = ?2`,
    ).bind(artistId, context.providerId).first<ArtistRow & {live_release_count: number}>()
    if (!artist) throw new MarketplaceError(404, 'not_found', 'Artist was not found')
    const {live_release_count: liveReleaseCount, ...profile} = artist
    const {results: liveReleases} = await this.database.prepare(
      `SELECT r.id, r.title FROM release_artists credit JOIN releases r ON r.id = credit.release_id
       WHERE credit.artist_id = ?1 AND credit.is_primary = TRUE AND r.status = 'LIVE'
       ORDER BY COALESCE(r.published_at, r.created_at) DESC`,
    ).bind(artistId).all<{id: string; title: string}>()
    return {...profile, liveReleaseCount: Number(liveReleaseCount), gallery: await listGallery(this.database, artistId), liveReleases}
  }

  async updateProfile(userId: string, artistId: string, input: ArtistProfileInput): Promise<ArtistRow> {
    try {
      return await this.database.transaction(async (db) => {
        const context = await providerContext(db, userId)
        const before = await db.prepare(
          `SELECT ${PROFILE_COLUMNS} FROM artists a WHERE a.id = ?1 AND a.provider_profile_id = ?2 FOR UPDATE`,
        ).bind(artistId, context.providerId).first<ArtistRow>()
        if (!before) throw new MarketplaceError(404, 'not_found', 'Artist was not found')

        for (const [field, kind, label] of IMAGE_SLOTS) {
          const assetId = input[field]
          if (!assetId) continue
          const asset = await db.prepare(
            `SELECT id FROM marketplace_assets WHERE id = ?1 AND artist_id = ?2 AND provider_profile_id = ?3
               AND kind = ?4 AND processing_status = 'ready'`,
          ).bind(assetId, artistId, context.providerId, kind).first()
          if (!asset) throw new MarketplaceError(422, 'invalid_profile_image', `The ${label} upload was not found or is not ready`)
        }
        if (input.featuredReleaseId) {
          const release = await db.prepare(
            `SELECT r.id FROM releases r JOIN release_artists credit ON credit.release_id = r.id
             WHERE r.id = ?1 AND r.provider_profile_id = ?2 AND credit.artist_id = ?3 AND credit.is_primary = TRUE
               AND r.status = 'LIVE'`,
          ).bind(input.featuredReleaseId, context.providerId, artistId).first()
          if (!release) throw new MarketplaceError(422, 'invalid_featured_release', 'The featured release must be one of this artist\'s live releases')
        }
        const keep = <K extends keyof ArtistRow>(value: string | null | undefined, column: K) => value === undefined ? before[column] : value
        const slug = input.slug && input.slug !== before.slug
          ? await this.requireFreeSlug(db, input.slug, artistId)
          : before.slug

        const row = await db.prepare(
          `UPDATE artists SET name = ?1, slug = ?2, tagline = ?3, bio = ?4, location = ?5, genres = ?6,
             links = ?7::jsonb, spotify_artist_id = ?8, apple_music_artist_id = ?9,
             profile_photo_asset_id = ?10, banner_asset_id = ?11, cutout_asset_id = ?14, story_photo_asset_id = ?15,
             featured_release_id = ?16, accent_color = ?17, highlight_quote = ?18,
             profile_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?12 AND provider_profile_id = ?13
           RETURNING ${PROFILE_FIELDS}`,
        ).bind(
          input.name, slug, input.tagline ?? null, input.bio ?? null, input.location ?? null, input.genres,
          JSON.stringify(compactLinks(input.links)), input.spotifyArtistId ?? null, input.appleMusicArtistId ?? null,
          keep(input.profilePhotoAssetId, 'profile_photo_asset_id'),
          keep(input.bannerAssetId, 'banner_asset_id'),
          artistId, context.providerId,
          keep(input.cutoutAssetId, 'cutout_asset_id'),
          keep(input.storyPhotoAssetId, 'story_photo_asset_id'),
          keep(input.featuredReleaseId, 'featured_release_id'),
          keep(input.accentColor, 'accent_color'),
          keep(input.highlightQuote, 'highlight_quote'),
        ).first<ArtistRow>()
        if (!row) throw new MarketplaceError(404, 'not_found', 'Artist was not found')
        await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'artist', entityId: artistId, action: 'artist.profile_updated', before, after: row})
        return row
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new MarketplaceError(409, 'slug_taken', 'That artist URL is already taken')
      throw error
    }
  }

  /**
   * Replaces the artist's gallery in one transaction. Every photo must be a ready gallery upload of
   * this artist; order is the order given.
   */
  async replaceGallery(userId: string, artistId: string, input: ArtistGalleryInput): Promise<ArtistGalleryImage[]> {
    return this.database.transaction(async (db) => {
      const context = await providerContext(db, userId)
      const artist = await db.prepare('SELECT id FROM artists WHERE id = ?1 AND provider_profile_id = ?2 FOR UPDATE')
        .bind(artistId, context.providerId).first()
      if (!artist) throw new MarketplaceError(404, 'not_found', 'Artist was not found')
      for (const item of input.items) {
        const asset = await db.prepare(
          `SELECT id FROM marketplace_assets WHERE id = ?1 AND artist_id = ?2 AND provider_profile_id = ?3
             AND kind = 'artist_gallery' AND processing_status = 'ready'`,
        ).bind(item.assetId, artistId, context.providerId).first()
        if (!asset) throw new MarketplaceError(422, 'invalid_gallery_image', 'A gallery photo was not found or is not ready')
      }
      const before = await listGallery(db, artistId)
      await db.prepare('DELETE FROM artist_gallery_images WHERE artist_id = ?1').bind(artistId).run()
      for (const [position, item] of input.items.entries()) {
        await db.prepare(
          'INSERT INTO artist_gallery_images (id, artist_id, asset_id, caption, position) VALUES (?1, ?2, ?3, ?4, ?5)',
        ).bind(crypto.randomUUID(), artistId, item.assetId, item.caption ?? null, position).run()
      }
      const after = await listGallery(db, artistId)
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'artist', entityId: artistId, action: 'artist.gallery_updated', before, after})
      return after
    })
  }

  private async requireFreeSlug(db: Database, slug: string, artistId: string): Promise<string> {
    const free = await uniqueArtistSlug(db, slug, artistId)
    if (free !== slug) throw new MarketplaceError(409, 'slug_taken', 'That artist URL is already taken')
    return slug
  }

  /**
   * Public artist page. Visibility follows artistPubliclyVisibleSql: an unsuspended account whose
   * artist has a LIVE release or whose Stripe payouts are set up. Releases come from the same LIVE
   * catalog query as the marketplace, so a page can be public before it has any music.
   */
  async getPublicArtist(slug: string): Promise<{artist: PublicArtistProfile; releases: unknown[]}> {
    const artist = await this.database.prepare(
      `SELECT ${PROFILE_COLUMNS}, provider.status = 'approved' AS verified
       FROM artists a JOIN provider_profiles provider ON provider.id = a.provider_profile_id
       WHERE a.slug = ?1 AND ${artistPubliclyVisibleSql('a', 'provider')}`,
    ).bind(slug.toLowerCase()).first<ArtistRow & {verified: boolean}>()
    if (!artist) throw new MarketplaceError(404, 'not_found', 'Artist was not found')
    return this.publicPage(artist)
  }

  /**
   * The owner's view of their own artist page: the same content the public sees, whether or not the
   * page is public yet, plus why it is or is not public. Read-only, so any member of the owning
   * provider may preview.
   */
  async getOwnerPreview(userId: string, artistId: string): Promise<{artist: PublicArtistProfile; releases: unknown[]; visibility: ArtistPageVisibility}> {
    const context = await providerContext(this.database, userId, false)
    const artist = await this.database.prepare(
      `SELECT ${PROFILE_COLUMNS}, provider.status = 'approved' AS verified,
        provider.suspended_at IS NOT NULL AS suspended,
        (provider.stripe_details_submitted AND provider.stripe_payouts_enabled AND provider.stripe_transfers_status = 'active') AS payouts_ready,
        EXISTS (SELECT 1 FROM release_artists credit JOIN releases r ON r.id = credit.release_id
          WHERE credit.artist_id = a.id AND credit.is_primary = TRUE AND r.status = 'LIVE') AS has_live_release,
        ${artistPubliclyVisibleSql('a', 'provider')} AS is_public
       FROM artists a JOIN provider_profiles provider ON provider.id = a.provider_profile_id
       WHERE a.id = ?1 AND a.provider_profile_id = ?2`,
    ).bind(artistId, context.providerId).first<ArtistRow & {verified: boolean; suspended: boolean; payouts_ready: boolean; has_live_release: boolean; is_public: boolean}>()
    if (!artist) throw new MarketplaceError(404, 'not_found', 'Artist was not found')
    const {suspended, payouts_ready: payoutsReady, has_live_release: hasLiveRelease, is_public: isPublic, ...row} = artist
    return {
      ...(await this.publicPage(row)),
      visibility: {public: Boolean(isPublic), suspended: Boolean(suspended), payoutsReady: Boolean(payoutsReady), hasLiveRelease: Boolean(hasLiveRelease)},
    }
  }

  /**
   * A ready profile image (photo, banner, cutout, gallery) of an artist the user's provider owns, so
   * the owner preview can show imagery before the page is public. Never audio or documents.
   */
  async getOwnedProfileImage(userId: string, artistId: string, assetId: string): Promise<{storageKey: string; mimeType: string}> {
    const context = await providerContext(this.database, userId, false)
    const asset = await this.database.prepare(
      `SELECT storage_key, mime_type FROM marketplace_assets
       WHERE id = ?1 AND artist_id = ?2 AND provider_profile_id = ?3 AND processing_status = 'ready'
         AND kind IN ('artist_photo', 'artist_banner', 'artist_cutout', 'artist_gallery')`,
    ).bind(assetId, artistId, context.providerId).first<{storage_key: string; mime_type: string}>()
    if (!asset || !isMarketplaceStorageKey(asset.storage_key) || !asset.mime_type.startsWith('image/')) {
      throw new MarketplaceError(404, 'not_found', 'Artist image was not found')
    }
    return {storageKey: asset.storage_key, mimeType: asset.mime_type}
  }

  private async publicPage(artist: ArtistRow & {verified: boolean}): Promise<{artist: PublicArtistProfile; releases: unknown[]}> {
    const releases = await new StoreService(this.database).listCatalog(artist.id)
    const {provider_profile_id: _provider, profile_updated_at: _updated, ...publicProfile} = artist
    return {artist: {...publicProfile, verified: Boolean(artist.verified), gallery: await listGallery(this.database, artist.id)}, releases}
  }
}
