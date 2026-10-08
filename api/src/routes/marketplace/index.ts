import {z, ZodError} from 'zod'
import {MarketplaceError, MarketplaceService} from '../../marketplace/service'
import {readIsrcGenerationConfig} from '../../marketplace/isrc'
import {
  artistSchema,
  isrcAssignmentSchema,
  generatedIsrcSchema,
  priceSchema,
  productSchema,
  providerSchema,
  releaseSchema,
  releaseDraftSchema,
  releasePriceSchema,
  trackPriceSchema,
  revenueSplitsSchema,
  rightsDeclarationSchema,
  submitReleaseSchema,
  trackSchema,
  trackDraftSchema,
  transitionSchema,
  uploadFinalizeSchema,
  uploadInitSchema,
} from '../../marketplace/schemas'
import {getSessionUserId, readJson, sha256Hex} from '../_auth'
import {getClientIp} from '../_security'
import {ReleaseSubmissionService, trackCreditsSchema} from '../../marketplace/release-submission-service'
import {certificationDraftSchema, rightsMaterialSchema} from '../../marketplace/release-certification'
import {artistProfileSchema} from '../../marketplace/artist-profile'
import {ArtistProfileService} from '../../marketplace/artist-profile-service'

type Context = {
  request: Request
  env: any
  params: Record<string, string | undefined>
}

type Operation<T> = (service: MarketplaceService, userId: string, input: T, params: Record<string, string | undefined>, env: any) => Promise<unknown>

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      ...(init?.headers ?? {}),
    },
  })
}

function databaseError(error: unknown): Response | null {
  const databaseError = error as {code?: string; constraint?: string}
  const code = databaseError?.code
  if (code === '23505' && databaseError.constraint === 'uq_releases_provider_fingerprint') {
    return json({ok: false, error: 'duplicate_release'}, {status: 409})
  }
  if (code === '23505' && ['isrc_registry_isrc_key', 'uq_isrc_assignments_active_isrc'].includes(databaseError.constraint ?? '')) {
    return json({ok: false, error: 'duplicate_isrc'}, {status: 409})
  }
  if (code === '23505') return json({ok: false, error: 'conflict'}, {status: 409})
  if (code === '23503') return json({ok: false, error: 'invalid_reference'}, {status: 422})
  if (code === '23514' || code === '22P02') return json({ok: false, error: 'invalid_value'}, {status: 422})
  return null
}

function errorResponse(error: unknown): Response {
  if (error instanceof MarketplaceError) {
    return json({ok: false, error: error.code, message: error.message, details: error.details}, {status: error.status})
  }
  const response = databaseError(error)
  if (response) return response
  const errorId = crypto.randomUUID()
  console.error('[marketplace] request failed', {errorId, error})
  return json({ok: false, error: 'server_error', errorId}, {status: 500})
}

function readHandler(operation: (service: MarketplaceService, userId: string, params: Record<string, string | undefined>) => Promise<unknown>) {
  return async (context: Context): Promise<Response> => {
    if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
    const userId = await getSessionUserId(context.request, context.env)
    if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})

    try {
      const result = await operation(new MarketplaceService(context.env.DB), userId, context.params ?? {})
      return json({ok: true, data: result})
    } catch (error) {
      return errorResponse(error)
    }
  }
}

function handler<Schema extends z.ZodTypeAny>(schema: Schema, operation: Operation<z.output<Schema>>, status = 201) {
  return async (context: Context): Promise<Response> => {
    if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
    const userId = await getSessionUserId(context.request, context.env)
    if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})

    try {
      const input = schema.parse(await readJson(context.request))
      const result = await operation(new MarketplaceService(context.env.DB), userId, input, context.params ?? {}, context.env)
      return json({ok: true, data: result}, {status})
    } catch (error) {
      if (error instanceof ZodError) {
        return json({ok: false, error: 'invalid_request', issues: error.issues}, {status: 400})
      }
      return errorResponse(error)
    }
  }
}

function requiredParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name]?.trim()
  if (!value) throw new MarketplaceError(400, 'missing_parameter', `${name} is required`)
  return value
}

export const createProvider = handler(providerSchema, (service, userId, input) => service.completeProvider(userId, input))
export const getDashboard = readHandler((service, userId) => service.getDashboard(userId))
export const listArtists = readHandler((service, userId) => service.listArtists(userId))
export const createArtist = handler(artistSchema, (service, userId, input) => service.createArtist(userId, input))
export const listReleases = readHandler((service, userId) => service.listReleases(userId))
export const createRelease = handler(releaseSchema, (service, userId, input) => service.createRelease(userId, input))
export const getRelease = readHandler((service, userId, params) =>
  service.getRelease(userId, requiredParam(params, 'releaseId')),
)
export const updateReleaseDraft = handler(releaseDraftSchema, (service, userId, input, params) =>
  service.updateReleaseDraft(userId, requiredParam(params, 'releaseId'), input),
200)
export const createTrack = handler(trackSchema, (service, userId, input, params) =>
  service.createTrack(userId, requiredParam(params, 'releaseId'), input),
)
export const updateTrack = handler(trackDraftSchema, (service, userId, input, params) =>
  service.updateTrack(userId, requiredParam(params, 'trackId'), input),
200)
export const initiateUpload = handler(uploadInitSchema, (service, userId, input, _params, env) =>
  service.initiateUpload(userId, input, env.DOWNLOADS),
)
export const finalizeUpload = handler(uploadFinalizeSchema, (service, userId, input, _params, env) =>
  service.finalizeUpload(userId, input.assetId, env.DOWNLOADS),
200)
export const createRightsDeclaration = handler(rightsDeclarationSchema, (service, userId, input) => service.createRightsDeclaration(userId, input))
export const assignIsrc = handler(isrcAssignmentSchema, (service, userId, input, params) =>
  service.assignIsrc(userId, requiredParam(params, 'trackId'), input),
)
export const assignGeneratedIsrc = handler(generatedIsrcSchema, (service, userId, input, params, env) =>
  service.assignGeneratedIsrc(userId, requiredParam(params, 'trackId'), input, readIsrcGenerationConfig(env)),
)
export const createProduct = handler(productSchema, (service, userId, input) => service.createProduct(userId, input))
export const createPrice = handler(priceSchema, (service, userId, input, params) =>
  service.createPrice(userId, requiredParam(params, 'productId'), input),
)
export const setReleasePrice = handler(releasePriceSchema, (service, userId, input, params) =>
  service.setReleasePrice(userId, requiredParam(params, 'releaseId'), input),
)
export const setTrackPrice = handler(trackPriceSchema, (service, userId, input, params) =>
  service.setTrackPrice(userId, requiredParam(params, 'trackId'), input),
)
/** DELETE carries no body, so it skips the JSON-schema handler. */
export const clearTrackPrice = async (context: Context): Promise<Response> => {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
  try {
    const result = await new MarketplaceService(context.env.DB).clearTrackPrice(userId, requiredParam(context.params ?? {}, 'trackId'))
    return json({ok: true, data: result}, {status: 200})
  } catch (error) {
    return errorResponse(error)
  }
}
export const replaceRevenueSplits = handler(revenueSplitsSchema, (service, userId, input, params) =>
  service.replaceRevenueSplits(userId, requiredParam(params, 'trackId'), input),
)
export const transitionRelease = handler(transitionSchema, async (service, userId, input, params) =>
  service.transitionRelease(userId, requiredParam(params, 'releaseId'), input),
)
/** Submission records hashed request metadata on the immutable certification, like download events. */
export const submitRelease = async (context: Context): Promise<Response> => {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
  try {
    const input = submitReleaseSchema.parse(await readJson(context.request))
    const clientIp = getClientIp(context.request)
    const pepper = String(context.env.SESSION_PEPPER || 'dev-session-pepper')
    const meta = {
      ipHash: clientIp === 'unknown' ? null : await sha256Hex(`certification:${clientIp}:${pepper}`),
      userAgent: context.request.headers.get('user-agent'),
    }
    const data = await new MarketplaceService(context.env.DB).submitRelease(userId, requiredParam(context.params ?? {}, 'releaseId'), input, meta)
    return json({ok: true, data}, {status: 200})
  } catch (error) {
    if (error instanceof ZodError) return json({ok: false, error: 'invalid_request', issues: error.issues}, {status: 400})
    return errorResponse(error)
  }
}

function submissionHandler<Schema extends z.ZodTypeAny>(
  schema: Schema | null,
  operation: (service: ReleaseSubmissionService, userId: string, input: z.output<Schema>, params: Record<string, string | undefined>) => Promise<unknown>,
  status = 200,
) {
  return async (context: Context): Promise<Response> => {
    if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
    const userId = await getSessionUserId(context.request, context.env)
    if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
    try {
      const input = schema ? schema.parse(await readJson(context.request)) : undefined
      const data = await operation(new ReleaseSubmissionService(context.env.DB), userId, input as z.output<Schema>, context.params ?? {})
      return json({ok: true, data}, {status})
    } catch (error) {
      if (error instanceof ZodError) return json({ok: false, error: 'invalid_request', issues: error.issues}, {status: 400})
      return errorResponse(error)
    }
  }
}

export const replaceTrackCredits = submissionHandler(trackCreditsSchema, (service, userId, input, params) =>
  service.replaceTrackCredits(userId, requiredParam(params, 'trackId'), input))
export const getReleaseCertification = submissionHandler(null, (service, userId, _input, params) =>
  service.getCertification(userId, requiredParam(params, 'releaseId')))
export const saveReleaseCertification = submissionHandler(certificationDraftSchema, (service, userId, input, params) =>
  service.saveCertification(userId, requiredParam(params, 'releaseId'), input))
export const addRightsMaterial = submissionHandler(rightsMaterialSchema, (service, userId, input, params) =>
  service.addRightsMaterial(userId, requiredParam(params, 'releaseId'), input), 201)
export const deleteRightsMaterial = submissionHandler(null, (service, userId, _input, params) =>
  service.deleteRightsMaterial(userId, requiredParam(params, 'materialId')))

export const getArtistProfile = async (context: Context): Promise<Response> => {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
  try {
    return json({ok: true, data: await new ArtistProfileService(context.env.DB).getProfile(userId, requiredParam(context.params ?? {}, 'artistId'))})
  } catch (error) {
    return errorResponse(error)
  }
}

export const updateArtistProfile = async (context: Context): Promise<Response> => {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
  try {
    const input = artistProfileSchema.parse(await readJson(context.request))
    const data = await new ArtistProfileService(context.env.DB).updateProfile(userId, requiredParam(context.params ?? {}, 'artistId'), input)
    return json({ok: true, data})
  } catch (error) {
    if (error instanceof ZodError) return json({ok: false, error: 'invalid_request', issues: error.issues}, {status: 400})
    return errorResponse(error)
  }
}
