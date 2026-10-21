import {bootstrapProviderAccount} from './onboarding'
import {MARKETPLACE_STORAGE_PREFIX} from './storage-keys'
import {userHasArtistPortalAccess} from '../account/artist-access'
import {buildGeneratedIsrc, externalIsrcProblem, type IsrcGenerationConfig} from './isrc'
import type {PrivateBucket} from '../services/r2'
import type {
  ArtistInput,
  AssetInput,
  GeneratedIsrcInput,
  IsrcAssignmentInput,
  PriceInput,
  ProductInput,
  ProviderInput,
  ProviderSettingsInput,
  ReleaseDraftInput,
  ReleaseInput,
  ReleasePriceInput,
  RevenueSplitsInput,
  TrackPriceInput,
  RightsDeclarationInput,
  SubmitReleaseInput,
  TrackInput,
  TrackDraftInput,
  TransitionInput,
  UploadInitInput,
} from './schemas'
import {formatMinimumPrice, getReleaseSaleReadiness, MINIMUM_RELEASE_PRICE_MINOR} from './sale-policy'
import {inspectUpload, validateInspectedUpload, isTruncatedJpegHeader} from './upload-validation'
import {slugifyArtistName} from './artist-profile'
import {releaseCertificationProblems, snapshotReleaseCertification, type RequestMeta} from './release-submission-service'
import {requestedReleaseProblem} from './release-schedule'
import {maxPreviewStartMs} from '../audio/transcode'
import {formatArtistCredit} from './artist-credit'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
  run: () => Promise<unknown>
}

export type Database = {
  prepare: (sql: string) => Statement
  transaction: <T>(callback: (database: Database) => Promise<T>) => Promise<T>
}

export type ProviderContext = {
  providerId: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
}

type TrackIsrcContext = {
  id: string
  title: string
  provider_profile_id: string
  provider_name: string | null
  artist_id: string | null
  artist_name: string | null
  status: ReleaseStatus
}

function normalizeReleasePart(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? ''
}

export function releaseFingerprint(input: {
  primaryArtistId: string
  title: string
  versionTitle?: string | null
  releaseType: ReleaseInput['releaseType']
  originalReleaseDate?: string | null
}): string {
  return [
    input.primaryArtistId,
    normalizeReleasePart(input.title),
    normalizeReleasePart(input.versionTitle),
    input.releaseType,
    input.originalReleaseDate ?? '',
  ].join('|')
}

export const PROVIDER_STORAGE_LIMIT_BYTES = 20 * 1024 * 1024 * 1024

export function exceedsProviderStorageLimit(currentBytes: number, incomingBytes: number): boolean {
  return !Number.isSafeInteger(currentBytes) || currentBytes < 0
    || !Number.isSafeInteger(incomingBytes) || incomingBytes <= 0
    || currentBytes + incomingBytes > PROVIDER_STORAGE_LIMIT_BYTES
}

type ReleaseStatus =
  | 'DRAFT'
  | 'METADATA_COMPLETE'
  | 'RIGHTS_COMPLETE'
  | 'ISRC_COMPLETE'
  | 'PRICING_COMPLETE'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'LIVE'
  | 'REJECTED'
  | 'TAKEN_DOWN'

export class MarketplaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

const transitions: Record<ReleaseStatus, readonly ReleaseStatus[]> = {
  DRAFT: ['METADATA_COMPLETE'],
  METADATA_COMPLETE: ['RIGHTS_COMPLETE'],
  RIGHTS_COMPLETE: ['ISRC_COMPLETE'],
  ISRC_COMPLETE: ['PRICING_COMPLETE'],
  PRICING_COMPLETE: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['CHANGES_REQUESTED', 'APPROVED', 'REJECTED'],
  CHANGES_REQUESTED: ['SUBMITTED'],
  APPROVED: ['SCHEDULED', 'LIVE'],
  SCHEDULED: ['LIVE', 'TAKEN_DOWN'],
  LIVE: ['APPROVED', 'TAKEN_DOWN'],
  REJECTED: [],
  TAKEN_DOWN: ['UNDER_REVIEW'],
}

export function isReleaseTransitionAllowed(current: ReleaseStatus, target: ReleaseStatus): boolean {
  return transitions[current].includes(target)
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function providerContext(db: Database, userId: string, mutate = true): Promise<ProviderContext> {
  if (mutate && !(await userHasArtistPortalAccess(db, userId))) {
    throw new MarketplaceError(403, 'pro_subscription_required', 'An active Pro subscription is required for Artist access')
  }
  const row = await db
    .prepare(`SELECT member.provider_profile_id, member.role, provider.suspended_at
      FROM provider_members member JOIN provider_profiles provider ON provider.id = member.provider_profile_id
      WHERE member.user_id = ?1 ORDER BY member.created_at LIMIT 1`)
    .bind(userId)
    .first<{provider_profile_id: string; role: ProviderContext['role']; suspended_at: string | null}>()
  if (!row) throw new MarketplaceError(403, 'provider_required', 'A provider profile is required')
  if (mutate && row.suspended_at) throw new MarketplaceError(403, 'provider_suspended', 'This provider account is suspended')
  if (mutate && !['owner', 'admin', 'editor'].includes(row.role)) {
    throw new MarketplaceError(403, 'provider_write_forbidden', 'Provider write access is required')
  }
  return {providerId: row.provider_profile_id, role: row.role}
}

export async function assertOwned(db: Database, table: 'artists' | 'releases' | 'tracks' | 'products', id: string, providerId: string): Promise<void> {
  const row = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ?1 AND provider_profile_id = ?2`)
    .bind(id, providerId)
    .first<{id: string}>()
  if (!row) throw new MarketplaceError(404, 'not_found', 'Marketplace resource was not found')
}

const lockedReleaseStatuses: readonly ReleaseStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'LIVE', 'REJECTED', 'TAKEN_DOWN']

/** Statuses a provider may move their own release into; everything else is a staff decision. */
const PROVIDER_TRANSITION_TARGETS = new Set<string>([
  'DRAFT', 'METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE', 'PRICING_COMPLETE', 'SUBMITTED',
])

async function assertProviderCanSubmit(db: Database, providerId: string): Promise<void> {
  const provider = await db.prepare(
    'SELECT status, suspended_at FROM provider_profiles WHERE id = ?1',
  ).bind(providerId).first<{status: string; suspended_at: string | null}>()
  if (provider?.suspended_at) {
    throw new MarketplaceError(409, 'provider_suspended', 'Suspended providers cannot submit releases')
  }
  if (provider?.status !== 'approved') {
    throw new MarketplaceError(409, 'provider_not_approved', 'The provider must be approved before submitting releases')
  }
}

const JPEG_HEADER_SCAN_BYTES = 4 * 1024 * 1024

export function isReleaseMutable(status: ReleaseStatus): boolean {
  return !lockedReleaseStatuses.includes(status)
}

function assertMutableStatus(status: ReleaseStatus): void {
  if (!isReleaseMutable(status)) {
    throw new MarketplaceError(409, 'release_locked', 'Submitted releases cannot be modified')
  }
}

export async function assertReleaseMutable(db: Database, releaseId: string, providerId: string): Promise<void> {
  const release = await db.prepare(
    'SELECT status FROM releases WHERE id = ?1 AND provider_profile_id = ?2',
  ).bind(releaseId, providerId).first<{status: ReleaseStatus}>()
  if (!release) throw new MarketplaceError(404, 'not_found', 'Marketplace resource was not found')
  assertMutableStatus(release.status)
}

export async function assertTrackMutable(db: Database, trackId: string, providerId: string): Promise<void> {
  const release = await db.prepare(
    `SELECT r.status FROM tracks t JOIN releases r ON r.id = t.release_id
     WHERE t.id = ?1 AND t.provider_profile_id = ?2`,
  ).bind(trackId, providerId).first<{status: ReleaseStatus}>()
  if (!release) throw new MarketplaceError(404, 'not_found', 'Marketplace resource was not found')
  assertMutableStatus(release.status)
}

/** `requireMutable` guards artist edits; approval-time assignment runs after the release is locked. */
async function loadTrackIsrcContext(db: Database, trackId: string, providerId: string, requireMutable = true): Promise<TrackIsrcContext> {
  const track = await db.prepare(
    `SELECT
      t.id,
      t.title,
      t.provider_profile_id,
      provider.display_name AS provider_name,
      artist.id AS artist_id,
      artist.name AS artist_name,
      release.status
     FROM tracks t
     JOIN releases release ON release.id = t.release_id AND release.provider_profile_id = t.provider_profile_id
     JOIN provider_profiles provider ON provider.id = t.provider_profile_id
     LEFT JOIN track_artists track_artist
       ON track_artist.track_id = t.id AND track_artist.provider_profile_id = t.provider_profile_id AND track_artist.is_primary = TRUE
     LEFT JOIN artists artist
       ON artist.id = track_artist.artist_id AND artist.provider_profile_id = t.provider_profile_id
     WHERE t.id = ?1 AND t.provider_profile_id = ?2`,
  ).bind(trackId, providerId).first<TrackIsrcContext>()
  if (!track) throw new MarketplaceError(404, 'not_found', 'Marketplace resource was not found')
  if (requireMutable) assertMutableStatus(track.status)
  return track
}

async function assertTrackHasNoIsrc(db: Database, trackId: string): Promise<void> {
  const existing = await db.prepare(
    'SELECT id FROM isrc_assignments WHERE track_id = ?1 AND revoked_at IS NULL',
  ).bind(trackId).first<{id: string}>()
  if (existing) throw new MarketplaceError(409, 'isrc_already_assigned', 'This recording already has an ISRC assignment')
}

async function assertProductMutable(db: Database, productId: string, providerId: string): Promise<void> {
  const release = await db.prepare(
    `SELECT r.status FROM products p
     JOIN releases r ON r.id = COALESCE(p.release_id, (SELECT t.release_id FROM tracks t WHERE t.id = p.track_id))
     WHERE p.id = ?1 AND p.provider_profile_id = ?2`,
  ).bind(productId, providerId).first<{status: ReleaseStatus}>()
  if (!release) throw new MarketplaceError(404, 'not_found', 'Marketplace resource was not found')
  assertMutableStatus(release.status)
}

export async function audit(db: Database, args: {
  providerId: string
  actorUserId: string
  entityType: string
  entityId: string
  action: string
  before?: unknown
  after?: unknown
  metadata?: unknown
}): Promise<void> {
  await db.prepare(
    `INSERT INTO marketplace_audit_events
      (id, provider_profile_id, actor_user_id, entity_type, entity_id, action, before_data, after_data, metadata)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(
    crypto.randomUUID(),
    args.providerId,
    args.actorUserId,
    args.entityType,
    args.entityId,
    args.action,
    args.before === undefined ? null : JSON.stringify(args.before),
    args.after === undefined ? null : JSON.stringify(args.after),
    JSON.stringify(args.metadata ?? {}),
  ).run()
}

/** First free slug among base, base-2 … base-50, then a random suffix. */
export async function uniqueArtistSlug(db: Database, base: string, excludeArtistId?: string): Promise<string> {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base.slice(0, 70)}-${attempt}`
    const taken = await db.prepare('SELECT id FROM artists WHERE slug = ?1 AND id <> ?2')
      .bind(candidate, excludeArtistId ?? '').first<{id: string}>()
    if (!taken) return candidate
  }
  return `${base.slice(0, 60)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

/**
 * Allocate the next MEJay ISRC for a track and record its registry entry, rights attestation and
 * active assignment. Callers must hold the transaction and have verified the track has no ISRC.
 * Shared by artist-requested generation and assignment at release approval.
 */
export async function insertGeneratedIsrc(db: Database, args: {
  trackId: string
  providerId: string
  assignedByUserId: string
  /** The rights holder who attested (the certifying artist user at approval). */
  attestedByUserId: string
  config: IsrcGenerationConfig
  attestation: {controlsRecording: true; neverAssignedIsrc: true; authorizeAssignment: true}
}): Promise<Record<string, unknown>> {
  const config = args.config
  const input = args.attestation
  const track = await loadTrackIsrcContext(db, args.trackId, args.providerId, false)
      const assignmentYear = new Date().getUTCFullYear() % 100
      await db.prepare(
        `INSERT INTO isrc_sequences (prefix, assignment_year, next_number)
         VALUES (?1, ?2, 1)
         ON CONFLICT (prefix, assignment_year) DO NOTHING`,
      ).bind(config.prefix, assignmentYear).run()
      // The counter row stays locked for the rest of this transaction, so concurrent generators
      // serialize here. Skip designations that are already registered (e.g. legacy rows or
      // externally registered codes) instead of failing on the unique constraint forever.
      let counter: {reserved_number: number} | null = null
      for (;;) {
        counter = await db.prepare(
          `UPDATE isrc_sequences
           SET next_number = next_number + 1, updated_at = CURRENT_TIMESTAMP
           WHERE isrc_sequences.prefix = ?1 AND isrc_sequences.assignment_year = ?2
             AND isrc_sequences.next_number <= 99999
           RETURNING isrc_sequences.next_number - 1 AS reserved_number`,
        ).bind(config.prefix, assignmentYear).first<{reserved_number: number}>()
        if (!counter || counter.reserved_number < 1 || counter.reserved_number > 99999) {
          throw new MarketplaceError(409, 'isrc_range_exhausted', `The ${assignmentYear} ISRC range is exhausted`)
        }
        const taken = await db.prepare(
          'SELECT 1 AS taken FROM isrc_registry WHERE isrc = ?1',
        ).bind(buildGeneratedIsrc(config.prefix, assignmentYear, counter.reserved_number)).first()
        if (!taken) break
      }

      const isrc = buildGeneratedIsrc(config.prefix, assignmentYear, counter.reserved_number)
      const id = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO isrc_registry
          (id, isrc, track_id, provider_profile_id, artist_id, rights_owner_id, prefix, country_code, registrant_code,
           assignment_year, designation, source, assignment_type, status, original_track_id, assigned_by_user_id,
           track_title, artist_name, provider_name, rights_owner_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, ?9, ?10, 'agency', 'MEJAY_ASSIGNED', 'ASSIGNED', ?3, ?11, ?12, ?13, ?14, ?14)`,
      ).bind(
        id,
        isrc,
        args.trackId,
        args.providerId,
        track.artist_id,
        config.prefix,
        config.countryCode,
        config.registrantCode,
        assignmentYear,
        counter.reserved_number,
        args.assignedByUserId,
        track.title,
        track.artist_name,
        track.provider_name,
      ).run()
      const certificationId = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO isrc_rights_certifications
          (id, provider_profile_id, track_id, attested_by_user_id, controls_recording, never_assigned_isrc, authorize_assignment)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(
        certificationId,
        args.providerId,
        args.trackId,
        args.attestedByUserId,
        input.controlsRecording,
        input.neverAssignedIsrc,
        input.authorizeAssignment,
      ).run()
      await db.prepare(
        `UPDATE isrc_registry
         SET rights_certification_id = ?2, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1`,
      ).bind(id, certificationId).run()
      const row = await inserted<any>(db.prepare(
        `INSERT INTO isrc_assignments (id, provider_profile_id, track_id, isrc, source, assigned_by_user_id, registry_id)
         VALUES (?1, ?2, ?3, ?4, 'agency', ?5, ?1) RETURNING *`,
      ).bind(id, args.providerId, args.trackId, isrc, args.assignedByUserId))
      await audit(db, {providerId: args.providerId, actorUserId: args.assignedByUserId, entityType: 'isrc_assignment', entityId: id, action: 'isrc.generated', after: row})
  return row
}

async function inserted<T>(statement: {first: <R>() => Promise<R | null>}): Promise<T> {
  const row = await statement.first<T>()
  if (!row) throw new Error('insert_failed')
  return row
}

export class MarketplaceService {
  constructor(private readonly database: Database) {}

  async getDashboard(userId: string): Promise<unknown> {
    const context = await providerContext(this.database, userId, false)
    const provider = await this.database.prepare(
      `SELECT id, display_name, legal_name, slug, contact_email, country_code, bio, status, created_at, updated_at
       FROM provider_profiles WHERE id = ?1`,
    ).bind(context.providerId).first()
    if (!provider) throw new MarketplaceError(404, 'not_found', 'Provider profile was not found')

    const counts = await this.database.prepare(
      `SELECT
        (SELECT COUNT(*)::integer FROM artists WHERE provider_profile_id = ?1) AS artists,
        (SELECT COUNT(*)::integer FROM releases WHERE provider_profile_id = ?1) AS releases,
        (SELECT COUNT(*)::integer FROM releases WHERE provider_profile_id = ?1 AND status = 'DRAFT') AS drafts,
        (SELECT COUNT(*)::integer FROM releases WHERE provider_profile_id = ?1 AND status = 'LIVE') AS live_releases,
        (SELECT COUNT(*)::integer FROM isrc_assignments WHERE provider_profile_id = ?1 AND revoked_at IS NULL) AS active_isrcs`,
    ).bind(context.providerId).first()

    return {provider: {...provider, role: context.role}, counts}
  }

  async listArtists(userId: string): Promise<unknown> {
    const context = await providerContext(this.database, userId, false)
    const {results} = await this.database.prepare(
      `SELECT a.*, COUNT(DISTINCT ra.release_id)::integer AS release_count,
        (SELECT COUNT(*)::integer FROM release_artists live_credit JOIN releases live ON live.id = live_credit.release_id
          WHERE live_credit.artist_id = a.id AND live_credit.is_primary = TRUE AND live.status = 'LIVE') AS live_release_count
       FROM artists a
       LEFT JOIN release_artists ra ON ra.artist_id = a.id AND ra.provider_profile_id = a.provider_profile_id
       WHERE a.provider_profile_id = ?1
       GROUP BY a.id
       ORDER BY LOWER(a.name), a.created_at`,
    ).bind(context.providerId).all()
    return results
  }

  async listReleases(userId: string): Promise<unknown> {
    const context = await providerContext(this.database, userId, false)
    const {results} = await this.database.prepare(
      `SELECT r.*, a.id AS primary_artist_id, a.name AS primary_artist_name,
        COUNT(DISTINCT t.id)::integer AS track_count
       FROM releases r
       LEFT JOIN release_artists ra ON ra.release_id = r.id AND ra.provider_profile_id = r.provider_profile_id AND ra.is_primary = TRUE
       LEFT JOIN artists a ON a.id = ra.artist_id AND a.provider_profile_id = r.provider_profile_id
       LEFT JOIN tracks t ON t.release_id = r.id AND t.provider_profile_id = r.provider_profile_id
       WHERE r.provider_profile_id = ?1
       GROUP BY r.id, a.id, a.name
       ORDER BY r.updated_at DESC, r.created_at DESC`,
    ).bind(context.providerId).all<Record<string, unknown>>()
    return results.map(withCalendarDates)
  }

  async getRelease(userId: string, releaseId: string): Promise<unknown> {
    const context = await providerContext(this.database, userId, false)
    const release = await this.database.prepare(
      `SELECT r.*, a.id AS primary_artist_id, a.name AS primary_artist_name
       FROM releases r
       LEFT JOIN release_artists ra ON ra.release_id = r.id AND ra.provider_profile_id = r.provider_profile_id AND ra.is_primary = TRUE
       LEFT JOIN artists a ON a.id = ra.artist_id AND a.provider_profile_id = r.provider_profile_id
       WHERE r.id = ?1 AND r.provider_profile_id = ?2`,
    ).bind(releaseId, context.providerId).first<Record<string, unknown>>().then((row) => row && withCalendarDates(row))
    if (!release) throw new MarketplaceError(404, 'not_found', 'Release was not found')
    const {results: additionalArtists} = await this.database.prepare(
      `SELECT role, artist_id, display_name AS name FROM release_artist_credits
       WHERE release_id = ?1 AND provider_profile_id = ?2 ORDER BY role DESC, position`,
    ).bind(releaseId, context.providerId).all<{role: 'primary' | 'featured'; artist_id: string | null; name: string}>()
    release.additional_artists = additionalArtists
    release.artist_credit = formatArtistCredit(release.primary_artist_name as string | null, additionalArtists)

    const {results: tracks} = await this.database.prepare(
      `SELECT t.*, a.name AS primary_artist_name, i.isrc,
        -- Store preview clip for the track's current setting: ready, being made, or not yet made.
        CASE
          WHEN EXISTS (SELECT 1 FROM marketplace_assets clip WHERE clip.track_id = t.id AND clip.kind = 'audio_preview'
            AND clip.processing_status = 'ready' AND ${PREVIEW_MATCHES_SETTING_SQL('clip', 't')}) THEN 'ready'
          WHEN EXISTS (SELECT 1 FROM audio_processing_jobs job WHERE job.track_id = t.id AND job.status IN ('queued', 'processing')) THEN 'processing'
          ELSE 'waiting' END AS preview_status,
        COALESCE((SELECT json_agg(json_build_object('name', c.name, 'role', c.role, 'publisherName', c.publisher_name) ORDER BY c.created_at, c.id)
          FROM track_contributors c WHERE c.track_id = t.id), '[]'::json) AS contributors,
        COALESCE((SELECT json_agg(fa.artist_id ORDER BY fa.artist_id) FROM track_artists fa
          WHERE fa.track_id = t.id AND fa.role = 'featured'), '[]'::json) AS featured_artist_ids
       FROM tracks t
       LEFT JOIN track_artists ta ON ta.track_id = t.id AND ta.provider_profile_id = t.provider_profile_id AND ta.is_primary = TRUE
       LEFT JOIN artists a ON a.id = ta.artist_id AND a.provider_profile_id = t.provider_profile_id
       LEFT JOIN isrc_assignments i ON i.track_id = t.id AND i.revoked_at IS NULL
       WHERE t.release_id = ?1 AND t.provider_profile_id = ?2
       ORDER BY t.disc_number, t.track_number, t.created_at`,
    ).bind(releaseId, context.providerId).all()
    const {results: assets} = await this.database.prepare(
      // MeJay-generated delivery/preview files are not artist uploads; keep the draft view to uploads.
      `SELECT * FROM marketplace_assets
       WHERE (release_id = ?1 OR track_id IN (SELECT id FROM tracks WHERE release_id = ?1 AND provider_profile_id = ?2))
         AND kind NOT IN ('audio_delivery', 'audio_preview')
       ORDER BY created_at`,
    ).bind(releaseId, context.providerId).all()
    const {results: rights} = await this.database.prepare(
      `SELECT * FROM rights_declarations
       WHERE provider_profile_id = ?2 AND status = 'active'
         AND (release_id = ?1 OR track_id IN (SELECT id FROM tracks WHERE release_id = ?1))
       ORDER BY created_at`,
    ).bind(releaseId, context.providerId).all()
    const product = await this.database.prepare(
      `SELECT p.*, pr.id AS price_id, pr.amount_minor, pr.currency
       FROM products p LEFT JOIN prices pr ON pr.product_id = p.id AND pr.active = TRUE
         AND pr.effective_from <= CURRENT_TIMESTAMP
         AND (pr.effective_until IS NULL OR pr.effective_until > CURRENT_TIMESTAMP)
       WHERE p.release_id = ?1 AND p.provider_profile_id = ?2 AND p.active = TRUE
       ORDER BY pr.effective_from DESC LIMIT 1`,
    ).bind(releaseId, context.providerId).first()
    const {results: trackProducts} = await this.database.prepare(
      `SELECT p.track_id, p.id AS product_id, pr.amount_minor, pr.currency
       FROM products p JOIN prices pr ON pr.product_id = p.id AND pr.active = TRUE
         AND pr.effective_from <= CURRENT_TIMESTAMP
         AND (pr.effective_until IS NULL OR pr.effective_until > CURRENT_TIMESTAMP)
       WHERE p.provider_profile_id = ?2 AND p.track_id IN (SELECT id FROM tracks WHERE release_id = ?1)
       ORDER BY p.track_id`,
    ).bind(releaseId, context.providerId).all()
    const {results: splits} = await this.database.prepare(
      `SELECT s.id, s.track_id, s.version, e.id AS entry_id, e.payee_name, e.payee_email, e.role, e.share_bps
       FROM revenue_split_sets s JOIN revenue_split_entries e ON e.split_set_id = s.id
       WHERE s.active = TRUE AND s.track_id IN (SELECT id FROM tracks WHERE release_id = ?1)
       ORDER BY s.track_id, e.created_at`,
    ).bind(releaseId).all()
    const {results: reviewEvents} = await this.database.prepare(
      `SELECT decision, note, from_status, to_status, created_at
       FROM release_review_events WHERE release_id = ?1 ORDER BY created_at DESC`,
    ).bind(releaseId).all()
    const prerequisites = await this.unmetPrerequisites(this.database, release, 'SUBMITTED')
    return {release, tracks, assets, rights, product, trackProducts, splits, reviewEvents, prerequisites}
  }

  /**
   * Deletes a release the artist is still drafting, with its tracks, uploads and draft data.
   * Refused once a release has been submitted or published, when any track carries an ISRC (a code
   * stays with its recording, so it must not be orphaned by a delete), or when anyone has checked out.
   * Returns the storage keys of the deleted uploads so the caller can remove the files after commit.
   */
  async deleteReleaseDraft(userId: string, releaseId: string): Promise<{deleted: true; storageKeys: string[]}> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      const release = await db.prepare(
        'SELECT * FROM releases WHERE id = ?1 AND provider_profile_id = ?2 FOR UPDATE',
      ).bind(releaseId, context.providerId).first<{id: string; title: string; status: ReleaseStatus; published_at: string | null}>()
      if (!release) throw new MarketplaceError(404, 'not_found', 'Release was not found')
      if (!isReleaseMutable(release.status) || release.published_at) {
        throw new MarketplaceError(409, 'release_not_deletable', 'Only drafts can be deleted. Submitted or published releases stay on record; ask MeJay to take a live release down instead.')
      }
      const blockers = await db.prepare(
        `SELECT
           EXISTS (SELECT 1 FROM isrc_assignments isrc JOIN tracks t ON t.id = isrc.track_id
             WHERE t.release_id = ?1 AND isrc.revoked_at IS NULL) AS has_isrc,
           EXISTS (SELECT 1 FROM marketplace_checkout_attempts WHERE release_id = ?1)
             OR EXISTS (SELECT 1 FROM marketplace_order_items WHERE release_id = ?1) AS has_checkout`,
      ).bind(releaseId).first<{has_isrc: boolean; has_checkout: boolean}>()
      if (blockers?.has_isrc) {
        throw new MarketplaceError(409, 'release_has_isrc', 'A track on this draft has an ISRC, so it cannot be deleted here. Contact MeJay support to remove it.')
      }
      if (blockers?.has_checkout) {
        throw new MarketplaceError(409, 'release_has_orders', 'This release has checkout history, so it cannot be deleted.')
      }
      const {results: assets} = await db.prepare(
        `SELECT storage_key FROM marketplace_assets
         WHERE release_id = ?1 OR track_id IN (SELECT id FROM tracks WHERE release_id = ?1)`,
      ).bind(releaseId).all<{storage_key: string}>()
      await db.prepare('DELETE FROM releases WHERE id = ?1 AND provider_profile_id = ?2').bind(releaseId, context.providerId).run()
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'release', entityId: releaseId, action: 'release.deleted', before: release})
      return {deleted: true as const, storageKeys: assets.map((asset) => asset.storage_key)}
    })
  }

  async updateReleaseDraft(userId: string, releaseId: string, input: ReleaseDraftInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      const before = await db.prepare(
        'SELECT * FROM releases WHERE id = ?1 AND provider_profile_id = ?2 FOR UPDATE',
      ).bind(releaseId, context.providerId).first<Record<string, unknown> & {status: ReleaseStatus; version: number}>()
      if (!before) throw new MarketplaceError(404, 'not_found', 'Release was not found')
      assertMutableStatus(before.status)
      if (before.version !== input.expectedVersion) {
        throw new MarketplaceError(409, 'stale_release_version', 'The release was modified by another request')
      }
      await assertOwned(db, 'artists', input.primaryArtistId, context.providerId)
      const schedule = resolveDraftSchedule(before, input)
      const now = nowIso()
      const duplicateFingerprint = releaseFingerprint(input)
      const row = await inserted<Record<string, unknown>>(db.prepare(
        `UPDATE releases SET
          title = ?1, version_title = ?2, release_type = ?3, label_name = ?4, catalog_number = ?5,
          original_release_date = ?6, scheduled_release_at = ?7, genre = ?8, subgenre = ?9, upc = ?10,
          copyright_year = ?11, copyright_holder = ?12, phonographic_copyright_year = ?13,
          phonographic_copyright_holder = ?14, draft_step = ?15, duplicate_fingerprint = ?16,
          requested_release_at = ?21, release_timezone = ?22, preorders_enabled = ?23, preview_timing = ?24,
          version = version + 1, updated_at = ?17
         WHERE id = ?18 AND provider_profile_id = ?19 AND version = ?20 RETURNING *`,
      ).bind(
        input.title, input.versionTitle ?? null, input.releaseType, input.labelName ?? null,
        input.catalogNumber ?? null, input.originalReleaseDate ?? null, input.scheduledReleaseAt ?? null,
        input.genre ?? null, input.subgenre ?? null, input.upc ?? null, input.copyrightYear ?? null,
        input.copyrightHolder ?? null, input.phonographicCopyrightYear ?? null,
        input.phonographicCopyrightHolder ?? null, input.draftStep, duplicateFingerprint, now, releaseId, context.providerId,
        input.expectedVersion, schedule.requestedReleaseAt, schedule.releaseTimezone, schedule.preordersEnabled,
        input.previewTiming ?? (before.preview_timing as string | undefined) ?? 'after_release',
      ))
      await db.prepare(
        `UPDATE release_artists SET is_primary = FALSE
         WHERE release_id = ?1 AND provider_profile_id = ?2 AND is_primary = TRUE`,
      ).bind(releaseId, context.providerId).run()
      await db.prepare(
        `INSERT INTO release_artists (provider_profile_id, release_id, artist_id, role, is_primary)
         VALUES (?1, ?2, ?3, 'primary', TRUE)
         ON CONFLICT (release_id, artist_id, role) DO UPDATE SET is_primary = TRUE`,
      ).bind(context.providerId, releaseId, input.primaryArtistId).run()
      if (input.additionalArtists !== undefined) await replaceReleaseCredits(db, context.providerId, releaseId, input.primaryArtistId, input.additionalArtists)
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'release', entityId: releaseId, action: 'release.draft_updated', before, after: {...row, additional_artists: input.additionalArtists}})
      return {...withCalendarDates(row), primary_artist_id: input.primaryArtistId}
    })
  }

  async completeProvider(userId: string, input: ProviderInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const now = nowIso()
      await bootstrapProviderAccount({db, userId, createdAt: now})
      const context = await providerContext(db, userId)
      const protectedOwner = await db.prepare(
        'SELECT protected_owner FROM marketplace_staff WHERE user_id = ?1',
      ).bind(userId).first<{protected_owner: boolean}>()
      const row = await inserted<any>(db.prepare(
        `UPDATE provider_profiles SET display_name = ?1, legal_name = ?2, slug = ?3,
          contact_email = ?4, country_code = ?5, bio = ?6,
           status = CASE WHEN status IN ('pending_profile_completion', 'needs_changes', 'rejected') THEN ?7 ELSE status END,
          updated_at = ?8
         WHERE id = ?9 RETURNING *`,
        ).bind(input.displayName, input.legalName ?? null, input.slug, input.contactEmail, input.countryCode, input.bio ?? null, protectedOwner?.protected_owner ? 'approved' : 'pending_review', now, context.providerId))
      await db.prepare("UPDATE users SET account_intent = 'provider', updated_at = ?1 WHERE id = ?2").bind(now, userId).run()
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'provider', entityId: context.providerId, action: 'provider.completed', after: row})
      return row
    })
  }

  /**
   * Saves the account's business details from Settings. Owners and admins only. Unlike
   * completeProvider (onboarding), this never changes review status or account intent.
   */
  async updateProviderSettings(userId: string, input: ProviderSettingsInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      if (!['owner', 'admin'].includes(context.role)) {
        throw new MarketplaceError(403, 'provider_settings_forbidden', 'Only the account owner or an admin can change these settings')
      }
      const before = await db.prepare(
        `SELECT display_name, legal_name, contact_email, country_code, bio FROM provider_profiles WHERE id = ?1 FOR UPDATE`,
      ).bind(context.providerId).first()
      if (!before) throw new MarketplaceError(404, 'not_found', 'Provider profile was not found')
      const row = await inserted<Record<string, unknown>>(db.prepare(
        `UPDATE provider_profiles SET display_name = ?1, legal_name = ?2, contact_email = ?3, country_code = ?4, bio = ?5,
           updated_at = ?6
         WHERE id = ?7
         RETURNING id, display_name, legal_name, slug, contact_email, country_code, bio, status, created_at, updated_at`,
      ).bind(input.displayName, input.legalName || null, input.contactEmail, input.countryCode, input.bio || null, nowIso(), context.providerId))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'provider', entityId: context.providerId, action: 'provider.settings_updated', before, after: row})
      return {...row, role: context.role}
    })
  }

  async createArtist(userId: string, input: ArtistInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      const id = crypto.randomUUID()
      const slug = await uniqueArtistSlug(db, slugifyArtistName(input.name))
      const row = await inserted<any>(db.prepare(
        `INSERT INTO artists (id, provider_profile_id, name, sort_name, country_code, metadata, slug)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING *`,
      ).bind(id, context.providerId, input.name, input.sortName ?? null, input.countryCode ?? null, JSON.stringify(input.metadata), slug))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'artist', entityId: id, action: 'artist.created', after: row})
      return row
    })
  }

  async createRelease(userId: string, input: ReleaseInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      await assertOwned(db, 'artists', input.primaryArtistId, context.providerId)
      const id = crypto.randomUUID()
      const duplicateFingerprint = releaseFingerprint(input)
      const row = await inserted<any>(db.prepare(
        `INSERT INTO releases
          (id, provider_profile_id, title, version_title, release_type, label_name, catalog_number,
            original_release_date, scheduled_release_at, duplicate_fingerprint)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING *`,
      ).bind(id, context.providerId, input.title, input.versionTitle ?? null, input.releaseType, input.labelName ?? null, input.catalogNumber ?? null, input.originalReleaseDate ?? null, input.scheduledReleaseAt ?? null, duplicateFingerprint))
      await db.prepare(
        `INSERT INTO release_artists (provider_profile_id, release_id, artist_id, role, is_primary)
         VALUES (?1, ?2, ?3, 'primary', TRUE)`,
      ).bind(context.providerId, id, input.primaryArtistId).run()
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'release', entityId: id, action: 'release.created', after: row})
      return row
    })
  }

  async createTrack(userId: string, releaseId: string, input: TrackInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      await assertReleaseMutable(db, releaseId, context.providerId)
      await assertOwned(db, 'artists', input.primaryArtistId, context.providerId)
      const id = crypto.randomUUID()
      const row = await inserted<any>(db.prepare(
        `INSERT INTO tracks
          (id, provider_profile_id, release_id, title, version_title, disc_number, track_number, duration_ms, explicit, language_code, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING *`,
      ).bind(id, context.providerId, releaseId, input.title, input.versionTitle ?? null, input.discNumber, input.trackNumber, input.durationMs ?? null, input.explicit, input.languageCode ?? null, JSON.stringify(input.metadata)))
      await db.prepare(
        `INSERT INTO track_artists (provider_profile_id, track_id, artist_id, role, is_primary)
         VALUES (?1, ?2, ?3, 'primary', TRUE)`,
      ).bind(context.providerId, id, input.primaryArtistId).run()
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'track', entityId: id, action: 'track.created', after: row})
      return row
    })
  }

  async updateTrack(userId: string, trackId: string, input: TrackDraftInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      await assertTrackMutable(db, trackId, context.providerId)
      await assertOwned(db, 'artists', input.primaryArtistId, context.providerId)
      const before = await db.prepare(
        'SELECT * FROM tracks WHERE id = ?1 AND provider_profile_id = ?2',
      ).bind(trackId, context.providerId).first<Record<string, unknown>>()
      const previewStartMs = resolvePreviewStart(before, input)
      const row = await inserted<any>(db.prepare(
        `UPDATE tracks SET title = ?1, version_title = ?2, disc_number = ?3, track_number = ?4,
          duration_ms = ?5, explicit = ?6, language_code = ?7, genre = ?8, instrumental = ?9,
          recording_year = ?10, recording_location = ?11, preview_start_ms = ?14, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?12 AND provider_profile_id = ?13 RETURNING *`,
      ).bind(
        input.title, input.versionTitle ?? null, input.discNumber, input.trackNumber,
        input.durationMs ?? null, input.explicit, input.languageCode ?? null, input.genre ?? null,
        input.instrumental, input.recordingYear ?? null, input.recordingLocation ?? null,
        trackId, context.providerId, previewStartMs,
      ))
      await db.prepare(
        'UPDATE track_artists SET is_primary = FALSE WHERE track_id = ?1 AND provider_profile_id = ?2 AND is_primary = TRUE',
      ).bind(trackId, context.providerId).run()
      await db.prepare(
        `INSERT INTO track_artists (provider_profile_id, track_id, artist_id, role, is_primary)
         VALUES (?1, ?2, ?3, 'primary', TRUE)
         ON CONFLICT (track_id, artist_id, role) DO UPDATE SET is_primary = TRUE`,
      ).bind(context.providerId, trackId, input.primaryArtistId).run()
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'track', entityId: trackId, action: 'track.updated', before, after: row})
      return row
    })
  }

  async createAsset(userId: string, input: AssetInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      if (input.releaseId) await assertReleaseMutable(db, input.releaseId, context.providerId)
      if (input.trackId) await assertTrackMutable(db, input.trackId, context.providerId)
      const id = crypto.randomUUID()
      const row = await inserted<any>(db.prepare(
        `INSERT INTO marketplace_assets
          (id, provider_profile_id, release_id, track_id, kind, storage_key, public_url, mime_type, byte_size, sha256, processing_status, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) RETURNING *`,
      ).bind(id, context.providerId, input.releaseId ?? null, input.trackId ?? null, input.kind, input.storageKey, input.publicUrl ?? null, input.mimeType, input.byteSize, input.sha256 ?? null, input.processingStatus, JSON.stringify(input.metadata)))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'asset', entityId: id, action: 'asset.created', after: row})
      return row
    })
  }

  async initiateUpload(userId: string, input: UploadInitInput, bucket: PrivateBucket | undefined): Promise<unknown> {
    if (!bucket) throw new MarketplaceError(503, 'storage_unavailable', 'Private upload storage is not configured')
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      if (input.kind === 'artwork' || input.kind === 'rights_document') await assertReleaseMutable(db, input.releaseId, context.providerId)
      else if (input.kind === 'audio') await assertTrackMutable(db, input.trackId, context.providerId)
      // Profile imagery belongs to the artist identity, which stays editable after release.
      else await assertOwned(db, 'artists', input.artistId, context.providerId)
      await db.prepare('SELECT id FROM provider_profiles WHERE id = ?1 FOR UPDATE').bind(context.providerId).first()
      const storage = await db.prepare(
        `SELECT COALESCE(SUM(byte_size), 0)::bigint AS used_bytes FROM marketplace_assets
         WHERE provider_profile_id = ?1 AND processing_status <> 'failed'
           AND kind NOT IN ('audio_delivery', 'audio_preview')`,
      ).bind(context.providerId).first<{used_bytes: number | string}>()
      if (exceedsProviderStorageLimit(Number(storage?.used_bytes ?? 0), input.byteSize)) {
        throw new MarketplaceError(422, 'provider_storage_limit_exceeded', 'Provider storage limit exceeded')
      }

      const id = crypto.randomUUID()
      const extension = input.mimeType.includes('png') ? 'png'
        : input.mimeType.includes('webp') ? 'webp'
          : input.mimeType.includes('pdf') ? 'pdf'
            : input.mimeType.includes('flac') ? 'flac'
              : input.mimeType.includes('wav') ? 'wav' : 'jpg'
      const releaseId = input.kind === 'artwork' || input.kind === 'rights_document' ? input.releaseId : null
      const trackId = input.kind === 'audio' ? input.trackId : null
      const artistId = 'artistId' in input ? input.artistId : null
      const targetId = releaseId ?? trackId ?? artistId
      const storageKey = `${MARKETPLACE_STORAGE_PREFIX}${context.providerId}/${input.kind}/${targetId}/${id}.${extension}`
      const metadata = 'width' in input
        ? {fileName: input.fileName, width: input.width, height: input.height}
        : {fileName: input.fileName}
      const uploadUrl = await bucket.createUploadUrl(storageKey, input.mimeType, input.byteSize)
      const row = await inserted<any>(db.prepare(
        `INSERT INTO marketplace_assets
          (id, provider_profile_id, release_id, track_id, artist_id, kind, storage_key, mime_type, byte_size, processing_status, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10) RETURNING *`,
      ).bind(
        id, context.providerId, releaseId, trackId, artistId, input.kind, storageKey, input.mimeType,
        input.byteSize, JSON.stringify(metadata),
      ))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'asset', entityId: id, action: 'asset.upload_initiated', after: row})
      return {asset: row, upload: {url: uploadUrl, method: 'PUT', headers: {'content-type': input.mimeType}}}
    })
  }

  async finalizeUpload(userId: string, assetId: string, bucket: PrivateBucket | undefined): Promise<unknown> {
    if (!bucket) throw new MarketplaceError(503, 'storage_unavailable', 'Private upload storage is not configured')
    try {
      return await this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      const asset = await db.prepare(
        'SELECT * FROM marketplace_assets WHERE id = ?1 AND provider_profile_id = ?2 FOR UPDATE',
      ).bind(assetId, context.providerId).first<any>()
      if (!asset) throw new MarketplaceError(404, 'not_found', 'Upload was not found')
      if (asset.release_id) await assertReleaseMutable(db, asset.release_id, context.providerId)
      if (asset.track_id) await assertTrackMutable(db, asset.track_id, context.providerId)
      const object = await bucket.head(asset.storage_key)
      if (!object) throw new MarketplaceError(422, 'upload_missing', 'The uploaded object was not found')
      if (object.byteSize !== Number(asset.byte_size) || object.contentType !== asset.mime_type) {
        throw new MarketplaceError(422, 'upload_mismatch', 'The uploaded object does not match the declared file')
      }
      const objectBytes = await bucket.getExact(asset.storage_key, 'bytes=0-65535')
      if (!objectBytes) throw new MarketplaceError(422, 'upload_missing', 'The uploaded object was not found')
      let bytes = new Uint8Array(await new Response(objectBytes.body).arrayBuffer())
      if (isTruncatedJpegHeader(bytes) && Number(asset.byte_size) > bytes.length) {
        // EXIF/ICC segments can push the JPEG frame header past 64 KB; read further (bounded).
        const end = Math.min(Number(asset.byte_size), JPEG_HEADER_SCAN_BYTES) - 1
        const larger = await bucket.getExact(asset.storage_key, `bytes=0-${end}`)
        if (larger) bytes = new Uint8Array(await new Response(larger.body).arrayBuffer())
      }
      const metadata = typeof asset.metadata === 'string' ? JSON.parse(asset.metadata) : asset.metadata ?? {}
      const validationErrors = validateInspectedUpload({
        declaredMimeType: asset.mime_type,
        kind: asset.kind,
        metadata,
        inspected: inspectUpload(bytes),
      })
      if (validationErrors.length > 0) {
        throw new MarketplaceError(422, 'upload_validation_failed', 'The uploaded media failed validation', validationErrors)
      }
      const row = await inserted<any>(db.prepare(
        `UPDATE marketplace_assets SET processing_status = 'ready'
         WHERE id = ?1 AND provider_profile_id = ?2 RETURNING *`,
      ).bind(assetId, context.providerId))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'asset', entityId: assetId, action: 'asset.upload_finalized', before: asset, after: row})
      return row
      })
    } catch (error) {
      if (error instanceof MarketplaceError && error.code === 'upload_validation_failed') {
        await this.database.prepare(
          `UPDATE marketplace_assets SET processing_status = 'failed', metadata = metadata || ?1::jsonb
           WHERE id = ?2`,
        ).bind(JSON.stringify({validationErrors: error.details}), assetId).run()
      }
      throw error
    }
  }

  async createRightsDeclaration(userId: string, input: RightsDeclarationInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      if (input.releaseId) await assertReleaseMutable(db, input.releaseId, context.providerId)
      if (input.trackId) await assertTrackMutable(db, input.trackId, context.providerId)
      const id = crypto.randomUUID()
      const row = await inserted<any>(db.prepare(
        `INSERT INTO rights_declarations
          (id, provider_profile_id, release_id, track_id, declaration_type, rights_holder, ownership_bps, territories, valid_from, valid_until, affirmed_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING *`,
      ).bind(id, context.providerId, input.releaseId ?? null, input.trackId ?? null, input.declarationType, input.rightsHolder, input.ownershipBps, input.territories, input.validFrom ?? null, input.validUntil ?? null, userId))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'rights_declaration', entityId: id, action: 'rights.created', after: row})
      return row
    })
  }

  async assignIsrc(userId: string, trackId: string, input: IsrcAssignmentInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      const track = await loadTrackIsrcContext(db, trackId, context.providerId)
      await assertTrackHasNoIsrc(db, trackId)
      const problem = externalIsrcProblem(input.isrc)
      if (problem) throw new MarketplaceError(422, 'isrc_not_allowed', problem)
      const id = crypto.randomUUID()
      const prefix = input.isrc.slice(0, 5)
      const assignmentYear = Number(input.isrc.slice(5, 7))
      const designation = Number(input.isrc.slice(7))
      await db.prepare(
        `INSERT INTO isrc_registry
          (id, isrc, track_id, provider_profile_id, artist_id, rights_owner_id, prefix, country_code, registrant_code,
           assignment_year, designation, source, assignment_type, status, original_track_id, assigned_by_user_id,
           track_title, artist_name, provider_name, rights_owner_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, ?9, ?10, ?11, 'EXTERNAL', 'REGISTERED', ?3, ?12, ?13, ?14, ?15, ?15)`,
      ).bind(
        id,
        input.isrc,
        trackId,
        context.providerId,
        track.artist_id,
        prefix,
        input.isrc.slice(0, 2),
        input.isrc.slice(2, 5),
        assignmentYear,
        designation,
        input.source,
        userId,
        track.title,
        track.artist_name,
        track.provider_name,
      ).run()
      const row = await inserted<any>(db.prepare(
        `INSERT INTO isrc_assignments (id, provider_profile_id, track_id, isrc, source, assigned_by_user_id, registry_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?1) RETURNING *`,
      ).bind(id, context.providerId, trackId, input.isrc, input.source, userId))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'isrc_assignment', entityId: id, action: 'isrc.assigned', after: row})
      return row
    })
  }

  async assignGeneratedIsrc(userId: string, trackId: string, input: GeneratedIsrcInput, config: IsrcGenerationConfig | null): Promise<unknown> {
    if (!config) throw new MarketplaceError(503, 'isrc_generation_unavailable', 'MEJay ISRC generation is not configured')
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      await loadTrackIsrcContext(db, trackId, context.providerId)
      await assertTrackHasNoIsrc(db, trackId)
      return insertGeneratedIsrc(db, {
        trackId, providerId: context.providerId, assignedByUserId: userId, attestedByUserId: userId, config,
        attestation: input,
      })
    })
  }

  async createProduct(userId: string, input: ProductInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      if (input.releaseId) await assertReleaseMutable(db, input.releaseId, context.providerId)
      if (input.trackId) await assertTrackMutable(db, input.trackId, context.providerId)
      const id = crypto.randomUUID()
      const row = await inserted<any>(db.prepare(
        `INSERT INTO products (id, provider_profile_id, release_id, track_id, name)
         VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *`,
      ).bind(id, context.providerId, input.releaseId ?? null, input.trackId ?? null, input.name))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'product', entityId: id, action: 'product.created', after: row})
      return row
    })
  }

  async createPrice(userId: string, productId: string, input: PriceInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      await assertProductMutable(db, productId, context.providerId)
      const id = crypto.randomUUID()
      const row = await inserted<any>(db.prepare(
        `INSERT INTO prices (id, product_id, amount_minor, currency, effective_from, effective_until)
         VALUES (?1, ?2, ?3, ?4, COALESCE(?5, CURRENT_TIMESTAMP), ?6) RETURNING *`,
      ).bind(id, productId, input.amountMinor, input.currency, input.effectiveFrom ?? null, input.effectiveUntil ?? null))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'price', entityId: id, action: 'price.created', after: row})
      return row
    })
  }

  /**
   * Create or replace the release's download price in one transaction: reuses the release
   * product if it exists (so a half-finished earlier save can't lock the step) and retires
   * any previous active price.
   */
  async setReleasePrice(userId: string, releaseId: string, input: ReleasePriceInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      await assertReleaseMutable(db, releaseId, context.providerId)
      let product = await db.prepare(
        `SELECT id FROM products WHERE release_id = ?1 AND provider_profile_id = ?2
         ORDER BY created_at LIMIT 1 FOR UPDATE`,
      ).bind(releaseId, context.providerId).first<{id: string}>()
      if (!product) {
        product = await inserted<{id: string}>(db.prepare(
          `INSERT INTO products (id, provider_profile_id, release_id, name)
           VALUES (?1, ?2, ?3, ?4) RETURNING id`,
        ).bind(crypto.randomUUID(), context.providerId, releaseId, input.name))
        await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'product', entityId: product.id, action: 'product.created', after: product})
      }
      await db.prepare(
        `UPDATE prices SET active = FALSE,
          effective_until = CASE WHEN effective_from < CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE effective_until END
         WHERE product_id = ?1 AND active = TRUE`,
      ).bind(product.id).run()
      const id = crypto.randomUUID()
      const price = await inserted<{id: string; amount_minor: number; currency: string}>(db.prepare(
        `INSERT INTO prices (id, product_id, amount_minor, currency) VALUES (?1, ?2, ?3, 'USD') RETURNING *`,
      ).bind(id, product.id, input.amountMinor))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'price', entityId: id, action: 'price.set', after: price})
      return {productId: product.id, price}
    })
  }

  /**
   * Sell one song on its own, alongside the release. Reuses the song's product, retires the previous
   * price, and is locked once the release is submitted, exactly like the release price.
   */
  async setTrackPrice(userId: string, trackId: string, input: TrackPriceInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      await assertTrackMutable(db, trackId, context.providerId)
      const track = await db.prepare('SELECT title FROM tracks WHERE id = ?1 AND provider_profile_id = ?2')
        .bind(trackId, context.providerId).first<{title: string}>()
      if (!track) throw new MarketplaceError(404, 'not_found', 'Marketplace resource was not found')
      let product = await db.prepare(
        `SELECT id FROM products WHERE track_id = ?1 AND provider_profile_id = ?2
         ORDER BY created_at LIMIT 1 FOR UPDATE`,
      ).bind(trackId, context.providerId).first<{id: string}>()
      if (!product) {
        product = await inserted<{id: string}>(db.prepare(
          `INSERT INTO products (id, provider_profile_id, track_id, name)
           VALUES (?1, ?2, ?3, ?4) RETURNING id`,
        ).bind(crypto.randomUUID(), context.providerId, trackId, track.title))
        await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'product', entityId: product.id, action: 'product.created', after: product})
      }
      await db.prepare(
        `UPDATE prices SET active = FALSE,
          effective_until = CASE WHEN effective_from < CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE effective_until END
         WHERE product_id = ?1 AND active = TRUE`,
      ).bind(product.id).run()
      const id = crypto.randomUUID()
      const price = await inserted<{id: string; amount_minor: number; currency: string}>(db.prepare(
        `INSERT INTO prices (id, product_id, amount_minor, currency) VALUES (?1, ?2, ?3, 'USD') RETURNING *`,
      ).bind(id, product.id, input.amountMinor))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'price', entityId: id, action: 'price.set', after: price})
      return {productId: product.id, price}
    })
  }

  /** Stop selling a song on its own. Past song sales and their downloads are unaffected. */
  async clearTrackPrice(userId: string, trackId: string): Promise<{cleared: boolean}> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      await assertTrackMutable(db, trackId, context.providerId)
      const {results: retired} = await db.prepare(
        `UPDATE prices SET active = FALSE,
          effective_until = CASE WHEN effective_from < CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE effective_until END
         WHERE active = TRUE AND product_id IN (SELECT id FROM products WHERE track_id = ?1 AND provider_profile_id = ?2)
         RETURNING id`,
      ).bind(trackId, context.providerId).all<{id: string}>()
      for (const price of retired) {
        await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'price', entityId: price.id, action: 'price.retired'})
      }
      return {cleared: retired.length > 0}
    })
  }

  async replaceRevenueSplits(userId: string, trackId: string, input: RevenueSplitsInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      await assertTrackMutable(db, trackId, context.providerId)
      const versionRow = await db.prepare(
        'SELECT COALESCE(MAX(version), 0)::integer AS version FROM revenue_split_sets WHERE track_id = ?1',
      ).bind(trackId).first<{version: number}>()
      const version = (versionRow?.version ?? 0) + 1
      await db.prepare('UPDATE revenue_split_sets SET active = FALSE WHERE track_id = ?1 AND active = TRUE').bind(trackId).run()
      const splitSetId = crypto.randomUUID()
      const row = await inserted<any>(db.prepare(
        `INSERT INTO revenue_split_sets (id, provider_profile_id, track_id, version, created_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *`,
      ).bind(splitSetId, context.providerId, trackId, version, userId))
      for (const entry of input.entries) {
        await db.prepare(
          `INSERT INTO revenue_split_entries (id, split_set_id, payee_name, payee_email, role, share_bps)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        ).bind(crypto.randomUUID(), splitSetId, entry.payeeName, entry.payeeEmail ?? null, entry.role ?? null, entry.shareBps).run()
      }
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'revenue_split_set', entityId: splitSetId, action: 'revenue_splits.replaced', after: {...row, entries: input.entries}})
      return {...row, entries: input.entries}
    })
  }

  async transitionRelease(userId: string, releaseId: string, input: TransitionInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const release = await db.prepare('SELECT * FROM releases WHERE id = ?1 FOR UPDATE').bind(releaseId).first<any>()
      if (!release) throw new MarketplaceError(404, 'not_found', 'Release was not found')
      const currentStatus = release.status as ReleaseStatus
      const targetStatus = input.targetStatus as ReleaseStatus
      if (!isReleaseTransitionAllowed(currentStatus, targetStatus)) {
        throw new MarketplaceError(409, 'invalid_transition', `Cannot transition from ${currentStatus} to ${targetStatus}`)
      }
      if (release.version !== input.expectedVersion) {
        throw new MarketplaceError(409, 'stale_release_version', 'The release was modified by another request')
      }

      // Review and publishing decisions go through MarketplaceAdminService.commandRelease, which
      // enforces staff roles, self-review rules, sale readiness and product activation.
      if (!PROVIDER_TRANSITION_TARGETS.has(targetStatus)) {
        throw new MarketplaceError(403, 'marketplace_review_required', 'Review and publishing decisions must use the marketplace admin review actions')
      }
      const context = await providerContext(db, userId)
      if (context.providerId !== release.provider_profile_id) throw new MarketplaceError(404, 'not_found', 'Release was not found')
      if (targetStatus === 'SUBMITTED') await assertProviderCanSubmit(db, release.provider_profile_id)

      const unmet = await this.unmetPrerequisites(db, release, targetStatus)
      if (unmet.length > 0) throw new MarketplaceError(422, 'release_prerequisites_unmet', 'Release prerequisites are not complete', unmet)
      if (targetStatus === 'SUBMITTED') await snapshotReleaseCertification(db, release, userId, null)

      const now = nowIso()
      const row = await inserted<any>(db.prepare(
        `UPDATE releases SET status = ?1, version = version + 1, updated_at = ?2,
          submitted_at = CASE WHEN ?1 = 'SUBMITTED' THEN ?2 ELSE submitted_at END,
          approved_at = CASE WHEN ?1 = 'APPROVED' THEN ?2 ELSE approved_at END,
          published_at = CASE WHEN ?1 = 'LIVE' THEN ?2 ELSE published_at END
         WHERE id = ?3 AND version = ?4 RETURNING *`,
      ).bind(targetStatus, now, releaseId, input.expectedVersion))
      await audit(db, {
        providerId: release.provider_profile_id,
        actorUserId: userId,
        entityType: 'release',
        entityId: releaseId,
        action: 'release.status_changed',
        before: {status: currentStatus, version: release.version},
        after: {status: targetStatus, version: row.version},
      })
      return row
    })
  }

  async submitRelease(userId: string, releaseId: string, input: SubmitReleaseInput, meta: RequestMeta | null = null): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      const release = await db.prepare(
        `SELECT r.*, p.status AS provider_status
         FROM releases r JOIN provider_profiles p ON p.id = r.provider_profile_id
         WHERE r.id = ?1 AND r.provider_profile_id = ?2 FOR UPDATE`,
      ).bind(releaseId, context.providerId).first<any>()
      if (!release) throw new MarketplaceError(404, 'not_found', 'Release was not found')
      if (!isReleaseMutable(release.status)) {
        throw new MarketplaceError(409, 'release_locked', 'Only editable releases can be submitted')
      }
      if (release.version !== input.expectedVersion) {
        throw new MarketplaceError(409, 'stale_release_version', 'The release was modified by another request')
      }
      await assertProviderCanSubmit(db, release.provider_profile_id)

      const unmet = await this.unmetPrerequisites(db, release, 'SUBMITTED')
      if (unmet.length > 0) {
        throw new MarketplaceError(422, 'release_prerequisites_unmet', 'Release prerequisites are not complete', unmet)
      }

      const certification = await snapshotReleaseCertification(db, release, userId, meta)
      const now = nowIso()
      const row = await inserted<any>(db.prepare(
        `UPDATE releases SET status = 'SUBMITTED', version = version + 1, submitted_at = ?1, updated_at = ?1
         WHERE id = ?2 AND version = ?3 RETURNING *`,
      ).bind(now, releaseId, input.expectedVersion))
      row.certification_id = certification.certificationId
      await audit(db, {
        providerId: context.providerId,
        actorUserId: userId,
        entityType: 'release',
        entityId: releaseId,
        action: 'release.submitted',
        before: {status: release.status, version: release.version},
        after: {status: row.status, version: row.version},
      })
      return row
    })
  }

  private async unmetPrerequisites(db: Database, release: any, targetStatus: ReleaseStatus): Promise<string[]> {
    if (['UNDER_REVIEW', 'APPROVED'].includes(targetStatus)) return []
    if (targetStatus === 'SCHEDULED') {
      return !release.scheduled_release_at || new Date(release.scheduled_release_at).getTime() <= Date.now()
        ? ['scheduled_release_at must be in the future']
        : []
    }
    if (targetStatus === 'LIVE') {
      return release.scheduled_release_at && new Date(release.scheduled_release_at).getTime() > Date.now()
        ? ['scheduled_release_at is still in the future']
        : []
    }

    const unmet: string[] = []
    const statuses = ['METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE', 'PRICING_COMPLETE', 'SUBMITTED']
    const targetIndex = statuses.indexOf(targetStatus)
    const shouldCheck = (status: string) => targetStatus === 'SUBMITTED' || statuses.indexOf(status) <= targetIndex

    if (shouldCheck('METADATA_COMPLETE')) {
      const metadata = await db.prepare(
        `SELECT
          EXISTS (SELECT 1 FROM release_artists WHERE release_id = ?1 AND is_primary = TRUE) AS has_artist,
          EXISTS (SELECT 1 FROM tracks WHERE release_id = ?1) AS has_tracks,
          EXISTS (SELECT 1 FROM marketplace_assets WHERE release_id = ?1 AND kind = 'artwork' AND processing_status = 'ready') AS has_artwork,
          NOT EXISTS (
            SELECT 1 FROM tracks t WHERE t.release_id = ?1 AND NOT EXISTS (
              SELECT 1 FROM marketplace_assets a WHERE a.track_id = t.id AND a.kind = 'audio' AND a.processing_status = 'ready'
            )
          ) AS all_audio`,
      ).bind(release.id).first<{has_artist: boolean; has_tracks: boolean; has_artwork: boolean; all_audio: boolean}>()
      if (!release.title || !release.release_type) unmet.push('required release metadata')
      if (!metadata?.has_artist) unmet.push('primary release artist')
      if (!metadata?.has_tracks) unmet.push('at least one track')
      if (!metadata?.has_artwork) unmet.push('ready release artwork')
      if (!metadata?.all_audio) unmet.push('ready audio for every track')
    }

    if (shouldCheck('RIGHTS_COMPLETE')) {
      const rights = await db.prepare(
        `SELECT
          COALESCE((SELECT SUM(ownership_bps) FROM rights_declarations WHERE release_id = ?1 AND declaration_type = 'distribution' AND status = 'active'), 0)::integer AS distribution_bps,
          (SELECT COUNT(*) FROM tracks t WHERE t.release_id = ?1 AND (
            COALESCE((SELECT SUM(r.ownership_bps) FROM rights_declarations r WHERE r.track_id = t.id AND r.declaration_type = 'master' AND r.status = 'active'), 0) <> 10000 OR
            COALESCE((SELECT SUM(r.ownership_bps) FROM rights_declarations r WHERE r.track_id = t.id AND r.declaration_type = 'composition' AND r.status = 'active'), 0) <> 10000
          ))::integer AS incomplete_tracks`,
      ).bind(release.id).first<{distribution_bps: number; incomplete_tracks: number}>()
      if (rights?.distribution_bps !== 10000) unmet.push('distribution rights totaling 10000 basis points')
      if (rights?.incomplete_tracks !== 0) unmet.push('master and composition rights totaling 10000 basis points for every track')
    }

    // ISRCs are no longer a submission prerequisite: artists may register an existing ISRC, and
    // MEJay assigns ISRCs to the remaining tracks when a reviewer approves the release.

    if (shouldCheck('PRICING_COMPLETE')) {
      const sale = await getReleaseSaleReadiness(db, release.id)
      const pricing = await db.prepare(
        `SELECT
          EXISTS (
            SELECT 1 FROM products p JOIN prices pr ON pr.product_id = p.id
            WHERE p.release_id = ?1 AND p.active = TRUE AND pr.active = TRUE
              AND pr.currency = 'USD' AND pr.amount_minor >= ?2
              AND pr.effective_from <= CURRENT_TIMESTAMP
              AND (pr.effective_until IS NULL OR pr.effective_until > CURRENT_TIMESTAMP)
          ) AS has_price,
          (SELECT COUNT(*) FROM tracks t WHERE t.release_id = ?1 AND NOT EXISTS (
            SELECT 1 FROM revenue_split_sets s WHERE s.track_id = t.id AND s.active = TRUE
              AND (SELECT COALESCE(SUM(e.share_bps), 0) FROM revenue_split_entries e WHERE e.split_set_id = s.id) = 10000
          ))::integer AS missing_splits`,
      ).bind(release.id, MINIMUM_RELEASE_PRICE_MINOR).first<{has_price: boolean; missing_splits: number}>()
      if (!pricing?.has_price || !sale.hasMinimumPrice) unmet.push(`active release product priced at least ${formatMinimumPrice()} USD`)
      if (!sale.stripeReady) unmet.push('completed Stripe payout setup')
      if (pricing?.missing_splits !== 0) unmet.push('active revenue splits totaling 10000 basis points for every track')
    }

    if (targetStatus === 'SUBMITTED') {
      unmet.push(...await releaseCertificationProblems(db, release))
      // Measured from the moment of submission; releases without a requested date are unaffected.
      const releaseDateProblem = requestedReleaseProblem(release.requested_release_at)
      if (releaseDateProblem) unmet.push(releaseDateProblem)
    }

    return unmet
  }
}

/**
 * The release-date fields a draft save will store. Omitted fields keep their stored value so older
 * clients and step saves never clear them; null clears. A newly chosen time must be in the future,
 * and pre-orders need a release time to count down to.
 */
export function resolveDraftSchedule(
  before: Record<string, unknown>,
  input: Pick<ReleaseDraftInput, 'requestedReleaseAt' | 'releaseTimezone' | 'preordersEnabled'>,
  now = Date.now(),
): {requestedReleaseAt: string | null; releaseTimezone: string | null; preordersEnabled: boolean} {
  const stored = before.requested_release_at ? new Date(before.requested_release_at as string).toISOString() : null
  const requestedReleaseAt = input.requestedReleaseAt === undefined
    ? stored
    : input.requestedReleaseAt === null ? null : new Date(input.requestedReleaseAt).toISOString()
  if (requestedReleaseAt && requestedReleaseAt !== stored && new Date(requestedReleaseAt).getTime() <= now) {
    throw new MarketplaceError(422, 'release_date_in_past', 'Choose a release date and time in the future.')
  }
  const releaseTimezone = requestedReleaseAt
    ? (input.releaseTimezone === undefined ? (before.release_timezone as string | null) : input.releaseTimezone) || 'UTC'
    : null
  const preordersEnabled = input.preordersEnabled === undefined ? Boolean(before.preorders_enabled) : input.preordersEnabled
  if (preordersEnabled && !requestedReleaseAt) {
    throw new MarketplaceError(422, 'preorders_need_release_date', 'Pre-orders need a release date. Choose one or turn pre-orders off.')
  }
  return {requestedReleaseAt, releaseTimezone, preordersEnabled}
}

/**
 * SQL: the preview clip `clip` was made for track `track`'s current preview setting (start choice,
 * null = automatic) from its latest audio upload. Clips made before artists could choose a start do
 * not match, so they are regenerated.
 */
export function PREVIEW_MATCHES_SETTING_SQL(clip: string, track: string): string {
  return `(${clip}.metadata ? 'previewSetting'
    AND ${clip}.metadata->>'previewSetting' IS NOT DISTINCT FROM ${track}.preview_start_ms::text
    AND ${clip}.metadata->>'sourceAssetId' = (SELECT latest.id FROM marketplace_assets latest WHERE latest.track_id = ${track}.id
      AND latest.kind = 'audio' AND latest.processing_status = 'ready' ORDER BY latest.created_at DESC LIMIT 1))`
}

/** Preview start to store for a track save: omitted keeps it; it must leave a full 10-second clip. */
export function resolvePreviewStart(before: Record<string, unknown> | null, input: Pick<TrackDraftInput, 'previewStartMs' | 'durationMs'>): number | null {
  if (input.previewStartMs === undefined) return (before?.preview_start_ms as number | null | undefined) ?? null
  if (input.previewStartMs === null) return null
  const duration = input.durationMs ?? (before?.duration_ms as number | null | undefined) ?? null
  if (duration && input.previewStartMs > maxPreviewStartMs(duration)) {
    const latest = Math.floor(maxPreviewStartMs(duration) / 1000)
    throw new MarketplaceError(422, 'preview_start_too_late', `The preview must start early enough to play 10 seconds. The latest start for this song is ${Math.floor(latest / 60)}:${String(latest % 60).padStart(2, '0')}.`)
  }
  return input.previewStartMs
}

/**
 * Postgres DATE columns arrive as JS Dates (local midnight), which serialize as full timestamps
 * ("2026-11-06T00:00:00.000Z"). The draft API accepts and the date inputs expect plain calendar
 * dates, so release rows sent to the artist portal carry "YYYY-MM-DD".
 */
export function withCalendarDates<T extends Record<string, unknown>>(row: T): T {
  const value = row.original_release_date
  if (value instanceof Date) {
    const pad = (part: number) => String(part).padStart(2, '0')
    return {...row, original_release_date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`}
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return {...row, original_release_date: value.slice(0, 10)}
  return row
}

type AdditionalArtistInput = NonNullable<ReleaseDraftInput['additionalArtists']>

/**
 * Replaces a draft's extra primary/featured credits. Account artists must belong to this account
 * (their current name is stored as the credit); a name-only credit is someone not on MeJay. The lead
 * primary artist and repeats are refused so the credit line never names someone twice.
 */
async function replaceReleaseCredits(db: Database, providerId: string, releaseId: string, leadArtistId: string, credits: AdditionalArtistInput): Promise<void> {
  const seen = new Set<string>()
  const rows: Array<{role: 'primary' | 'featured'; artistId: string | null; name: string}> = []
  for (const credit of credits) {
    let name = credit.name.replace(/\s+/g, ' ').trim()
    const artistId = credit.artistId ?? null
    if (artistId) {
      if (artistId === leadArtistId) throw new MarketplaceError(422, 'duplicate_artist_credit', 'The primary artist is already credited. Choose a different artist.')
      const artist = await db.prepare('SELECT name FROM artists WHERE id = ?1 AND provider_profile_id = ?2').bind(artistId, providerId).first<{name: string}>()
      if (!artist) throw new MarketplaceError(404, 'not_found', 'Artist was not found')
      name = artist.name
    }
    const key = artistId ? `id:${artistId}` : `name:${name.toLowerCase()}`
    if (seen.has(key) || seen.has(`name:${name.toLowerCase()}`)) throw new MarketplaceError(422, 'duplicate_artist_credit', `${name} is listed more than once.`)
    seen.add(key)
    seen.add(`name:${name.toLowerCase()}`)
    rows.push({role: credit.role, artistId, name})
  }
  await db.prepare('DELETE FROM release_artist_credits WHERE release_id = ?1 AND provider_profile_id = ?2').bind(releaseId, providerId).run()
  for (const [position, row] of rows.entries()) {
    await db.prepare(
      `INSERT INTO release_artist_credits (id, provider_profile_id, release_id, role, artist_id, display_name, position)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(crypto.randomUUID(), providerId, releaseId, row.role, row.artistId, row.name, position).run()
  }
}

