import {compactLinks, type ArtistProfileInput} from './artist-profile'
import {audit, MarketplaceError, providerContext, uniqueArtistSlug, type Database} from './service'
import {StoreService} from './store-service'

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
  profile_updated_at: string | null
}

const PROFILE_COLUMNS = `a.id, a.provider_profile_id, a.name, a.slug, a.tagline, a.bio, a.location, a.genres, a.links,
  a.spotify_artist_id, a.apple_music_artist_id, a.profile_photo_asset_id, a.banner_asset_id, a.profile_updated_at`

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

  async getProfile(userId: string, artistId: string): Promise<ArtistRow & {liveReleaseCount: number}> {
    const context = await providerContext(this.database, userId, false)
    const artist = await this.database.prepare(
      `SELECT ${PROFILE_COLUMNS},
        (SELECT COUNT(*)::integer FROM release_artists credit JOIN releases r ON r.id = credit.release_id
          WHERE credit.artist_id = a.id AND credit.is_primary = TRUE AND r.status = 'LIVE') AS live_release_count
       FROM artists a WHERE a.id = ?1 AND a.provider_profile_id = ?2`,
    ).bind(artistId, context.providerId).first<ArtistRow & {live_release_count: number}>()
    if (!artist) throw new MarketplaceError(404, 'not_found', 'Artist was not found')
    const {live_release_count: liveReleaseCount, ...profile} = artist
    return {...profile, liveReleaseCount: Number(liveReleaseCount)}
  }

  async updateProfile(userId: string, artistId: string, input: ArtistProfileInput): Promise<ArtistRow> {
    try {
      return await this.database.transaction(async (db) => {
        const context = await providerContext(db, userId)
        const before = await db.prepare(
          `SELECT ${PROFILE_COLUMNS} FROM artists a WHERE a.id = ?1 AND a.provider_profile_id = ?2 FOR UPDATE`,
        ).bind(artistId, context.providerId).first<ArtistRow>()
        if (!before) throw new MarketplaceError(404, 'not_found', 'Artist was not found')

        for (const [assetId, kind] of [[input.profilePhotoAssetId, 'artist_photo'], [input.bannerAssetId, 'artist_banner']] as const) {
          if (!assetId) continue
          const asset = await db.prepare(
            `SELECT id FROM marketplace_assets WHERE id = ?1 AND artist_id = ?2 AND provider_profile_id = ?3
               AND kind = ?4 AND processing_status = 'ready'`,
          ).bind(assetId, artistId, context.providerId, kind).first()
          if (!asset) throw new MarketplaceError(422, 'invalid_profile_image', `The ${kind === 'artist_photo' ? 'profile photo' : 'banner'} upload was not found or is not ready`)
        }
        const slug = input.slug && input.slug !== before.slug
          ? await this.requireFreeSlug(db, input.slug, artistId)
          : before.slug

        const row = await db.prepare(
          `UPDATE artists SET name = ?1, slug = ?2, tagline = ?3, bio = ?4, location = ?5, genres = ?6,
             links = ?7::jsonb, spotify_artist_id = ?8, apple_music_artist_id = ?9,
             profile_photo_asset_id = ?10, banner_asset_id = ?11,
             profile_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?12 AND provider_profile_id = ?13
           RETURNING id, provider_profile_id, name, slug, tagline, bio, location, genres, links, spotify_artist_id,
             apple_music_artist_id, profile_photo_asset_id, banner_asset_id, profile_updated_at`,
        ).bind(
          input.name, slug, input.tagline ?? null, input.bio ?? null, input.location ?? null, input.genres,
          JSON.stringify(compactLinks(input.links)), input.spotifyArtistId ?? null, input.appleMusicArtistId ?? null,
          input.profilePhotoAssetId === undefined ? before.profile_photo_asset_id : input.profilePhotoAssetId,
          input.bannerAssetId === undefined ? before.banner_asset_id : input.bannerAssetId,
          artistId, context.providerId,
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

  private async requireFreeSlug(db: Database, slug: string, artistId: string): Promise<string> {
    const free = await uniqueArtistSlug(db, slug, artistId)
    if (free !== slug) throw new MarketplaceError(409, 'slug_taken', 'That artist URL is already taken')
    return slug
  }

  /**
   * Public artist page. Only artists of an approved, unsuspended account with at least one LIVE
   * release are public; releases come from the same LIVE catalog query as the marketplace.
   */
  async getPublicArtist(slug: string): Promise<{artist: Omit<ArtistRow, 'provider_profile_id' | 'profile_updated_at'> & {verified: boolean}; releases: unknown[]}> {
    const artist = await this.database.prepare(
      `SELECT ${PROFILE_COLUMNS}, provider.status = 'approved' AS verified
       FROM artists a JOIN provider_profiles provider ON provider.id = a.provider_profile_id
       WHERE a.slug = ?1 AND provider.suspended_at IS NULL AND EXISTS (
         SELECT 1 FROM release_artists credit JOIN releases r ON r.id = credit.release_id
         WHERE credit.artist_id = a.id AND credit.is_primary = TRUE AND r.status = 'LIVE'
       )`,
    ).bind(slug.toLowerCase()).first<ArtistRow & {verified: boolean}>()
    if (!artist) throw new MarketplaceError(404, 'not_found', 'Artist was not found')
    const releases = await new StoreService(this.database).listCatalog(artist.id)
    const {provider_profile_id: _provider, profile_updated_at: _updated, ...publicProfile} = artist
    return {artist: {...publicProfile, verified: Boolean(artist.verified)}, releases}
  }
}
