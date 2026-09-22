import {z, ZodError} from 'zod'
import {MarketplaceError, MarketplaceService} from '../../marketplace/service'
import {readIsrcGenerationConfig} from '../../marketplace/isrc'
import {
  artistSchema,
  assetSchema,
  isrcAssignmentSchema,
  generatedIsrcSchema,
  priceSchema,
  productSchema,
  providerSchema,
  releaseSchema,
  releaseDraftSchema,
  revenueSplitsSchema,
  rightsDeclarationSchema,
  submitReleaseSchema,
  trackSchema,
  trackDraftSchema,
  transitionSchema,
  uploadFinalizeSchema,
  uploadInitSchema,
} from '../../marketplace/schemas'
import {getSessionUserId, readJson} from '../_auth'

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
export const createAsset = handler(assetSchema, (service, userId, input) => service.createAsset(userId, input))
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
export const replaceRevenueSplits = handler(revenueSplitsSchema, (service, userId, input, params) =>
  service.replaceRevenueSplits(userId, requiredParam(params, 'trackId'), input),
)
export const transitionRelease = handler(transitionSchema, async (service, userId, input, params) =>
  service.transitionRelease(userId, requiredParam(params, 'releaseId'), input),
)
export const submitRelease = handler(submitReleaseSchema, async (service, userId, input, params) =>
  service.submitRelease(userId, requiredParam(params, 'releaseId'), input),
200)
