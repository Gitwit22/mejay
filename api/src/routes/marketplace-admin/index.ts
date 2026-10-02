import {DEFAULT_PLATFORM_FEE_BPS} from '../../marketplace/commerce-money'
import {ZodError} from 'zod'

import {MarketplaceAdminService} from '../../marketplace/admin-service'
import {discoveryFeaturesSchema, providerAdminCommandSchema, releaseAdminCommandSchema, splitDisputeSchema} from '../../marketplace/admin-schemas'
import {CommerceService} from '../../marketplace/commerce-service'
import {MarketplaceError} from '../../marketplace/service'
import {getSessionUserId, readJson, type EnvWithDb} from '../_auth'

type AdminEnv = EnvWithDb & {STRIPE_SECRET_KEY?: string; MARKETPLACE_PLATFORM_FEE_BPS?: string}

function commerceFor(env: AdminEnv): CommerceService | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim()
  return secretKey ? new CommerceService(env.DB, secretKey, Number(env.MARKETPLACE_PLATFORM_FEE_BPS || DEFAULT_PLATFORM_FEE_BPS)) : null
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {status: init?.status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}})
}

export const commandRelease = async (context: {request: Request; env: EnvWithDb; params: Record<string, string | undefined>}): Promise<Response> => {
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

export const getOverview = async (context: {request: Request; env: EnvWithDb}): Promise<Response> => {
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

export const replaceDiscoveryFeatures = async (context: {request: Request; env: EnvWithDb}): Promise<Response> => {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
  try {
    const input = discoveryFeaturesSchema.parse(await readJson(context.request))
    const data = await new MarketplaceAdminService(context.env.DB).replaceDiscoveryFeatures(userId, input)
    return json({ok: true, data})
  } catch (error) {
    if (error instanceof ZodError) return json({ok: false, error: 'invalid_request', issues: error.issues}, {status: 400})
    if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, {status: error.status})
    console.error('[marketplace-admin] discovery features failed', error)
    return json({ok: false, error: 'server_error'}, {status: 500})
  }
}

export const commandProvider = async (context: {request: Request; env: AdminEnv; params: Record<string, string | undefined>}): Promise<Response> => {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
  const providerId = context.params.providerId?.trim()
  if (!providerId) return json({ok: false, error: 'missing_parameter'}, {status: 400})
  try {
    const command = providerAdminCommandSchema.parse(await readJson(context.request))
    const data = await new MarketplaceAdminService(context.env.DB).commandProvider(userId, providerId, command)
    if (command.action === 'reinstate') {
      // Pay out sales whose transfers were held while the provider was suspended.
      const payouts = await commerceFor(context.env)?.retryPendingTransfers({providerId}).catch((error) => {
        console.error('[marketplace-admin] payout retry after reinstate failed', error)
        return null
      })
      return json({ok: true, data, payouts: payouts ?? null})
    }
    return json({ok: true, data})
  } catch (error) {
    if (error instanceof ZodError) return json({ok: false, error: 'invalid_request', issues: error.issues}, {status: 400})
    if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, {status: error.status})
    console.error('[marketplace-admin] provider command failed', error)
    return json({ok: false, error: 'server_error'}, {status: 500})
  }
}

export const recordSplitDispute = async (context: {request: Request; env: EnvWithDb}): Promise<Response> => {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
  try {
    const input = splitDisputeSchema.parse(await readJson(context.request))
    const data = await new MarketplaceAdminService(context.env.DB).recordSplitDispute(userId, input)
    return json({ok: true, data}, {status: 201})
  } catch (error) {
    if (error instanceof ZodError) return json({ok: false, error: 'invalid_request', issues: error.issues}, {status: 400})
    if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, {status: error.status})
    console.error('[marketplace-admin] split dispute failed', error)
    return json({ok: false, error: 'server_error'}, {status: 500})
  }
}
export const retryProviderPayouts = async (context: {request: Request; env: AdminEnv}): Promise<Response> => {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, {status: 500})
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})
  try {
    const staff = await context.env.DB.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1').bind(userId).first() as {role?: string} | null
    if (staff?.role !== 'admin') return json({ok: false, error: 'marketplace_admin_required', message: 'Marketplace admin access is required'}, {status: 403})
    const commerce = commerceFor(context.env)
    if (!commerce) return json({ok: false, error: 'stripe_not_configured'}, {status: 503})
    const data = await commerce.retryPendingTransfers()
    return json({ok: true, data})
  } catch (error) {
    if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, {status: error.status})
    console.error('[marketplace-admin] payout retry failed', error)
    return json({ok: false, error: 'server_error'}, {status: 500})
  }
}
