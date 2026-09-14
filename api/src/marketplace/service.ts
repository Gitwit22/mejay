import {bootstrapProviderAccount} from './onboarding'
import {userHasArtistPortalAccess} from '../account/artist-access'
import type {
  ArtistInput,
  AssetInput,
  IsrcAssignmentInput,
  PriceInput,
  ProductInput,
  ProviderInput,
  ReleaseInput,
  RevenueSplitsInput,
  RightsDeclarationInput,
  TrackInput,
  TransitionInput,
} from './schemas'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  run: () => Promise<unknown>
}

type Database = {
  prepare: (sql: string) => Statement
  transaction: <T>(callback: (database: Database) => Promise<T>) => Promise<T>
}

type ProviderContext = {
  providerId: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
}

type ReleaseStatus =
  | 'DRAFT'
  | 'METADATA_COMPLETE'
  | 'RIGHTS_COMPLETE'
  | 'ISRC_COMPLETE'
  | 'PRICING_COMPLETE'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'LIVE'

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
  UNDER_REVIEW: ['APPROVED'],
  APPROVED: ['SCHEDULED', 'LIVE'],
  SCHEDULED: ['LIVE'],
  LIVE: [],
}

export function isReleaseTransitionAllowed(current: ReleaseStatus, target: ReleaseStatus): boolean {
  return transitions[current].includes(target)
}

function nowIso(): string {
  return new Date().toISOString()
}

async function providerContext(db: Database, userId: string, mutate = true): Promise<ProviderContext> {
  if (mutate && !(await userHasArtistPortalAccess(db, userId))) {
    throw new MarketplaceError(403, 'pro_subscription_required', 'An active Pro subscription is required for Artist access')
  }
  const row = await db
    .prepare('SELECT provider_profile_id, role FROM provider_members WHERE user_id = ?1 ORDER BY created_at LIMIT 1')
    .bind(userId)
    .first<{provider_profile_id: string; role: ProviderContext['role']}>()
  if (!row) throw new MarketplaceError(403, 'provider_required', 'A provider profile is required')
  if (mutate && !['owner', 'admin', 'editor'].includes(row.role)) {
    throw new MarketplaceError(403, 'provider_write_forbidden', 'Provider write access is required')
  }
  return {providerId: row.provider_profile_id, role: row.role}
}

async function assertOwned(db: Database, table: 'artists' | 'releases' | 'tracks' | 'products', id: string, providerId: string): Promise<void> {
  const row = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ?1 AND provider_profile_id = ?2`)
    .bind(id, providerId)
    .first<{id: string}>()
  if (!row) throw new MarketplaceError(404, 'not_found', 'Marketplace resource was not found')
}

const lockedReleaseStatuses: readonly ReleaseStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'LIVE']

export function isReleaseMutable(status: ReleaseStatus): boolean {
  return !lockedReleaseStatuses.includes(status)
}

function assertMutableStatus(status: ReleaseStatus): void {
  if (!isReleaseMutable(status)) {
    throw new MarketplaceError(409, 'release_locked', 'Submitted releases cannot be modified')
  }
}

async function assertReleaseMutable(db: Database, releaseId: string, providerId: string): Promise<void> {
  const release = await db.prepare(
    'SELECT status FROM releases WHERE id = ?1 AND provider_profile_id = ?2',
  ).bind(releaseId, providerId).first<{status: ReleaseStatus}>()
  if (!release) throw new MarketplaceError(404, 'not_found', 'Marketplace resource was not found')
  assertMutableStatus(release.status)
}

async function assertTrackMutable(db: Database, trackId: string, providerId: string): Promise<void> {
  const release = await db.prepare(
    `SELECT r.status FROM tracks t JOIN releases r ON r.id = t.release_id
     WHERE t.id = ?1 AND t.provider_profile_id = ?2`,
  ).bind(trackId, providerId).first<{status: ReleaseStatus}>()
  if (!release) throw new MarketplaceError(404, 'not_found', 'Marketplace resource was not found')
  assertMutableStatus(release.status)
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

async function audit(db: Database, args: {
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

async function inserted<T>(statement: {first: <R>() => Promise<R | null>}): Promise<T> {
  const row = await statement.first<T>()
  if (!row) throw new Error('insert_failed')
  return row
}

export class MarketplaceService {
  constructor(private readonly database: Database) {}

  async completeProvider(userId: string, input: ProviderInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const now = nowIso()
      await bootstrapProviderAccount({db, userId, createdAt: now})
      const context = await providerContext(db, userId)
      const row = await inserted<any>(db.prepare(
        `UPDATE provider_profiles SET display_name = ?1, legal_name = ?2, slug = ?3,
          contact_email = ?4, country_code = ?5, bio = ?6,
          status = CASE WHEN status = 'pending_profile_completion' THEN 'pending_review' ELSE status END,
          updated_at = ?7
         WHERE id = ?8 RETURNING *`,
      ).bind(input.displayName, input.legalName ?? null, input.slug, input.contactEmail, input.countryCode, input.bio ?? null, now, context.providerId))
      await db.prepare("UPDATE users SET account_intent = 'provider', updated_at = ?1 WHERE id = ?2").bind(now, userId).run()
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'provider', entityId: context.providerId, action: 'provider.completed', after: row})
      return row
    })
  }

  async createArtist(userId: string, input: ArtistInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      const id = crypto.randomUUID()
      const row = await inserted<any>(db.prepare(
        `INSERT INTO artists (id, provider_profile_id, name, sort_name, country_code, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *`,
      ).bind(id, context.providerId, input.name, input.sortName ?? null, input.countryCode ?? null, JSON.stringify(input.metadata)))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'artist', entityId: id, action: 'artist.created', after: row})
      return row
    })
  }

  async createRelease(userId: string, input: ReleaseInput): Promise<unknown> {
    return this.database.transaction(async (db: Database) => {
      const context = await providerContext(db, userId)
      await assertOwned(db, 'artists', input.primaryArtistId, context.providerId)
      const id = crypto.randomUUID()
      const row = await inserted<any>(db.prepare(
        `INSERT INTO releases
          (id, provider_profile_id, title, version_title, release_type, label_name, catalog_number, original_release_date, scheduled_release_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING *`,
      ).bind(id, context.providerId, input.title, input.versionTitle ?? null, input.releaseType, input.labelName ?? null, input.catalogNumber ?? null, input.originalReleaseDate ?? null, input.scheduledReleaseAt ?? null))
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
      await assertTrackMutable(db, trackId, context.providerId)
      const id = crypto.randomUUID()
      const row = await inserted<any>(db.prepare(
        `INSERT INTO isrc_assignments (id, provider_profile_id, track_id, isrc, source, assigned_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *`,
      ).bind(id, context.providerId, trackId, input.isrc, input.source, userId))
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'isrc_assignment', entityId: id, action: 'isrc.assigned', after: row})
      return row
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

      if (['UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'LIVE'].includes(targetStatus)) {
        const staff = await db.prepare(
          `SELECT role FROM marketplace_staff WHERE user_id = ?1 AND NOT EXISTS (
            SELECT 1 FROM provider_members WHERE user_id = ?1 AND provider_profile_id = ?2
          )`,
        ).bind(userId, release.provider_profile_id).first<{role: string}>()
        if (!staff) throw new MarketplaceError(403, 'marketplace_staff_required', 'Marketplace reviewer access is required')
      } else {
        const context = await providerContext(db, userId)
        if (context.providerId !== release.provider_profile_id) throw new MarketplaceError(404, 'not_found', 'Release was not found')
      }

      const unmet = await this.unmetPrerequisites(db, release, targetStatus)
      if (unmet.length > 0) throw new MarketplaceError(422, 'release_prerequisites_unmet', 'Release prerequisites are not complete', unmet)

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

    if (shouldCheck('ISRC_COMPLETE')) {
      const isrc = await db.prepare(
        `SELECT COUNT(*)::integer AS missing FROM tracks t WHERE t.release_id = ?1 AND NOT EXISTS
          (SELECT 1 FROM isrc_assignments i WHERE i.track_id = t.id AND i.revoked_at IS NULL)`,
      ).bind(release.id).first<{missing: number}>()
      if (isrc?.missing !== 0) unmet.push('active ISRC for every track')
    }

    if (shouldCheck('PRICING_COMPLETE')) {
      const pricing = await db.prepare(
        `SELECT
          EXISTS (
            SELECT 1 FROM products p JOIN prices pr ON pr.product_id = p.id
            WHERE p.release_id = ?1 AND p.active = TRUE AND pr.active = TRUE
              AND pr.effective_from <= CURRENT_TIMESTAMP
              AND (pr.effective_until IS NULL OR pr.effective_until > CURRENT_TIMESTAMP)
          ) AS has_price,
          (SELECT COUNT(*) FROM tracks t WHERE t.release_id = ?1 AND NOT EXISTS (
            SELECT 1 FROM revenue_split_sets s WHERE s.track_id = t.id AND s.active = TRUE
              AND (SELECT COALESCE(SUM(e.share_bps), 0) FROM revenue_split_entries e WHERE e.split_set_id = s.id) = 10000
          ))::integer AS missing_splits`,
      ).bind(release.id).first<{has_price: boolean; missing_splits: number}>()
      if (!pricing?.has_price) unmet.push('active release product with a current price')
      if (pricing?.missing_splits !== 0) unmet.push('active revenue splits totaling 10000 basis points for every track')
    }

    return unmet
  }
}
