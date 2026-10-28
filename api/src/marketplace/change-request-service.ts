import {z} from 'zod'

import {releaseDraftSchema, trackDraftSchema} from './schemas'
import {
  assertOwned, audit, MarketplaceError, providerContext, releaseFingerprint, replaceReleaseCredits,
  resolvePreviewStart, withCalendarDates, type Database,
} from './service'
import {trackCreditsSchema, writeTrackCredits, type TrackCreditsInput} from './release-submission-service'
import {enqueueReleaseDateChange} from './preorder-delivery'
import {requestedReleaseProblem} from './release-schedule'

/**
 * Changes to a release after MeJay approved it (approved, scheduled or live). The artist proposes
 * the changes as one change request; nothing on the release changes until staff approve it.
 * Replacement cover art and audio are uploaded as 'staged' assets, which no catalog, checkout,
 * preview or download query can see until approval marks them 'ready'.
 *
 * Lifecycle: draft → submitted → in_review → approved | rejected. The artist may withdraw while it
 * is a draft or submitted; once staff start the review it is locked. One open request per release.
 */

const id = z.string().trim().min(1).max(128)

const releaseChangesSchema = releaseDraftSchema.pick({
  title: true, versionTitle: true, labelName: true, catalogNumber: true, genre: true, subgenre: true, upc: true,
  originalReleaseDate: true, additionalArtists: true, copyrightYear: true, copyrightHolder: true,
  phonographicCopyrightYear: true, phonographicCopyrightHolder: true, releaseTimezone: true, previewTiming: true,
}).extend({
  /** A new release date and time; only before the release is live. */
  requestedReleaseAt: z.string().datetime({offset: true}).optional(),
}).partial().strict()

const trackChangesSchema = trackDraftSchema.pick({
  title: true, versionTitle: true, explicit: true, languageCode: true, genre: true, previewStartMs: true,
}).partial().extend({
  trackId: id,
  credits: trackCreditsSchema.optional(),
}).strict()

export const changeRequestDraftSchema = z.object({
  release: releaseChangesSchema.default({}),
  tracks: z.array(trackChangesSchema).max(100).default([]),
  /** A staged cover art upload for this request; null removes a previously chosen one. */
  artworkAssetId: id.nullable().optional(),
  audioReplacements: z.array(z.object({trackId: id, assetId: id}).strict()).max(100).default([]),
}).strict()

export const changeRequestReviewCommandSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('start_review')}).strict(),
  z.object({action: z.literal('approve'), confirmSameRecording: z.boolean().default(false)}).strict(),
  z.object({action: z.literal('reject'), note: z.string().trim().min(1).max(2000)}).strict(),
])

export type ChangeRequestDraftInput = z.infer<typeof changeRequestDraftSchema>
export type ChangeRequestReviewCommand = z.infer<typeof changeRequestReviewCommandSchema>

type StoredChanges = Pick<ChangeRequestDraftInput, 'release' | 'tracks'> & {baseline?: DiffItem[]}
type ChangeRequestRow = {
  id: string
  provider_profile_id: string
  release_id: string
  status: 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected' | 'withdrawn'
  changes: StoredChanges
  base_release_version: number
  artwork_asset_id: string | null
  audio_replacements: Array<{trackId: string; assetId: string}>
  same_recording_required: boolean
  same_recording_confirmed: boolean
  review_note: string | null
}
type ReleaseRow = Record<string, unknown> & {id: string; provider_profile_id: string; status: string; version: number; release_type: string}

export type DiffItem = {
  key: string
  label: string
  trackId?: string
  trackTitle?: string
  /** 'asset' items carry asset ids; the review UI previews them. */
  kind: 'value' | 'credits' | 'asset'
  before: unknown
  after: unknown
}

const CHANGEABLE_RELEASE_STATUSES = ['APPROVED', 'SCHEDULED', 'LIVE']
const OPEN_STATUSES = ['draft', 'submitted', 'in_review']
const SAME_RECORDING_WINDOW_MS = 24 * 60 * 60 * 1000

/** Change field → release column. Columns are constants, so building SET clauses from them is safe. */
const RELEASE_FIELDS: Array<{field: keyof z.infer<typeof releaseChangesSchema>; column: string; label: string}> = [
  {field: 'title', column: 'title', label: 'Title'},
  {field: 'versionTitle', column: 'version_title', label: 'Version'},
  {field: 'genre', column: 'genre', label: 'Genre'},
  {field: 'subgenre', column: 'subgenre', label: 'Subgenre'},
  {field: 'labelName', column: 'label_name', label: 'Label'},
  {field: 'catalogNumber', column: 'catalog_number', label: 'Catalog number'},
  {field: 'upc', column: 'upc', label: 'UPC'},
  {field: 'originalReleaseDate', column: 'original_release_date', label: 'Original release date'},
  {field: 'copyrightYear', column: 'copyright_year', label: '© year'},
  {field: 'copyrightHolder', column: 'copyright_holder', label: '© holder'},
  {field: 'phonographicCopyrightYear', column: 'phonographic_copyright_year', label: '℗ year'},
  {field: 'phonographicCopyrightHolder', column: 'phonographic_copyright_holder', label: '℗ holder'},
  {field: 'requestedReleaseAt', column: 'requested_release_at', label: 'Release date'},
  {field: 'releaseTimezone', column: 'release_timezone', label: 'Release timezone'},
  // Whether previews play during pre-orders. The store reads it live, so no preview clip needs rebuilding.
  {field: 'previewTiming', column: 'preview_timing', label: 'Previews'},
]
const TRACK_FIELDS: Array<{field: 'title' | 'versionTitle' | 'explicit' | 'languageCode' | 'genre' | 'previewStartMs'; column: string; label: string}> = [
  {field: 'title', column: 'title', label: 'Title'},
  {field: 'versionTitle', column: 'version_title', label: 'Version'},
  {field: 'explicit', column: 'explicit', label: 'Explicit'},
  {field: 'languageCode', column: 'language_code', label: 'Language'},
  {field: 'genre', column: 'genre', label: 'Genre'},
  {field: 'previewStartMs', column: 'preview_start_ms', label: 'Preview start'},
]

function normalize(value: unknown): unknown {
  if (value === undefined || value === '') return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
  return value
}

/** JSON with object keys sorted: JSONB reorders keys, so stored values must be compared this way. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => inner && typeof inner === 'object' && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : inner)
}

function same(a: unknown, b: unknown): boolean {
  return canonical(normalize(a)) === canonical(normalize(b))
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}

function hydrate(row: Record<string, unknown>): ChangeRequestRow {
  return {
    ...(row as unknown as ChangeRequestRow),
    changes: parseJson<StoredChanges>(row.changes, {release: {}, tracks: []}),
    audio_replacements: parseJson(row.audio_replacements, []),
  }
}

/** Whether replacing audio needs staff to confirm it is the same recording (from 1 day before release, and once live). */
export function sameRecordingRequired(release: {status: string; scheduled_release_at?: unknown; requested_release_at?: unknown}, now = Date.now()): boolean {
  if (release.status === 'LIVE') return true
  const releaseAt = release.scheduled_release_at ?? release.requested_release_at
  if (!releaseAt) return false
  return now >= new Date(releaseAt as string).getTime() - SAME_RECORDING_WINDOW_MS
}

type CurrentState = {
  release: ReleaseRow
  primaryArtistId: string | null
  additionalArtists: Array<{role: string; artistId: string | null; name: string}>
  artworkAssetId: string | null
  tracks: Map<string, Record<string, unknown> & {id: string; title: string; credits: TrackCreditsInput; audio_asset_id: string | null}>
}

async function loadCurrent(db: Database, releaseId: string, providerId: string, lock = false): Promise<CurrentState> {
  const release = await db.prepare(
    `SELECT * FROM releases WHERE id = ?1 AND provider_profile_id = ?2${lock ? ' FOR UPDATE' : ''}`,
  ).bind(releaseId, providerId).first<ReleaseRow>()
  if (!release) throw new MarketplaceError(404, 'not_found', 'Release was not found')
  const primary = await db.prepare(
    'SELECT artist_id FROM release_artists WHERE release_id = ?1 AND provider_profile_id = ?2 AND is_primary = TRUE',
  ).bind(releaseId, providerId).first<{artist_id: string}>()
  const {results: credits} = await db.prepare(
    `SELECT role, artist_id, display_name FROM release_artist_credits
     WHERE release_id = ?1 AND provider_profile_id = ?2 ORDER BY position`,
  ).bind(releaseId, providerId).all<{role: string; artist_id: string | null; display_name: string}>()
  const artwork = await db.prepare(
    `SELECT id FROM marketplace_assets WHERE release_id = ?1 AND kind = 'artwork' AND processing_status = 'ready'
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(releaseId).first<{id: string}>()
  const {results: tracks} = await db.prepare(
    `SELECT t.*,
       (SELECT a.id FROM marketplace_assets a WHERE a.track_id = t.id AND a.kind = 'audio' AND a.processing_status = 'ready'
         ORDER BY a.created_at DESC LIMIT 1) AS audio_asset_id,
       COALESCE((SELECT json_agg(fa.artist_id ORDER BY fa.artist_id) FROM track_artists fa
         WHERE fa.track_id = t.id AND fa.role = 'featured'), '[]'::json) AS featured_artist_ids,
       COALESCE((SELECT json_agg(json_build_object('name', c.name, 'role', c.role, 'publisherName', c.publisher_name) ORDER BY c.created_at, c.id)
         FROM track_contributors c WHERE c.track_id = t.id), '[]'::json) AS contributors
     FROM tracks t WHERE t.release_id = ?1 AND t.provider_profile_id = ?2 ORDER BY t.disc_number, t.track_number`,
  ).bind(releaseId, providerId).all<Record<string, unknown> & {id: string; title: string; audio_asset_id: string | null}>()
  return {
    release: withCalendarDates(release),
    primaryArtistId: primary?.artist_id ?? null,
    additionalArtists: credits.map((credit) => ({role: credit.role, artistId: credit.artist_id, name: credit.display_name})),
    artworkAssetId: artwork?.id ?? null,
    tracks: new Map(tracks.map((track) => [track.id, {
      ...track,
      credits: {
        featuredArtistIds: parseJson<string[]>(track.featured_artist_ids, []),
        contributors: parseJson<TrackCreditsInput['contributors']>(track.contributors, []).map((contributor) => ({...contributor, publisherName: contributor.publisherName ?? null})),
      },
    }])),
  }
}

function sortedCredits(credits: TrackCreditsInput): TrackCreditsInput {
  return {
    featuredArtistIds: [...credits.featuredArtistIds].sort(),
    contributors: credits.contributors.map((contributor) => ({name: contributor.name, role: contributor.role, publisherName: contributor.publisherName ?? null})),
  }
}

/** Field-by-field old → new list for everything the request would change. Unchanged fields are left out. */
export function buildDiff(current: CurrentState, request: Pick<ChangeRequestRow, 'changes' | 'artwork_asset_id' | 'audio_replacements'>): DiffItem[] {
  const items: DiffItem[] = []
  const release = request.changes.release ?? {}
  for (const {field, column, label} of RELEASE_FIELDS) {
    if (!(field in release)) continue
    const after = release[field as keyof typeof release]
    if (!same(current.release[column], after)) items.push({key: `release.${field}`, label, kind: 'value', before: normalize(current.release[column]), after: normalize(after)})
  }
  if (release.additionalArtists !== undefined) {
    const before = current.additionalArtists.map(({role, artistId, name}) => ({role, artistId, name}))
    const after = release.additionalArtists.map((artist) => ({role: artist.role, artistId: artist.artistId ?? null, name: artist.name.replace(/\s+/g, ' ').trim()}))
    // Account artists are stored under their current name, so compare them by id.
    const key = (list: typeof before) => JSON.stringify(list.map((artist) => [artist.role, artist.artistId ?? artist.name.toLowerCase()]))
    if (key(before) !== key(after)) items.push({key: 'release.additionalArtists', label: 'Additional artists', kind: 'credits', before, after})
  }
  if (request.artwork_asset_id && request.artwork_asset_id !== current.artworkAssetId) {
    items.push({key: 'release.artwork', label: 'Cover art', kind: 'asset', before: current.artworkAssetId, after: request.artwork_asset_id})
  }
  for (const change of request.changes.tracks ?? []) {
    const track = current.tracks.get(change.trackId)
    if (!track) continue
    for (const {field, column, label} of TRACK_FIELDS) {
      if (!(field in change)) continue
      const after = change[field]
      if (!same(track[column], after)) items.push({key: `track.${track.id}.${field}`, label, trackId: track.id, trackTitle: track.title, kind: 'value', before: normalize(track[column]), after: normalize(after)})
    }
    if (change.credits) {
      const before = sortedCredits(track.credits)
      const after = sortedCredits(change.credits)
      if (canonical(before) !== canonical(after)) items.push({key: `track.${track.id}.credits`, label: 'Credits', trackId: track.id, trackTitle: track.title, kind: 'credits', before, after})
    }
  }
  for (const replacement of request.audio_replacements ?? []) {
    const track = current.tracks.get(replacement.trackId)
    if (!track) continue
    items.push({key: `track.${track.id}.audio`, label: 'Audio', trackId: track.id, trackTitle: track.title, kind: 'asset', before: track.audio_asset_id, after: replacement.assetId})
  }
  return items
}

function describe(row: ChangeRequestRow, diff: DiffItem[]) {
  const {changes, ...rest} = row
  return {...rest, changes: {release: changes.release ?? {}, tracks: changes.tracks ?? []}, diff}
}

/** Marks a request's leftover staged uploads failed and returns their storage keys for best-effort deletion. */
async function discardStagedAssets(db: Database, changeRequestId: string, keepAssetIds: string[] = []): Promise<string[]> {
  const {results} = await db.prepare(
    `UPDATE marketplace_assets SET processing_status = 'failed'
     WHERE metadata->>'changeRequestId' = ?1 AND processing_status IN ('pending', 'staged') AND NOT (id = ANY(?2::text[]))
     RETURNING storage_key`,
  ).bind(changeRequestId, keepAssetIds).all<{storage_key: string}>()
  return results.map((row) => row.storage_key)
}

async function assertStagedAsset(db: Database, request: ChangeRequestRow, assetId: string, target: {kind: 'artwork'; releaseId: string} | {kind: 'audio'; trackId: string}): Promise<void> {
  const asset = await db.prepare(
    `SELECT id FROM marketplace_assets WHERE id = ?1 AND provider_profile_id = ?2 AND kind = ?3
       AND processing_status = 'staged' AND metadata->>'changeRequestId' = ?4
       AND ${target.kind === 'artwork' ? 'release_id' : 'track_id'} = ?5`,
  ).bind(assetId, request.provider_profile_id, target.kind, request.id, target.kind === 'artwork' ? target.releaseId : target.trackId).first()
  if (!asset) throw new MarketplaceError(422, 'change_request_asset_invalid', target.kind === 'artwork' ? 'Upload the new cover art again.' : 'Upload the replacement audio again.')
}

export class ReleaseChangeRequestService {
  constructor(private readonly database: Database & {transaction: <T>(callback: (db: Database) => Promise<T>) => Promise<T>}) {}

  /** The release's open request, or its most recent closed one so the artist sees the outcome. */
  async getCurrent(userId: string, releaseId: string): Promise<unknown> {
    const context = await providerContext(this.database, userId, false)
    const row = await this.database.prepare(
      `SELECT * FROM release_change_requests WHERE release_id = ?1 AND provider_profile_id = ?2
       ORDER BY CASE WHEN status IN ('draft', 'submitted', 'in_review') THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
    ).bind(releaseId, context.providerId).first<Record<string, unknown>>()
    const current = await loadCurrent(this.database, releaseId, context.providerId)
    if (!row) return {request: null, sameRecordingRequired: sameRecordingRequired(current.release)}
    const request = hydrate(row)
    return {request: describe(request, buildDiff(current, request)), sameRecordingRequired: sameRecordingRequired(current.release)}
  }

  /** Creates or updates the release's draft request. Only for approved, scheduled or live releases. */
  async saveDraft(userId: string, releaseId: string, input: ChangeRequestDraftInput): Promise<{request: unknown; discardedStorageKeys: string[]}> {
    return this.database.transaction(async (db) => {
      const context = await providerContext(db, userId)
      const current = await loadCurrent(db, releaseId, context.providerId, true)
      if (!CHANGEABLE_RELEASE_STATUSES.includes(current.release.status)) {
        throw new MarketplaceError(409, 'release_not_changeable', 'Change requests are for approved releases. Edit the draft directly instead.')
      }
      let row = await db.prepare(
        `SELECT * FROM release_change_requests WHERE release_id = ?1 AND provider_profile_id = ?2
           AND status IN ('draft', 'submitted', 'in_review') FOR UPDATE`,
      ).bind(releaseId, context.providerId).first<Record<string, unknown>>()
      if (row && row.status !== 'draft') {
        throw new MarketplaceError(409, row.status === 'in_review' ? 'change_request_in_review' : 'change_request_submitted',
          row.status === 'in_review' ? 'MeJay is reviewing your changes, so they can no longer be edited.' : 'Withdraw your submitted changes before editing them.')
      }
      if (!row) {
        row = await db.prepare(
          `INSERT INTO release_change_requests (id, provider_profile_id, release_id, base_release_version, created_by_user_id)
           VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *`,
        ).bind(crypto.randomUUID(), context.providerId, releaseId, current.release.version, userId).first<Record<string, unknown>>()
      }
      const request = hydrate(row!)

      if (input.release.requestedReleaseAt !== undefined && current.release.status === 'LIVE') {
        throw new MarketplaceError(422, 'release_already_live', 'This release is already out, so its release date can no longer change.')
      }
      for (const change of input.tracks) {
        const track = current.tracks.get(change.trackId)
        if (!track) throw new MarketplaceError(404, 'not_found', 'Track was not found on this release')
        if (change.previewStartMs !== undefined) resolvePreviewStart(track, {previewStartMs: change.previewStartMs})
        for (const artistId of change.credits?.featuredArtistIds ?? []) await assertOwned(db, 'artists', artistId, context.providerId)
      }
      if (new Set(input.tracks.map((change) => change.trackId)).size !== input.tracks.length) {
        throw new MarketplaceError(422, 'duplicate_track_change', 'Each track can be listed once.')
      }
      if (input.artworkAssetId) await assertStagedAsset(db, request, input.artworkAssetId, {kind: 'artwork', releaseId})
      const replacedTracks = new Set<string>()
      for (const replacement of input.audioReplacements) {
        if (!current.tracks.has(replacement.trackId)) throw new MarketplaceError(404, 'not_found', 'Track was not found on this release')
        if (replacedTracks.has(replacement.trackId)) throw new MarketplaceError(422, 'duplicate_track_change', 'Each track can have one replacement file.')
        replacedTracks.add(replacement.trackId)
        await assertStagedAsset(db, request, replacement.assetId, {kind: 'audio', trackId: replacement.trackId})
      }

      const artworkAssetId = input.artworkAssetId === undefined ? request.artwork_asset_id : input.artworkAssetId
      const changes: StoredChanges = {release: input.release, tracks: input.tracks}
      const updated = hydrate((await db.prepare(
        `UPDATE release_change_requests SET changes = ?1::jsonb, artwork_asset_id = ?2, audio_replacements = ?3::jsonb, updated_at = ?4
         WHERE id = ?5 RETURNING *`,
      ).bind(JSON.stringify(changes), artworkAssetId, JSON.stringify(input.audioReplacements), new Date().toISOString(), request.id).first<Record<string, unknown>>())!)
      // Uploads the artist replaced or removed are no longer part of the request.
      const keep = [artworkAssetId, ...input.audioReplacements.map((replacement) => replacement.assetId)].filter((value): value is string => Boolean(value))
      const discardedStorageKeys = await discardStagedAssetsExceptPending(db, request.id, keep)
      return {request: describe(updated, buildDiff(current, updated)), discardedStorageKeys}
    })
  }

  async submit(userId: string, releaseId: string): Promise<unknown> {
    return this.database.transaction(async (db) => {
      const context = await providerContext(db, userId)
      const current = await loadCurrent(db, releaseId, context.providerId, true)
      const row = await db.prepare(
        `SELECT * FROM release_change_requests WHERE release_id = ?1 AND provider_profile_id = ?2 AND status = 'draft' FOR UPDATE`,
      ).bind(releaseId, context.providerId).first<Record<string, unknown>>()
      if (!row) throw new MarketplaceError(404, 'change_request_not_found', 'There are no draft changes to submit.')
      if (!CHANGEABLE_RELEASE_STATUSES.includes(current.release.status)) {
        throw new MarketplaceError(409, 'release_not_changeable', 'This release can no longer take change requests.')
      }
      const request = hydrate(row)
      const diff = buildDiff(current, request)
      if (diff.length === 0) throw new MarketplaceError(422, 'change_request_empty', 'Nothing has changed yet. Edit a field or upload a new file first.')
      const newDate = request.changes.release?.requestedReleaseAt
      if (newDate && diff.some((item) => item.key === 'release.requestedReleaseAt')) {
        if (current.release.status === 'LIVE') throw new MarketplaceError(422, 'release_already_live', 'This release is already out, so its release date can no longer change.')
        const problem = requestedReleaseProblem(newDate)
        if (problem) throw new MarketplaceError(422, 'release_date_too_soon', problem)
      }
      const required = request.audio_replacements.length > 0 && sameRecordingRequired(current.release)
      const baseline = diff.map(({key, before}) => ({key, before})) as DiffItem[]
      const updated = hydrate((await db.prepare(
        `UPDATE release_change_requests SET status = 'submitted', submitted_at = ?1, updated_at = ?1,
           same_recording_required = ?2, changes = changes || ?3::jsonb
         WHERE id = ?4 RETURNING *`,
      ).bind(new Date().toISOString(), required, JSON.stringify({baseline}), request.id).first<Record<string, unknown>>())!)
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'release', entityId: releaseId, action: 'release.change_request_submitted', after: {changeRequestId: request.id, diff}})
      return describe(updated, diff)
    })
  }

  /** Draft or submitted only: once MeJay starts reviewing, the request is locked. */
  async withdraw(userId: string, releaseId: string): Promise<{request: unknown; discardedStorageKeys: string[]}> {
    return this.database.transaction(async (db) => {
      const context = await providerContext(db, userId)
      const row = await db.prepare(
        `SELECT * FROM release_change_requests WHERE release_id = ?1 AND provider_profile_id = ?2
           AND status IN ('draft', 'submitted', 'in_review') FOR UPDATE`,
      ).bind(releaseId, context.providerId).first<Record<string, unknown>>()
      if (!row) throw new MarketplaceError(404, 'change_request_not_found', 'There are no open changes to withdraw.')
      if (row.status === 'in_review') throw new MarketplaceError(409, 'change_request_in_review', 'MeJay has started reviewing these changes, so they can no longer be withdrawn.')
      const updated = await db.prepare(
        `UPDATE release_change_requests SET status = 'withdrawn', updated_at = ?1 WHERE id = ?2 RETURNING *`,
      ).bind(new Date().toISOString(), row.id).first<Record<string, unknown>>()
      const discardedStorageKeys = await discardStagedAssets(db, row.id as string)
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'release', entityId: releaseId, action: 'release.change_request_withdrawn', after: {changeRequestId: row.id}})
      const request = hydrate(updated!)
      return {request: describe(request, []), discardedStorageKeys}
    })
  }

  // ---- Staff ----

  async listForReview(userId: string): Promise<unknown[]> {
    await requireStaff(this.database, userId)
    const {results} = await this.database.prepare(
      `SELECT cr.id, cr.release_id, cr.status, cr.submitted_at, cr.same_recording_required,
         jsonb_array_length(cr.audio_replacements) AS audio_replacement_count, cr.artwork_asset_id IS NOT NULL AS replaces_artwork,
         r.title AS release_title, r.status AS release_status, p.display_name AS provider_name
       FROM release_change_requests cr JOIN releases r ON r.id = cr.release_id
       JOIN provider_profiles p ON p.id = cr.provider_profile_id
       WHERE cr.status IN ('submitted', 'in_review') ORDER BY cr.submitted_at`,
    ).all()
    return results
  }

  async getForReview(userId: string, changeRequestId: string): Promise<unknown> {
    const staff = await requireStaff(this.database, userId)
    const row = await this.database.prepare('SELECT * FROM release_change_requests WHERE id = ?1').bind(changeRequestId).first<Record<string, unknown>>()
    if (!row) throw new MarketplaceError(404, 'not_found', 'Change request was not found')
    const request = hydrate(row)
    const current = await loadCurrent(this.database, request.release_id, request.provider_profile_id)
    const diff = buildDiff(current, request)
    return {
      role: staff.role,
      request: describe(request, diff),
      release: {id: current.release.id, title: current.release.title, status: current.release.status, version: current.release.version,
        scheduled_release_at: current.release.scheduled_release_at, release_timezone: current.release.release_timezone},
      sameRecordingRequired: request.same_recording_required || (request.audio_replacements.length > 0 && sameRecordingRequired(current.release)),
      stale: staleItems(request, diff),
    }
  }

  async command(userId: string, changeRequestId: string, command: ChangeRequestReviewCommand): Promise<{request: unknown; discardedStorageKeys: string[]}> {
    return this.database.transaction(async (db) => {
      const staff = await db.prepare('SELECT role, protected_owner FROM marketplace_staff WHERE user_id = ?1').bind(userId).first<{role: 'reviewer' | 'admin'; protected_owner: boolean}>()
      if (!staff) throw new MarketplaceError(403, 'marketplace_staff_required', 'Marketplace staff access is required')
      const row = await db.prepare('SELECT * FROM release_change_requests WHERE id = ?1 FOR UPDATE').bind(changeRequestId).first<Record<string, unknown>>()
      if (!row) throw new MarketplaceError(404, 'not_found', 'Change request was not found')
      const request = hydrate(row)
      const membership = await db.prepare('SELECT 1 AS member FROM provider_members WHERE user_id = ?1 AND provider_profile_id = ?2')
        .bind(userId, request.provider_profile_id).first()
      if (membership && !(staff.role === 'admin' && staff.protected_owner)) {
        throw new MarketplaceError(403, 'self_review_forbidden', 'Staff cannot review their own provider releases')
      }
      const now = new Date().toISOString()
      const releaseAudit = (action: string, after: unknown) => audit(db, {providerId: request.provider_profile_id, actorUserId: userId, entityType: 'release', entityId: request.release_id, action, after})

      if (command.action === 'start_review') {
        if (request.status !== 'submitted') throw new MarketplaceError(409, 'invalid_transition', `Cannot start reviewing a ${request.status} change request`)
        const updated = await db.prepare(`UPDATE release_change_requests SET status = 'in_review', updated_at = ?1 WHERE id = ?2 RETURNING *`).bind(now, request.id).first<Record<string, unknown>>()
        await releaseAudit('release.change_request_review_started', {changeRequestId: request.id})
        return {request: describe(hydrate(updated!), []), discardedStorageKeys: []}
      }
      if (!['submitted', 'in_review'].includes(request.status)) {
        throw new MarketplaceError(409, 'invalid_transition', `Cannot ${command.action} a ${request.status} change request`)
      }
      if (command.action === 'reject') {
        const updated = await db.prepare(
          `UPDATE release_change_requests SET status = 'rejected', review_note = ?1, reviewed_by_user_id = ?2, reviewed_at = ?3, updated_at = ?3
           WHERE id = ?4 RETURNING *`,
        ).bind(command.note, userId, now, request.id).first<Record<string, unknown>>()
        const discardedStorageKeys = await discardStagedAssets(db, request.id)
        await releaseAudit('release.change_request_rejected', {changeRequestId: request.id, note: command.note})
        return {request: describe(hydrate(updated!), []), discardedStorageKeys}
      }

      // approve
      const current = await loadCurrent(db, request.release_id, request.provider_profile_id, true)
      if (!CHANGEABLE_RELEASE_STATUSES.includes(current.release.status)) {
        throw new MarketplaceError(409, 'release_not_changeable', `The release is ${current.release.status}, so these changes can no longer be applied.`)
      }
      const diff = buildDiff(current, request)
      const stale = staleItems(request, diff)
      if (stale.length > 0) {
        throw new MarketplaceError(409, 'change_request_stale', `The release changed after these changes were submitted (${stale.join(', ')}). Reject the request so the artist can submit it again.`)
      }
      const required = request.same_recording_required || (request.audio_replacements.length > 0 && sameRecordingRequired(current.release))
      if (required && !command.confirmSameRecording) {
        throw new MarketplaceError(422, 'same_recording_confirmation_required', 'Listen to the new audio and confirm it is the same song (for example a new mix or master) before approving.')
      }
      const dateChange = diff.find((item) => item.key === 'release.requestedReleaseAt')
      if (dateChange && current.release.status === 'LIVE') {
        throw new MarketplaceError(409, 'release_already_live', 'This release is already out, so its release date can no longer change.')
      }
      if (dateChange && new Date(dateChange.after as string).getTime() <= Date.now()) {
        throw new MarketplaceError(422, 'schedule_must_be_future', 'The requested release date has already passed. Reject the request so the artist can pick a new date.')
      }

      await applyChanges(db, current, request, diff)
      const updatedRelease = await db.prepare(
        `UPDATE releases SET version = version + 1, updated_at = ?1,
           scheduled_release_at = CASE WHEN status = 'SCHEDULED' AND ?2::timestamptz IS NOT NULL THEN ?2::timestamptz ELSE scheduled_release_at END
         WHERE id = ?3 RETURNING version, scheduled_release_at, release_timezone, status`,
      ).bind(now, dateChange ? dateChange.after : null, request.release_id).first<{version: number; scheduled_release_at: string | Date | null; release_timezone: string | null; status: string}>()
      if (dateChange && updatedRelease?.status === 'SCHEDULED' && updatedRelease.scheduled_release_at) {
        await enqueueReleaseDateChange(db, request.release_id, updatedRelease.version, {
          releaseAt: new Date(updatedRelease.scheduled_release_at).toISOString(),
          releaseTimezone: updatedRelease.release_timezone,
          previousReleaseAt: current.release.scheduled_release_at ? new Date(current.release.scheduled_release_at as string).toISOString() : null,
        })
      }
      const approvedAssetIds = [request.artwork_asset_id, ...request.audio_replacements.map((replacement) => replacement.assetId)].filter((value): value is string => Boolean(value))
      if (approvedAssetIds.length > 0) {
        // Now the newest ready upload, so the store, previews and new purchases use it. Buyers keep the files they already have.
        await db.prepare(
          `UPDATE marketplace_assets SET processing_status = 'ready', created_at = ?1
           WHERE id = ANY(?2::text[]) AND processing_status = 'staged' AND metadata->>'changeRequestId' = ?3`,
        ).bind(now, approvedAssetIds, request.id).run()
      }
      const discardedStorageKeys = await discardStagedAssets(db, request.id, approvedAssetIds)
      const updated = await db.prepare(
        `UPDATE release_change_requests SET status = 'approved', same_recording_confirmed = ?1, reviewed_by_user_id = ?2, reviewed_at = ?3, updated_at = ?3
         WHERE id = ?4 RETURNING *`,
      ).bind(required && command.confirmSameRecording, userId, now, request.id).first<Record<string, unknown>>()
      await releaseAudit('release.change_request_approved', {changeRequestId: request.id, diff, sameRecordingConfirmed: required})
      return {request: {...describe(hydrate(updated!), diff), release_date_needed: Boolean(dateChange && current.release.status === 'APPROVED')}, discardedStorageKeys}
    })
  }
}

/** Fields whose current value no longer matches what the artist saw when they submitted. */
function staleItems(request: ChangeRequestRow, diff: DiffItem[]): string[] {
  const baseline = request.changes.baseline ?? []
  const now = new Map(diff.map((item) => [item.key, item]))
  return baseline.filter((base) => {
    const item = now.get(base.key)
    // Already matches the request (e.g. made the same change elsewhere): nothing to apply, not stale.
    if (!item) return false
    return canonical(item.before) !== canonical(base.before)
  }).map((base) => base.key)
}

async function applyChanges(db: Database, current: CurrentState, request: ChangeRequestRow, diff: DiffItem[]): Promise<void> {
  const keys = new Set(diff.map((item) => item.key))
  const release = request.changes.release ?? {}
  const releaseId = current.release.id
  const providerId = current.release.provider_profile_id

  const sets: string[] = []
  const values: unknown[] = []
  for (const {field, column} of RELEASE_FIELDS) {
    if (!keys.has(`release.${field}`)) continue
    values.push(normalize(release[field as keyof typeof release]))
    sets.push(`${column} = ?${values.length}`)
  }
  if (sets.length > 0) {
    const nextTitle = keys.has('release.title') ? release.title! : current.release.title as string
    const nextVersion = keys.has('release.versionTitle') ? release.versionTitle ?? null : current.release.version_title as string | null
    const nextDate = keys.has('release.originalReleaseDate') ? release.originalReleaseDate ?? null : current.release.original_release_date as string | null
    const fingerprint = releaseFingerprint({
      primaryArtistId: current.primaryArtistId ?? '', title: nextTitle, versionTitle: nextVersion,
      releaseType: current.release.release_type as 'single' | 'ep' | 'album', originalReleaseDate: nextDate,
    })
    const duplicate = await db.prepare(
      `SELECT id FROM releases WHERE provider_profile_id = ?1 AND id <> ?2 AND duplicate_fingerprint = ?3 AND status <> 'TAKEN_DOWN' LIMIT 1`,
    ).bind(providerId, releaseId, fingerprint).first()
    if (duplicate) throw new MarketplaceError(409, 'duplicate_release', 'The artist already has another release with this title, version and date.')
    values.push(fingerprint)
    sets.push(`duplicate_fingerprint = ?${values.length}`)
    values.push(releaseId)
    await db.prepare(`UPDATE releases SET ${sets.join(', ')} WHERE id = ?${values.length}`).bind(...values).run()
  }
  if (keys.has('release.additionalArtists') && release.additionalArtists && current.primaryArtistId) {
    await replaceReleaseCredits(db, providerId, releaseId, current.primaryArtistId, release.additionalArtists)
  }
  for (const change of request.changes.tracks ?? []) {
    const track = current.tracks.get(change.trackId)
    if (!track) continue
    const trackSets: string[] = []
    const trackValues: unknown[] = []
    for (const {field, column} of TRACK_FIELDS) {
      if (!keys.has(`track.${track.id}.${field}`)) continue
      const value = field === 'previewStartMs' ? resolvePreviewStart(track, {previewStartMs: change.previewStartMs}) : normalize(change[field])
      trackValues.push(value)
      trackSets.push(`${column} = ?${trackValues.length}`)
    }
    if (trackSets.length > 0) {
      trackValues.push(track.id)
      await db.prepare(`UPDATE tracks SET ${trackSets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?${trackValues.length}`).bind(...trackValues).run()
    }
    if (keys.has(`track.${track.id}.credits`) && change.credits) await writeTrackCredits(db, providerId, track.id, change.credits)
  }
  if (request.audio_replacements.length > 0) {
    // The preview clip setting stays; touching the track lets the preview sweep pick up the new source sooner.
    await db.prepare('UPDATE tracks SET updated_at = CURRENT_TIMESTAMP WHERE id = ANY(?1::text[])')
      .bind(request.audio_replacements.map((replacement) => replacement.trackId)).run()
  }
}

/** Like discardStagedAssets, but leaves uploads still in progress so a save mid-upload doesn't break them. */
async function discardStagedAssetsExceptPending(db: Database, changeRequestId: string, keepAssetIds: string[]): Promise<string[]> {
  const {results} = await db.prepare(
    `UPDATE marketplace_assets SET processing_status = 'failed'
     WHERE metadata->>'changeRequestId' = ?1 AND processing_status = 'staged' AND NOT (id = ANY(?2::text[]))
     RETURNING storage_key`,
  ).bind(changeRequestId, keepAssetIds).all<{storage_key: string}>()
  return results.map((row) => row.storage_key)
}

async function requireStaff(db: Database, userId: string): Promise<{role: 'reviewer' | 'admin'}> {
  const staff = await db.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1').bind(userId).first<{role: 'reviewer' | 'admin'}>()
  if (!staff) throw new MarketplaceError(403, 'marketplace_staff_required', 'Marketplace staff access is required')
  return staff
}
