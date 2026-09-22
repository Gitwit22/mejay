import {z} from 'zod'

const id = z.string().trim().min(1).max(128)
const nonEmpty = z.string().trim().min(1).max(300)
const countryCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)

export const providerSchema = z.object({
  displayName: nonEmpty,
  legalName: nonEmpty.optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  contactEmail: z.string().trim().toLowerCase().email(),
  countryCode,
  bio: z.string().trim().max(2000).optional(),
})

export const artistSchema = z.object({
  name: nonEmpty,
  sortName: nonEmpty.optional(),
  countryCode: countryCode.optional(),
  metadata: z.record(z.unknown()).default({}),
})

export const releaseSchema = z.object({
  title: nonEmpty,
  versionTitle: nonEmpty.optional(),
  releaseType: z.enum(['single', 'ep', 'album']),
  primaryArtistId: id,
  labelName: nonEmpty.optional(),
  catalogNumber: nonEmpty.optional(),
  originalReleaseDate: z.string().date().optional(),
  scheduledReleaseAt: z.string().datetime({offset: true}).optional(),
})

export const releaseDraftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  draftStep: z.enum(['release-information', 'artwork', 'tracks', 'track-metadata', 'isrc', 'rights', 'pricing', 'splits', 'review']),
  title: nonEmpty,
  versionTitle: nonEmpty.nullable().optional(),
  releaseType: z.enum(['single', 'ep', 'album']),
  primaryArtistId: id,
  labelName: nonEmpty.nullable().optional(),
  catalogNumber: nonEmpty.nullable().optional(),
  genre: nonEmpty.nullable().optional(),
  subgenre: nonEmpty.nullable().optional(),
  upc: z.string().trim().regex(/^[0-9]{12,14}$/).nullable().optional(),
  originalReleaseDate: z.string().date().nullable().optional(),
  scheduledReleaseAt: z.string().datetime({offset: true}).nullable().optional(),
  copyrightYear: z.number().int().min(1900).max(2200).nullable().optional(),
  copyrightHolder: nonEmpty.nullable().optional(),
  phonographicCopyrightYear: z.number().int().min(1900).max(2200).nullable().optional(),
  phonographicCopyrightHolder: nonEmpty.nullable().optional(),
})

export const trackSchema = z.object({
  title: nonEmpty,
  versionTitle: nonEmpty.optional(),
  primaryArtistId: id,
  discNumber: z.number().int().positive().default(1),
  trackNumber: z.number().int().positive(),
  durationMs: z.number().int().positive().optional(),
  explicit: z.boolean().default(false),
  languageCode: z.string().trim().toLowerCase().regex(/^[a-z]{2,3}$/).optional(),
  metadata: z.record(z.unknown()).default({}),
})

export const trackDraftSchema = z.object({
  title: nonEmpty,
  versionTitle: nonEmpty.nullable().optional(),
  primaryArtistId: id,
  discNumber: z.number().int().positive(),
  trackNumber: z.number().int().positive(),
  durationMs: z.number().int().positive().nullable().optional(),
  explicit: z.boolean(),
  languageCode: z.string().trim().toLowerCase().regex(/^[a-z]{2,3}$/).nullable().optional(),
  genre: nonEmpty.nullable().optional(),
  instrumental: z.boolean(),
  recordingYear: z.number().int().min(1900).max(2200).nullable().optional(),
  recordingLocation: nonEmpty.nullable().optional(),
})

export const assetSchema = z.object({
  releaseId: id.optional(),
  trackId: id.optional(),
  kind: z.enum(['artwork', 'audio']),
  storageKey: nonEmpty,
  publicUrl: z.string().url().optional(),
  mimeType: nonEmpty,
  byteSize: z.number().int().positive(),
  sha256: z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/).optional(),
  processingStatus: z.enum(['pending', 'ready', 'failed']).default('ready'),
  metadata: z.record(z.unknown()).default({}),
}).superRefine((value, context) => {
  if (Number(Boolean(value.releaseId)) + Number(Boolean(value.trackId)) !== 1) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Exactly one releaseId or trackId is required'})
  }
  if (value.kind === 'artwork' && !value.releaseId) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Artwork must target a release'})
  }
  if (value.kind === 'audio' && !value.trackId) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Audio must target a track'})
  }
})

export const rightsDeclarationSchema = z.object({
  releaseId: id.optional(),
  trackId: id.optional(),
  declarationType: z.enum(['distribution', 'master', 'composition']),
  rightsHolder: nonEmpty,
  ownershipBps: z.number().int().min(1).max(10000),
  territories: z.array(nonEmpty).min(1).default(['WORLD']),
  validFrom: z.string().date().optional(),
  validUntil: z.string().date().optional(),
}).superRefine((value, context) => {
  if (Number(Boolean(value.releaseId)) + Number(Boolean(value.trackId)) !== 1) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Exactly one releaseId or trackId is required'})
  }
  if (value.declarationType === 'distribution' && !value.releaseId) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Distribution rights must target a release'})
  }
  if (value.declarationType !== 'distribution' && !value.trackId) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Master and composition rights must target a track'})
  }
  if (value.validFrom && value.validUntil && value.validUntil < value.validFrom) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'validUntil must not precede validFrom'})
  }
})

export const isrcAssignmentSchema = z.object({
  isrc: z.string().trim().toUpperCase().transform((value) => value.replace(/[-\s]/g, '')).pipe(z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/)),
  source: z.enum(['provider', 'imported', 'agency']).default('provider'),
})

export const generatedIsrcSchema = z.object({
  controlsRecording: z.literal(true),
  neverAssignedIsrc: z.literal(true),
  authorizeAssignment: z.literal(true),
})

const uploadBase = z.object({
  fileName: z.string().trim().min(1).max(255),
  byteSize: z.number().int().positive(),
})

export const uploadInitSchema = z.discriminatedUnion('kind', [
  uploadBase.extend({
    kind: z.literal('artwork'),
    releaseId: id,
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    width: z.number().int().min(3000),
    height: z.number().int().min(3000),
  }),
  uploadBase.extend({
    kind: z.literal('audio'),
    trackId: id,
    mimeType: z.enum(['audio/wav', 'audio/x-wav', 'audio/flac', 'audio/x-flac']),
  }),
]).superRefine((value, context) => {
  if (value.kind === 'artwork' && value.width !== value.height) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Artwork must be square'})
  }
  const maximum = value.kind === 'artwork' ? 20 * 1024 * 1024 : 500 * 1024 * 1024
  if (value.byteSize > maximum) {
    context.addIssue({code: z.ZodIssueCode.custom, message: `${value.kind === 'artwork' ? 'Artwork' : 'Audio'} exceeds the maximum size`})
  }
})

export const uploadFinalizeSchema = z.object({assetId: id})

export const productSchema = z.object({
  releaseId: id.optional(),
  trackId: id.optional(),
  name: nonEmpty,
}).superRefine((value, context) => {
  if (Number(Boolean(value.releaseId)) + Number(Boolean(value.trackId)) !== 1) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Exactly one releaseId or trackId is required'})
  }
})

export const priceSchema = z.object({
  amountMinor: z.number().int().min(100, 'Marketplace releases must cost at least $1.00'),
  currency: z.literal('USD'),
  effectiveFrom: z.string().datetime({offset: true}).optional(),
  effectiveUntil: z.string().datetime({offset: true}).optional(),
}).superRefine((value, context) => {
  if (value.effectiveFrom && value.effectiveUntil && value.effectiveUntil <= value.effectiveFrom) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'effectiveUntil must follow effectiveFrom'})
  }
})

export const revenueSplitsSchema = z.object({
  entries: z.array(z.object({
    payeeName: nonEmpty,
    payeeEmail: z.string().trim().toLowerCase().email().optional(),
    role: nonEmpty.optional(),
    shareBps: z.number().int().min(1).max(10000),
  })).min(1),
}).superRefine((value, context) => {
  const total = value.entries.reduce((sum, entry) => sum + entry.shareBps, 0)
  if (total !== 10000) context.addIssue({code: z.ZodIssueCode.custom, message: 'Revenue splits must total exactly 10000 basis points'})
})

export const transitionSchema = z.object({
  targetStatus: z.enum(['METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE', 'PRICING_COMPLETE', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'LIVE']),
  expectedVersion: z.number().int().positive(),
})

export const submitReleaseSchema = z.object({
  expectedVersion: z.number().int().positive(),
})

export type ProviderInput = z.infer<typeof providerSchema>
export type ArtistInput = z.infer<typeof artistSchema>
export type ReleaseInput = z.infer<typeof releaseSchema>
export type ReleaseDraftInput = z.infer<typeof releaseDraftSchema>
export type TrackInput = z.infer<typeof trackSchema>
export type TrackDraftInput = z.infer<typeof trackDraftSchema>
export type AssetInput = z.infer<typeof assetSchema>
export type RightsDeclarationInput = z.infer<typeof rightsDeclarationSchema>
export type IsrcAssignmentInput = z.infer<typeof isrcAssignmentSchema>
export type GeneratedIsrcInput = z.infer<typeof generatedIsrcSchema>
export type UploadInitInput = z.infer<typeof uploadInitSchema>
export type ProductInput = z.infer<typeof productSchema>
export type PriceInput = z.infer<typeof priceSchema>
export type RevenueSplitsInput = z.infer<typeof revenueSplitsSchema>
export type TransitionInput = z.infer<typeof transitionSchema>
export type SubmitReleaseInput = z.infer<typeof submitReleaseSchema>
