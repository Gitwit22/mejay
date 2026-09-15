import {ZodError} from 'zod'

import {MarketplaceAdminService} from '../../marketplace/admin-service'
import {releaseAdminCommandSchema} from '../../marketplace/admin-schemas'
import {MarketplaceError} from '../../marketplace/service'
import {getSessionUserId, readJson} from '../_auth'

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {status: init?.status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}})
}

export const commandRelease = async (context: {request: Request; env: any; params: Record<string, string | undefined>}): Promise<Response> => {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
  const releaseId = context.params.releaseId?.trim()
  if (!releaseId) return json({ok: false, error: 'missing_parameter'}, {status: 400})
  try {
    const command = releaseAdminCommandSchema.parse(await readJson(context.request))
    const data = await new MarketplaceAdminService(context.env.DB).commandRelease(userId, releaseId, command)
    return json({ok: true, data})
  } catch (error) {
    if (error instanceof ZodError) return json({ok: false, error: 'invalid_request', issues: error.issues}, {status: 400})
    if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, {status: error.status})
    console.error('[marketplace-admin] request failed', error)
    return json({ok: false, error: 'server_error'}, {status: 500})
  }
}

export const getOverview = async (context: {request: Request; env: any}): Promise<Response> => {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
  try {
    const data = await new MarketplaceAdminService(context.env.DB).getOverview(userId)
    return json({ok: true, data})
  } catch (error) {
    if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, {status: error.status})
    console.error('[marketplace-admin] overview failed', error)
    return json({ok: false, error: 'server_error'}, {status: 500})
  }
}