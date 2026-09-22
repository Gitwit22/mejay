import type {DiscoveryFeaturesInput, ProviderAdminCommand, ReleaseAdminCommand, SplitDisputeInput} from './admin-schemas'
import {MarketplaceError} from './service'
import {getReleaseSaleReadiness} from './sale-policy'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
  run: () => Promise<unknown>
}

type Database = {
  prepare: (sql: string) => Statement
  transaction: <T>(callback: (database: Database) => Promise<T>) => Promise<T>
}

type Staff = {role: 'reviewer' | 'admin'; protected_owner: boolean}
type Release = {id: string; provider_profile_id: string; status: string; version: number; scheduled_release_at: string | null}
type IsrcRegistryFilters = {isrc?: string; track?: string; artist?: string; provider?: string; year?: number | null}

const reviewActions = new Set<ReleaseAdminCommand['action']>(['start_review', 'approve', 'request_changes', 'reject'])
const adminActions = new Set<ReleaseAdminCommand['action']>(['publish_now', 'schedule', 'publish_due', 'unpublish', 'takedown'])

export function releaseCommandTarget(action: ReleaseAdminCommand['action']): string {
  if (action === 'start_review') return 'UNDER_REVIEW'
  if (action === 'approve' || action === 'unpublish') return 'APPROVED'
  if (action === 'request_changes') return 'CHANGES_REQUESTED'
  if (action === 'reject') return 'REJECTED'
  if (action === 'schedule') return 'SCHEDULED'
  if (action === 'takedown') return 'TAKEN_DOWN'
  return 'LIVE'
}

export function releaseCommandAllowed(action: ReleaseAdminCommand['action'], status: string): boolean {
  const expected: Record<ReleaseAdminCommand['action'], readonly string[]> = {
    start_review: ['SUBMITTED'],
    approve: ['UNDER_REVIEW'],
    request_changes: ['UNDER_REVIEW'],
    reject: ['UNDER_REVIEW'],
    publish_now: ['APPROVED'],
    schedule: ['APPROVED'],
    publish_due: ['SCHEDULED'],
    unpublish: ['LIVE'],
    takedown: ['LIVE', 'SCHEDULED'],
  }
  return expected[action].includes(status)
}

async function insertAudit(db: Database, userId: string, release: Release, action: string, target: string): Promise<void> {
  await db.prepare(
    `INSERT INTO marketplace_audit_events
      (id, provider_profile_id, actor_user_id, entity_type, entity_id, action, before_data, after_data, metadata)
     VALUES (?1, ?2, ?3, 'release', ?4, ?5, ?6, ?7, '{}'::jsonb)`,
  ).bind(
    crypto.randomUUID(), release.provider_profile_id, userId, release.id, `release.${action}`,
    JSON.stringify({status: release.status, version: release.version}),
    JSON.stringify({status: target, version: release.version + 1}),
  ).run()
}

async function requireStaff(database: Database, userId: string): Promise<{role: Staff['role']}> {
  const staff = await database.prepare(
    'SELECT role FROM marketplace_staff WHERE user_id = ?1',
  ).bind(userId).first<{role: Staff['role']}>()
  if (!staff) throw new MarketplaceError(403, 'marketplace_staff_required', 'Marketplace staff access is required')
  return staff
}

function escapeCsvCell(value: unknown): string {
  const unsafe = value === null || value === undefined ? '' : String(value)
  const text = /^[=+\-@]/.test(unsafe) ? `'${unsafe}` : unsafe
  if (!/[",\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

export class MarketplaceAdminService {
  constructor(private readonly database: Database) {}

  async getOverview(userId: string): Promise<unknown> {
    const staff = await requireStaff(this.database, userId)

    const pending = await this.database.prepare(
      `SELECT r.id, r.title, r.status, r.version, r.submitted_at, r.updated_at,
        p.id AS provider_id, p.display_name AS provider_name
       FROM releases r JOIN provider_profiles p ON p.id = r.provider_profile_id
       WHERE r.status IN ('SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED')
       ORDER BY COALESCE(r.submitted_at, r.updated_at), r.updated_at`,
    ).all()
    const catalog = await this.database.prepare(
      `SELECT r.id, r.title, r.status, r.version, r.scheduled_release_at, r.published_at,
        p.display_name AS provider_name
       FROM releases r JOIN provider_profiles p ON p.id = r.provider_profile_id
       WHERE r.status IN ('APPROVED', 'SCHEDULED', 'LIVE') ORDER BY r.updated_at DESC`,
    ).all()
    const providers = await this.database.prepare(
      `SELECT p.id, p.display_name, p.contact_email, p.status, COUNT(r.id)::integer AS release_count
       FROM provider_profiles p LEFT JOIN releases r ON r.provider_profile_id = p.id
       GROUP BY p.id ORDER BY p.updated_at DESC`,
    ).all()
    const artists = await this.database.prepare(
      `SELECT a.id, a.name, a.country_code, p.display_name AS provider_name
       FROM artists a JOIN provider_profiles p ON p.id = a.provider_profile_id ORDER BY LOWER(a.name)`,
    ).all()
    const isrcs = await this.database.prepare(
      `SELECT i.isrc, i.source, i.assigned_at, t.title AS track_title, p.display_name AS provider_name
       FROM isrc_assignments i JOIN tracks t ON t.id = i.track_id
       JOIN provider_profiles p ON p.id = i.provider_profile_id
       WHERE i.revoked_at IS NULL ORDER BY i.assigned_at DESC`,
    ).all()
    const rights = await this.database.prepare(
      `SELECT d.id, d.declaration_type, d.rights_holder, d.ownership_bps, d.status,
        COALESCE(r.title, t.title) AS item_title, p.display_name AS provider_name
       FROM rights_declarations d LEFT JOIN releases r ON r.id = d.release_id
       LEFT JOIN tracks t ON t.id = d.track_id JOIN provider_profiles p ON p.id = d.provider_profile_id
       ORDER BY d.created_at DESC`,
    ).all()
    const pricing = await this.database.prepare(
      `SELECT pr.id, pr.amount_minor, pr.currency, pr.active, product.name,
        r.title AS release_title, provider.display_name AS provider_name
       FROM prices pr JOIN products product ON product.id = pr.product_id
       LEFT JOIN releases r ON r.id = product.release_id
       JOIN provider_profiles provider ON provider.id = product.provider_profile_id
       ORDER BY pr.created_at DESC`,
    ).all()
    const splits = await this.database.prepare(
      `SELECT s.id, s.version, s.active, t.title AS track_title, p.display_name AS provider_name,
        COALESCE(SUM(e.share_bps), 0)::integer AS total_bps, COUNT(e.id)::integer AS payee_count
       FROM revenue_split_sets s JOIN tracks t ON t.id = s.track_id
       JOIN provider_profiles p ON p.id = s.provider_profile_id
       LEFT JOIN revenue_split_entries e ON e.split_set_id = s.id
       GROUP BY s.id, t.title, p.display_name ORDER BY s.created_at DESC`,
    ).all()
    const takedowns = await this.database.prepare(
      `SELECT td.id, td.reason, td.prior_status, td.created_at, td.restored_at,
        r.title AS release_title, p.display_name AS provider_name
       FROM release_takedowns td JOIN releases r ON r.id = td.release_id
       JOIN provider_profiles p ON p.id = td.provider_profile_id ORDER BY td.created_at DESC`,
    ).all()
    const counts = await this.database.prepare(
      `SELECT
        (SELECT COUNT(*)::integer FROM releases WHERE status IN ('SUBMITTED', 'UNDER_REVIEW')) AS pending_releases,
        (SELECT COUNT(*)::integer FROM releases WHERE status = 'LIVE') AS live_releases,
        (SELECT COUNT(*)::integer FROM releases WHERE status = 'SCHEDULED') AS scheduled_releases,
        (SELECT COUNT(*)::integer FROM provider_profiles) AS providers,
        (SELECT COUNT(*)::integer FROM artists) AS artists,
        (SELECT COUNT(*)::integer FROM release_takedowns WHERE restored_at IS NULL) AS active_takedowns`,
    ).first()
    const featuredReleases = await this.database.prepare(
      `SELECT r.id, r.title, feature.position FROM marketplace_discovery_features feature
       JOIN releases r ON r.id = feature.release_id AND r.status = 'LIVE'
       ORDER BY feature.position`,
    ).all()
    const featuredArtists = await this.database.prepare(
      `SELECT a.id, a.name, feature.position FROM marketplace_discovery_features feature
       JOIN artists a ON a.id = feature.artist_id
       WHERE EXISTS (SELECT 1 FROM release_artists credit JOIN releases r ON r.id = credit.release_id
         WHERE credit.artist_id = a.id AND r.status = 'LIVE')
       ORDER BY feature.position`,
    ).all()
    const eligibleArtists = await this.database.prepare(
      `SELECT a.id, a.name FROM artists a
       WHERE EXISTS (SELECT 1 FROM release_artists credit JOIN releases r ON r.id = credit.release_id
         WHERE credit.artist_id = a.id AND r.status = 'LIVE')
       ORDER BY LOWER(a.name)`,
    ).all()
    return {role: staff.role, counts, pending: pending.results, catalog: catalog.results, providers: providers.results, artists: artists.results, isrcs: isrcs.results, rights: rights.results, pricing: pricing.results, splits: splits.results, takedowns: takedowns.results, discovery: {featuredReleases: featuredReleases.results, featuredArtists: featuredArtists.results, eligibleReleases: catalog.results.filter((row) => (row as {status?: string}).status === 'LIVE'), eligibleArtists: eligibleArtists.results}}
  }

  async listIsrcRegistry(userId: string, filters: IsrcRegistryFilters = {}): Promise<Array<Record<string, unknown>>> {
    await requireStaff(this.database, userId)
    const year = Number.isInteger(filters.year) ? filters.year : null
    const {results} = await this.database.prepare(
      `SELECT
        registry.id,
        registry.isrc,
        COALESCE(registry.track_title, track.title) AS track,
        COALESCE(registry.artist_name, artist.name) AS artist,
        COALESCE(registry.provider_name, provider.display_name) AS provider,
        registry.assignment_type AS type,
        registry.assigned_at AS assigned,
        registry.status,
        registry.assignment_year AS year
       FROM isrc_registry registry
       LEFT JOIN tracks track ON track.id = registry.track_id
       LEFT JOIN artists artist ON artist.id = registry.artist_id
       LEFT JOIN provider_profiles provider ON provider.id = registry.provider_profile_id
       WHERE (?1 = '' OR registry.isrc ILIKE '%' || ?1 || '%')
         AND (?2 = '' OR COALESCE(registry.track_title, track.title, '') ILIKE '%' || ?2 || '%')
         AND (?3 = '' OR COALESCE(registry.artist_name, artist.name, '') ILIKE '%' || ?3 || '%')
         AND (?4 = '' OR COALESCE(registry.provider_name, provider.display_name, '') ILIKE '%' || ?4 || '%')
         AND (?5::integer IS NULL OR registry.assignment_year = ?5)
       ORDER BY registry.assigned_at DESC, registry.isrc`,
    ).bind(
      filters.isrc?.trim() ?? '',
      filters.track?.trim() ?? '',
      filters.artist?.trim() ?? '',
      filters.provider?.trim() ?? '',
      year,
    ).all<Record<string, unknown>>()
    return results
  }

  async getIsrcRecord(userId: string, id: string): Promise<Record<string, unknown>> {
    await requireStaff(this.database, userId)
    const row = await this.database.prepare(
      `SELECT
        registry.id,
        registry.isrc,
        registry.track_id AS "trackId",
        COALESCE(registry.track_title, track.title) AS track,
        registry.artist_id AS "artistId",
        COALESCE(registry.artist_name, artist.name) AS artist,
        registry.provider_profile_id AS "providerId",
        COALESCE(registry.provider_name, provider.display_name) AS provider,
        registry.rights_owner_id AS "rightsOwnerId",
        registry.rights_owner_name AS "rightsOwnerName",
        registry.prefix,
        registry.country_code AS "countryCode",
        registry.registrant_code AS "registrantCode",
        registry.assignment_year AS "assignmentYear",
        LPAD(registry.designation::text, 5, '0') AS "designationCode",
        registry.assignment_type AS "assignmentType",
        registry.status,
        registry.assigned_at AS "assignedAt",
        registry.assigned_by_user_id AS "assignedByUserId",
        registry.rights_certification_id AS "rightsCertificationId",
        registry.created_at AS "createdAt",
        registry.updated_at AS "updatedAt"
       FROM isrc_registry registry
       LEFT JOIN tracks track ON track.id = registry.track_id
       LEFT JOIN artists artist ON artist.id = registry.artist_id
       LEFT JOIN provider_profiles provider ON provider.id = registry.provider_profile_id
       WHERE registry.id = ?1`,
    ).bind(id).first<Record<string, unknown>>()
    if (!row) throw new MarketplaceError(404, 'not_found', 'ISRC record was not found')
    return row
  }

  async getIsrcSequence(userId: string, prefix = 'QTA3L', assignmentYear = new Date().getUTCFullYear() % 100): Promise<Record<string, unknown>> {
    await requireStaff(this.database, userId)
    const sequence = await this.database.prepare(
      `SELECT prefix, assignment_year AS "assignmentYear", next_number AS "nextNumber"
       FROM isrc_sequences
       WHERE prefix = ?1 AND assignment_year = ?2`,
    ).bind(prefix, assignmentYear).first<{prefix: string; assignmentYear: number; nextNumber: number}>()
    return {
      prefix,
      assignmentYear,
      nextNumber: sequence?.nextNumber ?? 1,
      previewIsrc: `${prefix.slice(0, 2)}-${prefix.slice(2)}-${String(assignmentYear).padStart(2, '0')}-${String(sequence?.nextNumber ?? 1).padStart(5, '0')}`,
    }
  }

  async exportIsrcRegistry(userId: string, filters: IsrcRegistryFilters = {}): Promise<{data: string; fileName: string}> {
    const rows = await this.listIsrcRegistry(userId, filters)
    const header = ['ISRC', 'Track', 'Artist', 'Provider', 'Type', 'Assigned', 'Status', 'Year']
    const lines = [
      header.join(','),
      ...rows.map((row) => [
        row.isrc,
        row.track,
        row.artist,
        row.provider,
        row.type,
        row.assigned,
        row.status,
        row.year,
      ].map(escapeCsvCell).join(',')),
    ]
    return {
      data: `${lines.join('\n')}\n`,
      fileName: `mejay-isrc-registry-${new Date().toISOString().slice(0, 10)}.csv`,
    }
  }

  async replaceDiscoveryFeatures(userId: string, input: DiscoveryFeaturesInput): Promise<{releaseIds: string[]; artistIds: string[]}> {
    return this.database.transaction(async (db) => {
      const staff = await db.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1').bind(userId).first<{role: Staff['role']}>()
      if (!staff) throw new MarketplaceError(403, 'marketplace_staff_required', 'Marketplace staff access is required')
      if (staff.role !== 'admin') throw new MarketplaceError(403, 'marketplace_admin_required', 'Marketplace admin access is required')

      await validateFeatureIds(db, 'release', input.releaseIds)
      await validateFeatureIds(db, 'artist', input.artistIds)
      await db.prepare('DELETE FROM marketplace_discovery_features').run()
      for (const [position, releaseId] of input.releaseIds.entries()) {
        await db.prepare(
          `INSERT INTO marketplace_discovery_features (id, release_id, position, created_by_user_id)
           VALUES (?1, ?2, ?3, ?4)`,
        ).bind(crypto.randomUUID(), releaseId, position, userId).run()
      }
      for (const [position, artistId] of input.artistIds.entries()) {
        await db.prepare(
          `INSERT INTO marketplace_discovery_features (id, artist_id, position, created_by_user_id)
           VALUES (?1, ?2, ?3, ?4)`,
        ).bind(crypto.randomUUID(), artistId, position, userId).run()
      }
      return input
    })
  }

  async commandProvider(userId: string, providerId: string, command: ProviderAdminCommand): Promise<unknown> {
    return this.database.transaction(async (db) => {
      const staff = await db.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1')
        .bind(userId).first<{role: Staff['role']}>()
      if (staff?.role !== 'admin') throw new MarketplaceError(403, 'marketplace_admin_required', 'Marketplace admin access is required')
      const provider = await db.prepare(
        'SELECT * FROM provider_profiles WHERE id = ?1 FOR UPDATE',
      ).bind(providerId).first<Record<string, unknown> & {suspended_at: string | null}>()
      if (!provider) throw new MarketplaceError(404, 'not_found', 'Provider profile was not found')
      const suspend = command.action === 'suspend'
      if (suspend === Boolean(provider.suspended_at)) {
        throw new MarketplaceError(409, suspend ? 'provider_already_suspended' : 'provider_not_suspended', 'Provider suspension state is unchanged')
      }
      const row = await db.prepare(
        `UPDATE provider_profiles SET suspended_at = CASE WHEN ?1 THEN CURRENT_TIMESTAMP ELSE NULL END,
          suspension_reason = CASE WHEN ?1 THEN ?2 ELSE NULL END, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?3 RETURNING *`,
      ).bind(suspend, command.reason, providerId).first()
      if (suspend) {
        await db.prepare(
          `UPDATE products SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE provider_profile_id = ?1`,
        ).bind(providerId).run()
      }
      await db.prepare(
        `INSERT INTO marketplace_operational_incidents
          (id, provider_profile_id, incident_type, details)
         VALUES (?1, ?2, ?3, ?4)`,
      ).bind(crypto.randomUUID(), providerId, suspend ? 'provider_suspended' : 'provider_reinstated', JSON.stringify({reason: command.reason})).run()
      await db.prepare(
        `INSERT INTO marketplace_audit_events
          (id, provider_profile_id, actor_user_id, entity_type, entity_id, action, before_data, after_data, metadata)
         VALUES (?1, ?2, ?3, 'provider', ?2, ?4, ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(), providerId, userId, `provider.${command.action}`,
        JSON.stringify(provider), JSON.stringify(row), JSON.stringify({reason: command.reason}),
      ).run()
      return row
    })
  }

  async recordSplitDispute(userId: string, input: SplitDisputeInput): Promise<{id: string}> {
    return this.database.transaction(async (db) => {
      const staff = await db.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1')
        .bind(userId).first<{role: Staff['role']}>()
      if (staff?.role !== 'admin') throw new MarketplaceError(403, 'marketplace_admin_required', 'Marketplace admin access is required')
      const split = await db.prepare(
        `SELECT id FROM revenue_split_sets WHERE id = ?1 AND provider_profile_id = ?2`,
      ).bind(input.splitSetId, input.providerId).first<{id: string}>()
      if (!split) throw new MarketplaceError(404, 'split_set_not_found', 'Revenue split set was not found')
      if (input.orderId) {
        const order = await db.prepare(
          'SELECT id FROM marketplace_orders WHERE id = ?1 AND provider_profile_id = ?2',
        ).bind(input.orderId, input.providerId).first<{id: string}>()
        if (!order) throw new MarketplaceError(404, 'order_not_found', 'Marketplace order was not found')
      }
      const id = crypto.randomUUID()
      const details = {splitSetId: input.splitSetId, reason: input.reason}
      await db.prepare(
        `INSERT INTO marketplace_operational_incidents
          (id, provider_profile_id, order_id, incident_type, details)
         VALUES (?1, ?2, ?3, 'split_dispute', ?4)`,
      ).bind(id, input.providerId, input.orderId ?? null, JSON.stringify(details)).run()
      await db.prepare(
        `INSERT INTO marketplace_audit_events
          (id, provider_profile_id, actor_user_id, entity_type, entity_id, action, after_data, metadata)
         VALUES (?1, ?2, ?3, 'revenue_split_set', ?4, 'revenue_splits.disputed', ?5, ?6)`,
      ).bind(crypto.randomUUID(), input.providerId, userId, input.splitSetId, JSON.stringify(details), JSON.stringify({orderId: input.orderId ?? null})).run()
      return {id}
    })
  }

  async commandRelease(userId: string, releaseId: string, command: ReleaseAdminCommand): Promise<unknown> {
    return this.database.transaction(async (db) => {
      const staff = await db.prepare(
        'SELECT role, protected_owner FROM marketplace_staff WHERE user_id = ?1',
      ).bind(userId).first<Staff>()
      if (!staff) throw new MarketplaceError(403, 'marketplace_staff_required', 'Marketplace staff access is required')
      if (adminActions.has(command.action) && staff.role !== 'admin') {
        throw new MarketplaceError(403, 'marketplace_admin_required', 'Marketplace admin access is required')
      }

      const release = await db.prepare('SELECT * FROM releases WHERE id = ?1 FOR UPDATE')
        .bind(releaseId).first<Release>()
      if (!release) throw new MarketplaceError(404, 'not_found', 'Release was not found')
      if (release.version !== command.expectedVersion) {
        throw new MarketplaceError(409, 'stale_release_version', 'The release was modified by another request')
      }
      if (!releaseCommandAllowed(command.action, release.status)) {
        throw new MarketplaceError(409, 'invalid_transition', `Cannot ${command.action} a ${release.status} release`)
      }

      if (reviewActions.has(command.action)) {
        const membership = await db.prepare(
          'SELECT 1 AS member FROM provider_members WHERE user_id = ?1 AND provider_profile_id = ?2',
        ).bind(userId, release.provider_profile_id).first<{member: number}>()
        if (membership && !(staff.role === 'admin' && staff.protected_owner)) {
          throw new MarketplaceError(403, 'self_review_forbidden', 'Staff cannot review their own provider releases')
        }
      }

      const now = new Date().toISOString()
      if (command.action === 'schedule' && new Date(command.scheduledReleaseAt).getTime() <= Date.now()) {
        throw new MarketplaceError(422, 'schedule_must_be_future', 'Scheduled release time must be in the future')
      }
      if (command.action === 'publish_due' && (!release.scheduled_release_at || new Date(release.scheduled_release_at).getTime() > Date.now())) {
        throw new MarketplaceError(409, 'release_not_due', 'The scheduled release is not due yet')
      }
      if (['schedule', 'publish_now', 'publish_due'].includes(command.action)) {
        const sale = await getReleaseSaleReadiness(db, release.id)
        const unmet = [
          ...(!sale.hasMinimumPrice ? ['active release product priced at least $1.00 USD'] : []),
          ...(!sale.stripeReady ? ['completed Stripe payout setup'] : []),
        ]
        if (unmet.length > 0) {
          throw new MarketplaceError(422, 'release_sale_not_ready', 'Release sales setup is not complete', unmet)
        }
      }

      const target = releaseCommandTarget(command.action)
      const scheduledAt = command.action === 'schedule' ? command.scheduledReleaseAt : null
      const row = await db.prepare(
        `UPDATE releases SET status = ?1, version = version + 1, updated_at = ?2,
          scheduled_release_at = CASE WHEN ?1 = 'SCHEDULED' THEN ?3 WHEN ?1 IN ('APPROVED', 'TAKEN_DOWN') THEN NULL ELSE scheduled_release_at END,
          approved_at = CASE WHEN ?1 = 'APPROVED' AND approved_at IS NULL THEN ?2 ELSE approved_at END,
          published_at = CASE WHEN ?1 = 'LIVE' THEN ?2 WHEN ?1 IN ('APPROVED', 'TAKEN_DOWN') THEN NULL ELSE published_at END
         WHERE id = ?4 AND version = ?5 RETURNING *`,
      ).bind(target, now, scheduledAt, release.id, command.expectedVersion).first()
      if (!row) throw new MarketplaceError(409, 'stale_release_version', 'The release was modified by another request')

      if (reviewActions.has(command.action)) {
        await db.prepare(
          `INSERT INTO release_review_events
            (id, release_id, provider_profile_id, actor_user_id, decision, note, from_status, to_status)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        ).bind(
          crypto.randomUUID(), release.id, release.provider_profile_id, userId,
          command.action === 'start_review' ? 'review_started' : command.action === 'request_changes' ? 'changes_requested' : command.action,
          'note' in command ? command.note : null, release.status, target,
        ).run()
      }
      if (command.action === 'takedown') {
        await db.prepare(
          `INSERT INTO release_takedowns
            (id, release_id, provider_profile_id, actor_user_id, reason, prior_status)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        ).bind(crypto.randomUUID(), release.id, release.provider_profile_id, userId, command.note, release.status).run()
      }

      if (['publish_now', 'publish_due'].includes(command.action)) {
        await db.prepare('UPDATE products SET active = TRUE, updated_at = ?1 WHERE release_id = ?2').bind(now, release.id).run()
      } else if (['unpublish', 'takedown'].includes(command.action)) {
        await db.prepare('UPDATE products SET active = FALSE, updated_at = ?1 WHERE release_id = ?2').bind(now, release.id).run()
      }
      await insertAudit(db, userId, release, command.action, target)
      return row
    })
  }
}

async function validateFeatureIds(db: Database, kind: 'release' | 'artist', ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const placeholders = ids.map((_, index) => `?${index + 1}`).join(', ')
  const sql = kind === 'release'
    ? `SELECT COUNT(*)::integer AS count FROM releases WHERE status = 'LIVE' AND id IN (${placeholders})`
    : `SELECT COUNT(DISTINCT a.id)::integer AS count FROM artists a JOIN release_artists credit ON credit.artist_id = a.id JOIN releases r ON r.id = credit.release_id AND r.status = 'LIVE' WHERE a.id IN (${placeholders})`
  const row = await db.prepare(sql).bind(...ids).first<{count: number}>()
  if (Number(row?.count) !== ids.length) throw new MarketplaceError(422, 'invalid_discovery_feature', `Every featured ${kind} must be eligible and LIVE`)
}