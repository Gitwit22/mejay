import {ZodError} from 'zod'

import {MarketplaceReportingService} from '../../marketplace/reporting-service'
import {reportingRangeSchema} from '../../marketplace/reporting-schemas'
import {MarketplaceError} from '../../marketplace/service'
import {getSessionUserId, type EnvWithDb} from '../_auth'

type Context = {request: Request; env: EnvWithDb}

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

function reportingHandler(operation: (service: MarketplaceReportingService, userId: string, range: ReturnType<typeof reportingRangeSchema.parse>) => Promise<unknown>) {
  return async ({request, env}: Context): Promise<Response> => {
    if (!env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
    const userId = await getSessionUserId(request, env)
    if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
    try {
      const range = reportingRangeSchema.parse(new URL(request.url).searchParams.get('range') ?? undefined)
      const data = await operation(new MarketplaceReportingService(env.DB), userId, range)
      return json({ok: true, data})
    } catch (error) {
      if (error instanceof ZodError) return json({ok: false, error: 'invalid_range', issues: error.issues}, {status: 400})
      if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, {status: error.status})
      const errorId = crypto.randomUUID()
      console.error('[marketplace-reporting] request failed', {errorId, error})
      return json({ok: false, error: 'server_error', errorId}, {status: 500})
    }
  }
}

export const getProviderReporting = reportingHandler((service, userId, range) => service.getProviderReport(userId, range))
export const getRecipientEarnings = reportingHandler((service, userId, range) => service.getRecipientReport(userId, range))
