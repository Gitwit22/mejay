import {joinArtistNames, parseCredits, releaseCreditsJsonSql} from '../marketplace/artist-credit'
import type {Database} from '../marketplace/service'

/** Everything a music player shows, for one track, in the release's current state. */
export type TrackTagData = {
  trackId: string
  releaseId: string
  providerId: string
  title: string
  artist: string
  albumArtist: string
  album: string
  trackNumber: number
  trackTotal: number
  discNumber: number
  year: string | null
  genre: string | null
  label: string | null
  copyright: string | null
  isrc: string | null
  explicit: boolean
  artwork: {storageKey: string; mimeType: string} | null
}

type Row = {
  track_id: string
  release_id: string
  provider_profile_id: string
  title: string
  version_title: string | null
  track_number: number
  disc_number: number
  explicit: boolean
  track_genre: string | null
  release_title: string
  release_version_title: string | null
  release_genre: string | null
  label_name: string | null
  original_release_date: string | Date | null
  copyright_year: number | null
  copyright_holder: string | null
  isrc: string | null
  track_artist: string | null
  release_artist: string | null
  featured_artists: string[] | null
  /** Additional release credits (more primary or featured artists), [{role, name}]. */
  release_credits?: unknown
  track_total: number
  artwork_key: string | null
  artwork_mime: string | null
}

const withVersion = (title: string, version: string | null) => (version?.trim() ? `${title} (${version.trim()})` : title)

function releaseYear(row: Row): string | null {
  if (row.original_release_date) {
    const value = row.original_release_date instanceof Date ? row.original_release_date.toISOString() : String(row.original_release_date)
    const year = value.slice(0, 4)
    if (/^\d{4}$/.test(year)) return year
  }
  return row.copyright_year ? String(row.copyright_year) : null
}

/** Pure mapping, unit-tested: "Artist feat. A & B", versions in titles, year fallback. */
export function toTagData(row: Row): TrackTagData {
  const credits = parseCredits(row.release_credits)
  const releaseLead = row.release_artist?.trim() || row.track_artist?.trim() || 'Unknown Artist'
  // Album artist: every primary artist on the release ("A & B"), never the features.
  const albumArtist = joinArtistNames([releaseLead, ...credits.filter((credit) => credit.role === 'primary').map((credit) => credit.name)])
  const trackLead = row.track_artist?.trim()
  const lead = trackLead && trackLead !== releaseLead ? trackLead : albumArtist
  const leadNames = new Set(lead.toLowerCase().split(/, | & /))
  const featured = joinArtistNames([...credits.filter((credit) => credit.role === 'featured').map((credit) => credit.name), ...(row.featured_artists ?? [])]
    .filter((name) => name && !leadNames.has(name.trim().toLowerCase())))
  const artist = featured ? `${lead} feat. ${featured}` : lead
  const copyright = row.copyright_holder?.trim()
    ? `${row.copyright_year ? `${row.copyright_year} ` : ''}${row.copyright_holder.trim()}`
    : null
  return {
    trackId: row.track_id,
    releaseId: row.release_id,
    providerId: row.provider_profile_id,
    title: withVersion(row.title, row.version_title),
    artist,
    albumArtist,
    album: withVersion(row.release_title, row.release_version_title),
    trackNumber: Number(row.track_number) || 1,
    trackTotal: Number(row.track_total) || 1,
    discNumber: Number(row.disc_number) || 1,
    year: releaseYear(row),
    genre: row.track_genre?.trim() || row.release_genre?.trim() || null,
    label: row.label_name?.trim() || null,
    copyright,
    isrc: row.isrc,
    explicit: Boolean(row.explicit),
    artwork: row.artwork_key && row.artwork_mime ? {storageKey: row.artwork_key, mimeType: row.artwork_mime} : null,
  }
}

export async function loadTrackTagData(db: Database, trackId: string): Promise<TrackTagData | null> {
  const row = await db.prepare(
    `SELECT t.id AS track_id, t.release_id, t.provider_profile_id, t.title, t.version_title, t.track_number, t.disc_number,
       t.explicit, t.genre AS track_genre,
       r.title AS release_title, r.version_title AS release_version_title, r.genre AS release_genre, r.label_name,
       r.original_release_date, r.copyright_year, r.copyright_holder,
       isrc.isrc,
       (SELECT COALESCE(ta.credited_name, a.name) FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
         WHERE ta.track_id = t.id AND ta.is_primary = TRUE ORDER BY a.name LIMIT 1) AS track_artist,
       (SELECT COALESCE(ra.credited_name, a.name) FROM release_artists ra JOIN artists a ON a.id = ra.artist_id
         WHERE ra.release_id = r.id AND ra.is_primary = TRUE ORDER BY a.name LIMIT 1) AS release_artist,
       (SELECT array_agg(COALESCE(ta.credited_name, a.name) ORDER BY a.name) FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
         WHERE ta.track_id = t.id AND ta.role = 'featured') AS featured_artists,
       ${releaseCreditsJsonSql('r')} AS release_credits,
       (SELECT COUNT(*)::integer FROM tracks sibling WHERE sibling.release_id = r.id) AS track_total,
       artwork.storage_key AS artwork_key, artwork.mime_type AS artwork_mime
     FROM tracks t
     JOIN releases r ON r.id = t.release_id
     LEFT JOIN isrc_assignments isrc ON isrc.track_id = t.id AND isrc.revoked_at IS NULL
     LEFT JOIN LATERAL (
       SELECT asset.storage_key, asset.mime_type FROM marketplace_assets asset
       WHERE asset.release_id = r.id AND asset.kind = 'artwork' AND asset.processing_status = 'ready'
       ORDER BY asset.created_at DESC LIMIT 1
     ) artwork ON TRUE
     WHERE t.id = ?1`,
  ).bind(trackId).first<Row>()
  return row ? toTagData(row) : null
}
