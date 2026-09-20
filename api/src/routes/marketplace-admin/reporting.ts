import {ZodError} from 'zod'

import {IndustryReportingService} from '../../marketplace/industry-reporting-service'
import {reportingBatchResolutionSchema, reportingBatchSchema, reportingCorrectionSchema, reportingDateSchema} from '../../marketplace/industry-reporting-schemas'
import {MarketplaceError} from '../../marketplace/service'
import {getSessionUserId, readJson, type EnvWithDb} from '../_auth'

type Context = {request: Request; env: EnvWithDb; params: Record<string, string | undefined>}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0', ...(init?.headers ?? {})},
  })
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function handle(operation: (service: IndustryReportingService, userId: string, context: Context) => Promise<Response>) {
  return async (context: Context): Promise<Response> => {
    if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
    const userId = await getSessionUserId(context.request, context.env)
    if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
    try {
      return await operation(new IndustryReportingService(context.env.DB), userId, context)
    } catch (error) {
      if (error instanceof ZodError) return json({ok: false, error: 'invalid_request', issues: error.issues}, {status: 400})
      if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, {status: error.status})
      const errorId = crypto.randomUUID()
      console.error('[industry-reporting] request failed', {errorId, error})
      return json({ok: false, error: 'server_error', errorId}, {status: 500})
    }
  }
}

export const getIndustryReporting = handle(async (service, userId, {request}) => {
  const reportDate = reportingDateSchema.parse(new URL(request.url).searchParams.get('date') ?? todayUtc())
  return json({ok: true, data: await service.getDashboard(userId, reportDate)})
})

export const validateIndustryReporting = handle(async (service, userId, {request}) => {
  const {reportDate} = reportingBatchSchema.parse(await readJson(request))
  return json({ok: true, data: await service.validate(userId, reportDate)})
})

export const createIndustryReportingBatch = handle(async (service, userId, {request}) => {
  const {reportDate} = reportingBatchSchema.parse(await readJson(request))
  return json({ok: true, data: await service.createBatch(userId, reportDate)}, {status: 201})
})

export const exportIndustryReportingBatch = handle(async (service, userId, {params}) => {
  const batchId = params.batchId?.trim()
  if (!batchId) return json({ok: false, error: 'missing_parameter'}, {status: 400})
  const result = await service.getExport(userId, batchId)
  return new Response(result.data, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${result.fileName}"`,
      'cache-control': 'no-store, max-age=0',
    },
  })
})

export const submitIndustryReportingBatch = handle(async (service, userId, {params}) => {
  const batchId = params.batchId?.trim()
  if (!batchId) return json({ok: false, error: 'missing_parameter'}, {status: 400})
  await service.submitBatch(userId, batchId)
  return json({ok: true})
})

export const resolveIndustryReportingBatch = handle(async (service, userId, {request, params}) => {
  const batchId = params.batchId?.trim()
  if (!batchId) return json({ok: false, error: 'missing_parameter'}, {status: 400})
  const input = reportingBatchResolutionSchema.parse(await readJson(request))
  await service.resolveBatch(userId, batchId, input.status, input.reason)
  return json({ok: true})
})

export const createIndustryReportingCorrection = handle(async (service, userId, {request, params}) => {
  const eventId = params.eventId?.trim()
  if (!eventId) return json({ok: false, error: 'missing_parameter'}, {status: 400})
  const input = reportingCorrectionSchema.parse(await readJson(request))
  return json({ok: true, data: await service.createCorrection(userId, eventId, input)}, {status: 201})
})
