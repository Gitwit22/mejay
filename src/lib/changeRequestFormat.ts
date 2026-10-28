import type {ChangeDiffItem, ContributorRole, TrackContributor} from './providerApi'
import {formatPreviewStart} from './releaseTime'

/** Shown to artists replacing audio, and to staff confirming the replacement. */
export const SAME_SONG_NOTE = 'From 1 day before release, and after release, MeJay must confirm a replacement is the same song (for example a new mix or master).'

export const CONTRIBUTOR_ROLE_LABELS: Record<ContributorRole, string> = {writer: 'Writer', composer: 'Composer', producer: 'Producer', featured_artist: 'Featured artist', remixer: 'Remixer', other: 'Other'}

/** Plain-language names for the release's preview timing setting. */
export const PREVIEW_TIMING_LABELS: Record<'before_release' | 'after_release', string> = {after_release: 'After release only', before_release: 'Before release too (during pre-orders)'}

/** One side of a diff line, reading preview start and length (stored in ms) as times. */
export function formatChangeItemValue(item: Pick<ChangeDiffItem, 'key'>, value: unknown): string {
  if (item.key.endsWith('.previewStartMs')) return typeof value === 'number' ? formatPreviewStart(value) : 'Automatic'
  if (item.key.endsWith('.previewLengthMs') && typeof value === 'number') return `${value / 1000} seconds`
  return formatChangeValue(value)
}

/** One side of a change-request diff line, as plain text. */
export function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not set'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None'
    return value.map((entry) => {
      if (entry && typeof entry === 'object') {
        const artist = entry as {name?: string; role?: string}
        return artist.role ? `${artist.name} (${artist.role})` : String(artist.name ?? JSON.stringify(entry))
      }
      return String(entry)
    }).join(', ')
  }
  if (typeof value === 'object') {
    const credits = value as {featuredArtistIds?: string[]; contributors?: TrackContributor[]}
    if (credits.contributors) {
      const people = credits.contributors.map((contributor) => `${contributor.name} (${CONTRIBUTOR_ROLE_LABELS[contributor.role] ?? contributor.role})`).join(', ') || 'No contributors'
      const featured = credits.featuredArtistIds?.length ? ` · ${credits.featuredArtistIds.length} featured artist(s)` : ''
      return people + featured
    }
    return JSON.stringify(value)
  }
  if (value === 'before_release' || value === 'after_release') return PREVIEW_TIMING_LABELS[value]
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString()
  return String(value)
}
