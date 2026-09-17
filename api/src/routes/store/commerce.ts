import {getSessionUserId, sha256Hex} from '../_auth'
import {CommerceService} from '../../marketplace/commerce-service'
import {MarketplaceError} from '../../marketplace/service'
import type {PrivateBucket} from '../../services/r2'

type Context = {
  request: Request
  env: {DB: any; DOWNLOADS?: PrivateBucket; STRIPE_SECRET_KEY?: string; FRONTEND_URL?: string; SESSION_PEPPER?: string; MARKETPLACE_PLATFORM_FEE_BPS?: string}
  params?: Record<string, string | undefined>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}})
}

function commerceService(context: Context): CommerceService {
  const secretKey = String(context.env.STRIPE_SECRET_KEY || '').trim()
  if (!secretKey) throw new MarketplaceError(503, 'stripe_not_configured', 'Marketplace checkout is not configured')
  const feeBps = Number(context.env.MARKETPLACE_PLATFORM_FEE_BPS || 1000)
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
    throw new MarketplaceError(500, 'platform_fee_invalid', 'Marketplace platform fee configuration is invalid')
  }
  return new CommerceService(context.env.DB, secretKey, feeBps)
}

async function authenticated(context: Context): Promise<{userId: string} | Response> {
  const userId = await getSessionUserId(context.request, context.env)
  return userId ? {userId} : json({ok: false, error: 'unauthorized', message: 'Login required'}, 401)
}

function failed(error: unknown): Response {
  if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, error.status)
  console.error('[store-commerce] Request failed', error)
  return json({ok: false, error: 'server_error'}, 500)
}

export async function createStoreCheckout(context: Context): Promise<Response> {
  const auth = await authenticated(context)
  if (auth instanceof Response) return auth
  try {
    const body = await context.request.json().catch(() => null) as {productId?: unknown} | null
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : ''
    if (!productId) return json({ok: false, error: 'product_id_required'}, 400)
    const configuredOrigin = String(context.env.FRONTEND_URL || '').split(',')[0]?.trim()
    if (!configuredOrigin) throw new MarketplaceError(500, 'frontend_url_missing', 'Frontend URL is not configured')
    const data = await commerceService(context).createCheckout(auth.userId, productId, new URL(configuredOrigin).origin)
    return json({ok: true, data})
  } catch (error) {
    return failed(error)
  }
}

export async function getStoreOrderStatus(context: Context): Promise<Response> {
  const auth = await authenticated(context)
  if (auth instanceof Response) return auth
  const sessionId = context.params?.sessionId?.trim()
  if (!sessionId) return json({ok: false, error: 'session_id_required'}, 400)
  try {
    return json({ok: true, data: await commerceService(context).getOrderStatus(auth.userId, sessionId)})
  } catch (error) {
    return failed(error)
  }
}

export async function listStorePurchases(context: Context): Promise<Response> {
  const auth = await authenticated(context)
  if (auth instanceof Response) return auth
  try {
    return json({ok: true, data: await commerceService(context).listPurchases(auth.userId)})
  } catch (error) {
    return failed(error)
  }
}

export async function downloadStorePurchase(context: Context): Promise<Response> {
  const auth = await authenticated(context)
  if (auth instanceof Response) return auth
  if (!context.env.DOWNLOADS) return json({ok: false, error: 'storage_unavailable'}, 503)
  const entitlementId = context.params?.entitlementId?.trim()
  const fileId = context.params?.fileId?.trim()
  if (!entitlementId || !fileId) return json({ok: false, error: 'download_id_required'}, 400)
  try {
    const file = await commerceService(context).getDownload(auth.userId, entitlementId, fileId)
    const requestedRange = context.request.headers.get('range')
    const range = requestedRange && /^bytes=\d*-\d*$/.test(requestedRange) ? requestedRange : undefined
    const object = await context.env.DOWNLOADS.getExact(file.storageKey, range)
    if (!object) return json({ok: false, error: 'not_found'}, 404)
    const forwardedFor = context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || ''
    const pepper = String(context.env.SESSION_PEPPER || 'dev-session-pepper')
    const ipHash = forwardedFor ? await sha256Hex(`download:${forwardedFor}:${pepper}`) : null
    await context.env.DB.prepare(
      `INSERT INTO marketplace_download_events
        (id, entitlement_id, entitlement_file_id, buyer_user_id, ip_hash, user_agent)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(
      crypto.randomUUID(), entitlementId, fileId, auth.userId, ipHash,
      context.request.headers.get('user-agent')?.slice(0, 500) ?? null,
    ).run()
    const safeName = file.fileName.replace(/["\r\n]/g, '_')
    return new Response(object.body, {
      status: object.contentRange ? 206 : 200,
      headers: {
        'content-type': file.mimeType,
        'content-disposition': `attachment; filename="${safeName}"`,
        'cache-control': 'private, no-store, max-age=0',
        'accept-ranges': 'bytes',
        ...(object.contentLength !== undefined ? {'content-length': String(object.contentLength)} : {}),
        ...(object.contentRange ? {'content-range': object.contentRange} : {}),
      },
    })
  } catch (error) {
    return failed(error)
  }
}