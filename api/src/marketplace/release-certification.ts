import {z} from 'zod'

/**
 * Bump when any statement wording changes. A saved draft for an older version must be re-accepted,
 * and every immutable snapshot records the version and exact wording the artist agreed to.
 */
export const CERTIFICATION_VERSION = '2026-10-v1'

export const ORIGINAL_MUSIC_POLICY = 'MeJay accepts original music for commercial sale and distribution. You must own or control the rights necessary to commercially release the recording. MeJay does not accept recordings containing unauthorized copyrighted samples.'

export const CERTIFICATION_STATEMENTS = [
  {key: 'original_recording', title: 'Original Recording', text: 'I certify that this recording contains no unauthorized samples or copyrighted third-party recordings.'},
  {key: 'beat_rights', title: 'Beat / Instrumental Rights', text: 'I certify that the instrumental/beat is original or that I have sufficient commercial rights to use, sell, and distribute it.'},
  {key: 'distribution_rights', title: 'Distribution Rights', text: 'I certify that I own or control the rights necessary to commercially sell and distribute this recording.'},
  {key: 'collaborators_authorized', title: 'Collaborators', text: 'I certify that featured artists, producers, and other contributors have authorized their participation in this release.'},
  {key: 'information_accurate', title: 'Accuracy', text: 'I certify that the release information and credits I provided are accurate to the best of my knowledge.'},
  {key: 'platform_authorization', title: 'Platform Authorization', text: 'I authorize MeJay to sell and distribute this recording according to the applicable MeJay artist/release agreement.'},
] as const

/** Required only when a track has no ISRC yet, because MeJay assigns one after approval. */
export const ISRC_STATEMENT = {
  key: 'no_prior_isrc',
  title: 'ISRC Assignment',
  text: 'I certify that every track submitted without an ISRC has never been assigned one, and I authorize MeJay to assign ISRCs to those tracks after approval.',
} as const

export type CertificationKey = (typeof CERTIFICATION_STATEMENTS)[number]['key'] | typeof ISRC_STATEMENT.key
export type ThirdPartyMaterial = 'none' | 'licensed' | 'unsure'
export type RightsStatus =
  | 'NOT_CERTIFIED' | 'CERTIFIED_ORIGINAL' | 'RIGHTS_DOCUMENTATION_ATTACHED' | 'RIGHTS_REVIEW_REQUIRED' | 'RIGHTS_CLEARED' | 'RIGHTS_ISSUE_FLAGGED'

/** Rights states that a reviewer may approve without further rights action. */
export const APPROVABLE_RIGHTS_STATUSES: readonly RightsStatus[] = ['CERTIFIED_ORIGINAL', 'RIGHTS_CLEARED']

export function requiredCertificationKeys(tracksWithoutIsrc: number): CertificationKey[] {
  return [...CERTIFICATION_STATEMENTS.map((statement) => statement.key), ...(tracksWithoutIsrc > 0 ? [ISRC_STATEMENT.key] : [])]
}

export function certificationStatement(key: CertificationKey): {key: CertificationKey; title: string; text: string} {
  if (key === ISRC_STATEMENT.key) return ISRC_STATEMENT
  const statement = CERTIFICATION_STATEMENTS.find((item) => item.key === key)
  if (!statement) throw new Error(`Unknown certification ${key}`)
  return statement
}

const certificationKeys = [
  'original_recording', 'beat_rights', 'distribution_rights', 'collaborators_authorized', 'information_accurate', 'platform_authorization', 'no_prior_isrc',
] as const satisfies readonly CertificationKey[]

export const certificationDraftSchema = z.object({
  version: z.literal(CERTIFICATION_VERSION, {errorMap: () => ({message: 'The certification wording changed; review and accept it again'})}),
  thirdPartyMaterial: z.enum(['none', 'licensed', 'unsure']),
  accepted: z.array(z.enum(certificationKeys)).max(certificationKeys.length).refine((keys) => new Set(keys).size === keys.length, 'Duplicate certifications'),
}).strict()

export type CertificationDraftInput = z.infer<typeof certificationDraftSchema>

export type StoredCertificationDraft = CertificationDraftInput & {savedAt: string; savedByUserId: string}

export const rightsMaterialSchema = z.object({
  materialType: z.enum(['sample', 'interpolation', 'leased_beat', 'licensed_beat', 'purchased_instrumental', 'other']),
  licensorName: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  licenseType: z.enum(['exclusive_license', 'non_exclusive_lease', 'sample_clearance', 'work_for_hire', 'producer_agreement', 'other']),
  documentAssetId: z.string().trim().min(1).max(128).nullable().optional(),
}).strict()

export type RightsMaterialInput = z.infer<typeof rightsMaterialSchema>

/** Statements the artist still has to accept, given the release's current tracks. */
export function missingCertifications(accepted: readonly string[], tracksWithoutIsrc: number): CertificationKey[] {
  const acceptedSet = new Set(accepted)
  return requiredCertificationKeys(tracksWithoutIsrc).filter((key) => !acceptedSet.has(key))
}

/**
 * Rights state at submission. "Licensed" with a document on every declared material can be cleared
 * by a reviewer; missing documents or an "unsure" answer always require manual rights review.
 * Nothing here makes a legal ownership determination.
 */
export function submissionRightsStatus(answer: ThirdPartyMaterial, materials: Array<{documentAssetId: string | null}>): RightsStatus {
  if (answer === 'none') return 'CERTIFIED_ORIGINAL'
  if (answer === 'unsure') return 'RIGHTS_REVIEW_REQUIRED'
  return materials.length > 0 && materials.every((material) => Boolean(material.documentAssetId))
    ? 'RIGHTS_DOCUMENTATION_ATTACHED'
    : 'RIGHTS_REVIEW_REQUIRED'
}

/** Problems that block saving or submitting a certification (empty when it is complete). */
export function certificationProblems(args: {
  draft: Pick<CertificationDraftInput, 'version' | 'thirdPartyMaterial' | 'accepted'> | null
  tracksWithoutIsrc: number
  materialCount: number
}): string[] {
  if (!args.draft) return ['rights certification']
  const problems: string[] = []
  if (args.draft.version !== CERTIFICATION_VERSION) problems.push('rights certification must be accepted again (wording updated)')
  const missing = missingCertifications(args.draft.accepted, args.tracksWithoutIsrc)
  if (missing.length > 0) problems.push(`rights certification: ${missing.map((key) => certificationStatement(key).title).join(', ')}`)
  if (args.draft.thirdPartyMaterial === 'licensed' && args.materialCount === 0) {
    problems.push('third-party material details (material type, licensor, description, license type)')
  }
  return problems
}
