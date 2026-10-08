import {z} from 'zod'

import {
  CERTIFICATION_STATEMENTS,
  CERTIFICATION_VERSION,
  certificationProblems,
  certificationStatement,
  ISRC_STATEMENT,
  ORIGINAL_MUSIC_POLICY,
  requiredCertificationKeys,
  submissionRightsStatus,
  type CertificationDraftInput,
  type CertificationKey,
  type RightsMaterialInput,
  type StoredCertificationDraft,
} from './release-certification'
import {assertOwned, assertReleaseMutable, assertTrackMutable, audit, MarketplaceError, providerContext, type Database} from './service'

export const trackCreditsSchema = z.object({
  /** Featured artists that exist on the same artist account (linked through track_artists). */
  featuredArtistIds: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
  contributors: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    role: z.enum(['writer', 'composer', 'producer', 'featured_artist', 'remixer', 'other']),
    publisherName: z.string().trim().max(200).transform((value) => value || null).nullable().optional(),
  }).strict()).max(50).default([]),
}).strict().refine((value) => new Set(value.featuredArtistIds).size === value.featuredArtistIds.length, 'Featured artists must be unique')

export type TrackCreditsInput = z.infer<typeof trackCreditsSchema>

export type RequestMeta = {ipHash: string | null; userAgent: string | null}

function parseDraft(value: unknown): StoredCertificationDraft | null {
  if (!value) return null
  const draft = typeof value === 'string' ? JSON.parse(value) : value
  return draft && typeof draft === 'object' ? draft as StoredCertificationDraft : null
}

async function tracksWithoutIsrc(db: Database, releaseId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*)::integer AS count FROM tracks t WHERE t.release_id = ?1 AND NOT EXISTS (
       SELECT 1 FROM isrc_assignments i WHERE i.track_id = t.id AND i.revoked_at IS NULL)`,
  ).bind(releaseId).first<{count: number}>()
  return Number(row?.count ?? 0)
}

async function materialsFor(db: Database, releaseId: string): Promise<Array<{
  id: string; material_type: string; licensor_name: string; description: string; license_type: string; document_asset_id: string | null
}>> {
  const {results} = await db.prepare(
    `SELECT id, material_type, licensor_name, description, license_type, document_asset_id
     FROM release_rights_materials WHERE release_id = ?1 ORDER BY created_at, id`,
  ).bind(releaseId).all()
  return results as never
}

/** Outstanding certification work for a release (used by submission prerequisites). */
export async function releaseCertificationProblems(db: Database, release: {id: string; certification_draft?: unknown}): Promise<string[]> {
  const draft = parseDraft(release.certification_draft)
  const materials = await materialsFor(db, release.id)
  return certificationProblems({draft, tracksWithoutIsrc: await tracksWithoutIsrc(db, release.id), materialCount: materials.length})
}

/**
 * Write the immutable certification snapshot for a submission and set the release's rights status.
 * Runs inside the submit transaction; the draft is consumed so any resubmission must re-certify.
 */
export async function snapshotReleaseCertification(db: Database, release: any, userId: string, meta: RequestMeta | null): Promise<{certificationId: string; rightsStatus: string}> {
  const draft = parseDraft(release.certification_draft)
  const materials = await materialsFor(db, release.id)
  const missingIsrc = await tracksWithoutIsrc(db, release.id)
  const problems = certificationProblems({draft, tracksWithoutIsrc: missingIsrc, materialCount: materials.length})
  if (problems.length > 0 || !draft) throw new MarketplaceError(422, 'release_prerequisites_unmet', 'Release prerequisites are not complete', problems)

  const rightsStatus = submissionRightsStatus(draft.thirdPartyMaterial, materials.map((material) => ({documentAssetId: material.document_asset_id})))
  const primaryArtist = await db.prepare(
    `SELECT a.id, a.name, a.slug FROM release_artists credit JOIN artists a ON a.id = credit.artist_id
     WHERE credit.release_id = ?1 AND credit.is_primary = TRUE LIMIT 1`,
  ).bind(release.id).first<{id: string; name: string; slug: string}>()
  const {results: tracks} = await db.prepare(
    `SELECT t.id, t.title, t.version_title, t.disc_number, t.track_number, t.explicit, t.language_code, t.genre,
       isrc.isrc,
       COALESCE((SELECT json_agg(json_build_object('name', c.name, 'role', c.role, 'publisherName', c.publisher_name) ORDER BY c.created_at, c.id)
         FROM track_contributors c WHERE c.track_id = t.id), '[]'::json) AS contributors,
       COALESCE((SELECT json_agg(json_build_object('id', fa.id, 'name', fa.name) ORDER BY fa.name)
         FROM track_artists ta JOIN artists fa ON fa.id = ta.artist_id WHERE ta.track_id = t.id AND ta.role = 'featured'), '[]'::json) AS featured_artists
     FROM tracks t LEFT JOIN isrc_assignments isrc ON isrc.track_id = t.id AND isrc.revoked_at IS NULL
     WHERE t.release_id = ?1 ORDER BY t.disc_number, t.track_number`,
  ).bind(release.id).all()
  const accepted = requiredCertificationKeys(missingIsrc).map((key) => certificationStatement(key))
  const snapshot = {
    title: release.title,
    versionTitle: release.version_title ?? null,
    releaseType: release.release_type,
    genre: release.genre ?? null,
    subgenre: release.subgenre ?? null,
    labelName: release.label_name ?? null,
    upc: release.upc ?? null,
    originalReleaseDate: release.original_release_date ?? null,
    copyright: {year: release.copyright_year ?? null, holder: release.copyright_holder ?? null},
    phonographicCopyright: {year: release.phonographic_copyright_year ?? null, holder: release.phonographic_copyright_holder ?? null},
    primaryArtist,
    tracks,
    policy: ORIGINAL_MUSIC_POLICY,
  }
  const certificationId = crypto.randomUUID()
  await db.prepare(
    `INSERT INTO release_certifications
      (id, release_id, provider_profile_id, primary_artist_id, certified_by_user_id, certification_version,
       accepted_certifications, third_party_material, third_party_materials, rights_document_ids, rights_status,
       release_version, release_snapshot, ip_hash, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
  ).bind(
    certificationId, release.id, release.provider_profile_id, primaryArtist?.id ?? null, userId, draft.version,
    JSON.stringify(accepted), draft.thirdPartyMaterial, JSON.stringify(materials),
    materials.map((material) => material.document_asset_id).filter((id): id is string => Boolean(id)),
    rightsStatus, release.version, JSON.stringify(snapshot), meta?.ipHash ?? null, meta?.userAgent?.slice(0, 500) ?? null,
  ).run()
  await db.prepare(
    `UPDATE releases SET rights_status = ?1, third_party_material = ?2, certification_draft = NULL WHERE id = ?3`,
  ).bind(rightsStatus, draft.thirdPartyMaterial, release.id).run()
  await audit(db, {
    providerId: release.provider_profile_id, actorUserId: userId, entityType: 'release', entityId: release.id,
    action: 'release.certified', after: {certificationId, rightsStatus, thirdPartyMaterial: draft.thirdPartyMaterial, version: draft.version},
  })
  return {certificationId, rightsStatus}
}

/** Credits, rights materials and the certification step. Every call is scoped to the caller's own artist account. */
export class ReleaseSubmissionService {
  constructor(private readonly database: Database) {}

  async replaceTrackCredits(userId: string, trackId: string, input: TrackCreditsInput): Promise<unknown> {
    return this.database.transaction(async (db) => {
      const context = await providerContext(db, userId)
      await assertTrackMutable(db, trackId, context.providerId)
      for (const artistId of input.featuredArtistIds) await assertOwned(db, 'artists', artistId, context.providerId)
      await db.prepare(`DELETE FROM track_artists WHERE track_id = ?1 AND provider_profile_id = ?2 AND role = 'featured'`)
        .bind(trackId, context.providerId).run()
      for (const artistId of input.featuredArtistIds) {
        await db.prepare(
          `INSERT INTO track_artists (provider_profile_id, track_id, artist_id, role, is_primary)
           VALUES (?1, ?2, ?3, 'featured', FALSE) ON CONFLICT DO NOTHING`,
        ).bind(context.providerId, trackId, artistId).run()
      }
      await db.prepare('DELETE FROM track_contributors WHERE track_id = ?1 AND provider_profile_id = ?2')
        .bind(trackId, context.providerId).run()
      for (const contributor of input.contributors) {
        await db.prepare(
          `INSERT INTO track_contributors (id, provider_profile_id, track_id, name, role, publisher_name)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        ).bind(crypto.randomUUID(), context.providerId, trackId, contributor.name, contributor.role, contributor.publisherName ?? null).run()
      }
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'track', entityId: trackId, action: 'track.credits_replaced', after: input})
      return {trackId, ...input}
    })
  }

  async getCertification(userId: string, releaseId: string): Promise<unknown> {
    const context = await providerContext(this.database, userId, false)
    const release = await this.database.prepare(
      `SELECT id, status, rights_status, third_party_material, certification_draft FROM releases
       WHERE id = ?1 AND provider_profile_id = ?2`,
    ).bind(releaseId, context.providerId).first<{id: string; status: string; rights_status: string; third_party_material: string | null; certification_draft: unknown}>()
    if (!release) throw new MarketplaceError(404, 'not_found', 'Release was not found')
    const missingIsrc = await tracksWithoutIsrc(this.database, releaseId)
    const materials = await materialsFor(this.database, releaseId)
    const {results: history} = await this.database.prepare(
      `SELECT id, certification_version, third_party_material, rights_status, certified_at
       FROM release_certifications WHERE release_id = ?1 ORDER BY certified_at DESC`,
    ).bind(releaseId).all()
    const draft = parseDraft(release.certification_draft)
    return {
      version: CERTIFICATION_VERSION,
      policy: ORIGINAL_MUSIC_POLICY,
      statements: [...CERTIFICATION_STATEMENTS, ...(missingIsrc > 0 ? [ISRC_STATEMENT] : [])],
      requiredKeys: requiredCertificationKeys(missingIsrc),
      tracksWithoutIsrc: missingIsrc,
      rightsStatus: release.rights_status,
      thirdPartyMaterial: draft?.thirdPartyMaterial ?? release.third_party_material,
      draft,
      materials,
      problems: certificationProblems({draft, tracksWithoutIsrc: missingIsrc, materialCount: materials.length}),
      history,
    }
  }

  async saveCertification(userId: string, releaseId: string, input: CertificationDraftInput): Promise<unknown> {
    return this.database.transaction(async (db) => {
      const context = await providerContext(db, userId)
      await assertReleaseMutable(db, releaseId, context.providerId)
      const missingIsrc = await tracksWithoutIsrc(db, releaseId)
      const materials = await materialsFor(db, releaseId)
      const problems = certificationProblems({draft: input, tracksWithoutIsrc: missingIsrc, materialCount: materials.length})
      if (problems.length > 0) throw new MarketplaceError(422, 'certification_incomplete', 'Complete every required certification', problems)
      const draft: StoredCertificationDraft = {
        ...input,
        // Persist only what this release requires, in a stable order.
        accepted: requiredCertificationKeys(missingIsrc) as CertificationKey[],
        savedAt: new Date().toISOString(),
        savedByUserId: userId,
      }
      await db.prepare(
        `UPDATE releases SET certification_draft = ?1::jsonb, third_party_material = ?2, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?3 AND provider_profile_id = ?4`,
      ).bind(JSON.stringify(draft), input.thirdPartyMaterial, releaseId, context.providerId).run()
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'release', entityId: releaseId, action: 'release.certification_saved', after: {version: input.version, thirdPartyMaterial: input.thirdPartyMaterial}})
      return {saved: true, draft}
    })
  }

  async addRightsMaterial(userId: string, releaseId: string, input: RightsMaterialInput): Promise<unknown> {
    return this.database.transaction(async (db) => {
      const context = await providerContext(db, userId)
      await assertReleaseMutable(db, releaseId, context.providerId)
      if (input.documentAssetId) {
        const document = await db.prepare(
          `SELECT id FROM marketplace_assets WHERE id = ?1 AND release_id = ?2 AND provider_profile_id = ?3
             AND kind = 'rights_document' AND processing_status = 'ready'`,
        ).bind(input.documentAssetId, releaseId, context.providerId).first()
        if (!document) throw new MarketplaceError(422, 'invalid_rights_document', 'The rights document upload was not found or is not ready')
      }
      const id = crypto.randomUUID()
      const row = await db.prepare(
        `INSERT INTO release_rights_materials
          (id, provider_profile_id, release_id, material_type, licensor_name, description, license_type, document_asset_id, created_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING *`,
      ).bind(id, context.providerId, releaseId, input.materialType, input.licensorName, input.description, input.licenseType, input.documentAssetId ?? null, userId).first()
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'release_rights_material', entityId: id, action: 'rights_material.added', after: row})
      return row
    })
  }

  async deleteRightsMaterial(userId: string, materialId: string): Promise<{deleted: true}> {
    return this.database.transaction(async (db) => {
      const context = await providerContext(db, userId)
      const material = await db.prepare(
        'SELECT * FROM release_rights_materials WHERE id = ?1 AND provider_profile_id = ?2 FOR UPDATE',
      ).bind(materialId, context.providerId).first<{release_id: string}>()
      if (!material) throw new MarketplaceError(404, 'not_found', 'Rights material was not found')
      await assertReleaseMutable(db, material.release_id, context.providerId)
      await db.prepare('DELETE FROM release_rights_materials WHERE id = ?1 AND provider_profile_id = ?2').bind(materialId, context.providerId).run()
      await audit(db, {providerId: context.providerId, actorUserId: userId, entityType: 'release_rights_material', entityId: materialId, action: 'rights_material.removed', before: material})
      return {deleted: true}
    })
  }
}
