import {z, ZodError} from 'zod'
import {MarketplaceAdminService} from '../../marketplace/admin-service'
import {readIsrcGenerationConfig} from '../../marketplace/isrc'
import {generatedIsrcSchema, isrcAssignmentSchema} from '../../marketplace/schemas'
import {MarketplaceError, MarketplaceService} from '../../marketplace/service'
import {getSessionUserId, readJson, type EnvWithDb} from '../_auth'

type Context = {
  request: Request
  env: EnvWithDb
  params: Record<string, string | undefined>
}

const existingIsrcSchema = isrcAssignmentSchema.pick({isrc: true})
const listFiltersSchema = z.object({
  isrc: z.string().trim().optional(),
  track: z.string().trim().optional(),
  artist: z.string().trim().optional(),
  provider: z.string().trim().optional(),
  year: z.coerce.number().int().min(0).max(99).optional(),
})

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

function errorResponse(error: unknown): Response {
  if (error instanceof ZodError) return json({ok: false, error: 'invalid_request', issues: error.issues}, {status: 400})
  if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message, details: error.details}, {status: error.status})
  const databaseError = error as {code?: string; constraint?: string}
  if (databaseError?.code === '23505' && ['isrc_registry_isrc_key', 'uq_isrc_assignments_active_isrc', 'uq_isrc_registry_track'].includes(databaseError.constraint ?? '')) {
    return json({ok: false, error: 'duplicate_isrc'}, {status: 409})
  }
  if (databaseError?.code === '23505') return json({ok: false, error: 'conflict'}, {status: 409})
  const errorId = crypto.randomUUID()
  console.error('[isrc] request failed', {errorId, error})
  return json({ok: false, error: 'server_error', errorId}, {status: 500})
}

async function requireUser(context: Context): Promise<string> {
  if (!context.env.DB) throw new MarketplaceError(500, 'db_not_configured', 'Database access is not configured')
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) throw new MarketplaceError(401, 'unauthorized', 'Authentication is required')
  return userId
}

function requiredParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name]?.trim()
  if (!value) throw new MarketplaceError(400, 'missing_parameter', `${name} is required`)
  return value
}

export async function listIsrcRecords(context: Context): Promise<Response> {
  try {
    const userId = await requireUser(context)
    const url = new URL(context.request.url)
    const filters = listFiltersSchema.parse(Object.fromEntries(url.searchParams.entries()))
    const data = await new MarketplaceAdminService(context.env.DB!).listIsrcRegistry(userId, filters)
    return json({ok: true, data})
  } catch (error) {
    return errorResponse(error)
  }
}

export async function getIsrcRecord(context: Context): Promise<Response> {
  try {
    const userId = await requireUser(context)
    const data = await new MarketplaceAdminService(context.env.DB!).getIsrcRecord(userId, requiredParam(context.params, 'id'))
    return json({ok: true, data})
  } catch (error) {
    return errorResponse(error)
  }
}

export async function assignTrackIsrc(context: Context): Promise<Response> {
  try {
    const userId = await requireUser(context)
    const trackId = requiredParam(context.params, 'trackId')
    const input = generatedIsrcSchema.parse(await readJson(context.request))
    const data = await new MarketplaceService(context.env.DB!).assignGeneratedIsrc(userId, trackId, input, readIsrcGenerationConfig(context.env as NodeJS.ProcessEnv))
    return json({ok: true, data}, {status: 201})
  } catch (error) {
    return errorResponse(error)
  }
}

export async function registerExistingIsrc(context: Context): Promise<Response> {
  try {
    const userId = await requireUser(context)
    const trackId = requiredParam(context.params, 'trackId')
    const input = existingIsrcSchema.parse(await readJson(context.request))
    const data = await new MarketplaceService(context.env.DB!).assignIsrc(userId, trackId, {isrc: input.isrc, source: 'provider'})
    return json({ok: true, data}, {status: 201})
  } catch (error) {
    return errorResponse(error)
  }
}

export async function getIsrcSequence(context: Context): Promise<Response> {
  try {
    const userId = await requireUser(context)
    const url = new URL(context.request.url)
    const prefix = url.searchParams.get('prefix')?.trim().toUpperCase() || 'QTA3L'
    const assignmentYearRaw = url.searchParams.get('year')
    const assignmentYear = assignmentYearRaw ? z.coerce.number().int().min(0).max(99).parse(assignmentYearRaw) : undefined
    const data = await new MarketplaceAdminService(context.env.DB!).getIsrcSequence(userId, prefix, assignmentYear)
    return json({ok: true, data})
  } catch (error) {
    return errorResponse(error)
  }
}

export async function exportIsrcRecords(context: Context): Promise<Response> {
  try {
    const userId = await requireUser(context)
    const url = new URL(context.request.url)
    const filters = listFiltersSchema.parse(Object.fromEntries(url.searchParams.entries()))
    const result = await new MarketplaceAdminService(context.env.DB!).exportIsrcRegistry(userId, filters)
    return new Response(result.data, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${result.fileName}"`,
        'cache-control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
