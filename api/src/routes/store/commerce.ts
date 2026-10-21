import {resolvePlatformFeeBps} from '../../marketplace/commerce-money'
import {getSessionUserId, normalizeEmail, sha256Hex, verifyVerifiedToken} from '../_auth'
import {applyRateLimit, getClientIp} from '../_security'
import {claimGuestPurchases, CommerceService} from '../../marketplace/commerce-service'
import {exchangeEmailLink, hashAccessToken, resolveSessionDownload} from '../../marketplace/guest-access'
import {sendAccessRecovery} from '../../marketplace/email-jobs'
import type {OrderEmailEnv} from '../../marketplace/order-email'
import {MarketplaceError} from '../../marketplace/service'
import type {PrivateBucket} from '../../services/r2'

type Context = {
  request: Request
  env: OrderEmailEnv & {DB: any; DOWNLOADS?: PrivateBucket; STRIPE_SECRET_KEY?: string; FRONTEND_URL?: string; SESSION_PEPPER?: string; AUTH_TOKEN_SECRET?: string; MARKETPLACE_PLATFORM_FEE_BPS?: string}
  params?: Record<string, string | undefined>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}})
}

function commerceService(context: Context): CommerceService {
  const secretKey = String(context.env.STRIPE_SECRET_KEY || '').trim()
  if (!secretKey) throw new MarketplaceError(503, 'stripe_not_configured', 'Marketplace checkout is not configured')
  let feeBps: number
  try {
    feeBps = resolvePlatformFeeBps(context.env)
  } catch {
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

/** Signed-in buyers keep their account checkout; anyone else checks out as a guest. */
export async function createStoreCheckout(context: Context): Promise<Response> {
  const userId = await getSessionUserId(context.request, context.env)
  try {
    const body = await context.request.json().catch(() => null) as {productId?: unknown} | null
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : ''
    if (!productId) return json({ok: false, error: 'product_id_required'}, 400)
    // Each attempt creates a Stripe Checkout Session; cap per buyer (or per IP for guests) to stop
    // scripted session spam.
    const limit = await applyRateLimit({
      db: context.env.DB, key: userId ? `user:${userId}` : `ip:${getClientIp(context.request)}`, purpose: 'store_checkout', kind: 'create',
      maxPerWindow: userId ? 20 : 10, windowSeconds: 10 * 60, lockoutMs: 10 * 60 * 1000,
    })
    if (!limit.ok) return json({ok: false, error: 'rate_limited', message: 'Too many checkout attempts. Try again in a few minutes.'}, 429)
    const configuredOrigin = String(context.env.FRONTEND_URL || '').split(',')[0]?.trim()
    if (!configuredOrigin) throw new MarketplaceError(500, 'frontend_url_missing', 'Frontend URL is not configured')
    const data = await commerceService(context).createCheckout(userId, productId, new URL(configuredOrigin).origin)
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
    return await streamPurchasedFile(context, {...file, entitlementId, fileId, buyerUserId: auth.userId})
  } catch (error) {
    return failed(error)
  }
}

/**
 * Streams one purchased file from private storage with byte-range support, so interrupted downloads
 * resume. Shared by the signed-in and emailed-link download routes; logs a download event.
 */
async function streamPurchasedFile(context: Context, file: {storageKey: string; fileName: string; mimeType: string; entitlementId: string; fileId: string; buyerUserId: string | null}): Promise<Response> {
  const requestedRange = context.request.headers.get('range')
  const range = requestedRange && /^bytes=\d*-\d*$/.test(requestedRange) ? requestedRange : undefined
  const object = await context.env.DOWNLOADS!.getExact(file.storageKey, range)
  if (!object) return json({ok: false, error: 'not_found'}, 404)
  const clientIp = getClientIp(context.request)
  const forwardedFor = clientIp === 'unknown' ? '' : clientIp
  const pepper = String(context.env.SESSION_PEPPER || 'dev-session-pepper')
  const ipHash = forwardedFor ? await sha256Hex(`download:${forwardedFor}:${pepper}`) : null
  await context.env.DB.prepare(
    `INSERT INTO marketplace_download_events
      (id, entitlement_id, entitlement_file_id, buyer_user_id, ip_hash, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(
    crypto.randomUUID(), file.entitlementId, file.fileId, file.buyerUserId, ipHash,
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
      'referrer-policy': 'no-referrer',
      ...(object.contentLength !== undefined ? {'content-length': String(object.contentLength)} : {}),
      ...(object.contentRange ? {'content-range': object.contentRange} : {}),
    },
  })
}

/** Guest checkout return page: purchase status by Checkout Session id. Grants no download access. */
export async function getGuestOrderStatus(context: Context): Promise<Response> {
  const sessionId = context.params?.sessionId?.trim()
  if (!sessionId || !/^cs_[A-Za-z0-9_]{8,255}$/.test(sessionId)) return json({ok: false, error: 'session_id_required'}, 400)
  try {
    return json({ok: true, data: await commerceService(context).getGuestOrderStatus(sessionId)})
  } catch (error) {
    return failed(error)
  }
}

/**
 * The explicit "Download your music" action: exchanges an emailed link for a short-lived download
 * session. Repeatable while the link is valid, so interrupted downloads can be retried.
 */
export async function exchangeGuestAccess(context: Context): Promise<Response> {
  try {
    const body = await context.request.json().catch(() => null) as {token?: unknown} | null
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    const ipLimit = await applyRateLimit({db: context.env.DB, key: `ip:${getClientIp(context.request)}`, purpose: 'guest_access', kind: 'exchange', maxPerWindow: 60, windowSeconds: 10 * 60, lockoutMs: 10 * 60 * 1000})
    const tokenLimit = token ? await applyRateLimit({db: context.env.DB, key: `token:${hashAccessToken(token)}`, purpose: 'guest_access', kind: 'exchange', maxPerWindow: 30, windowSeconds: 10 * 60, lockoutMs: 10 * 60 * 1000}) : {ok: true}
    if (!ipLimit.ok || !tokenLimit.ok) return json({ok: false, error: 'rate_limited', message: 'Too many download attempts. Try again in a few minutes.'}, 429)
    return json({ok: true, data: await exchangeEmailLink(context.env.DB, token)})
  } catch (error) {
    return failed(error)
  }
}

/** Downloads one file with a download session from `exchangeGuestAccess`. Supports Range requests. */
export async function downloadGuestFile(context: Context): Promise<Response> {
  if (!context.env.DOWNLOADS) return json({ok: false, error: 'storage_unavailable'}, 503)
  const fileId = context.params?.fileId?.trim()
  const access = new URL(context.request.url).searchParams.get('access')?.trim() ?? ''
  if (!fileId) return json({ok: false, error: 'download_id_required'}, 400)
  try {
    const file = await resolveSessionDownload(context.env.DB, access, fileId)
    return await streamPurchasedFile(context, {...file, buyerUserId: null})
  } catch (error) {
    return failed(error)
  }
}

/**
 * Lost or expired link: emails new links to the purchase email only. Always answers the same way so
 * it cannot be used to learn whether an address has purchases.
 */
export async function recoverGuestAccess(context: Context): Promise<Response> {
  const accepted = json({ok: true, data: {message: 'If that email has MeJay purchases, new download links are on the way.'}})
  try {
    const body = await context.request.json().catch(() => null) as {email?: unknown} | null
    const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : ''
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return json({ok: false, error: 'invalid_email', message: 'Enter the email address you used at checkout.'}, 400)
    const ipLimit = await applyRateLimit({db: context.env.DB, key: `ip:${getClientIp(context.request)}`, purpose: 'guest_access', kind: 'recover', maxPerWindow: 5, windowSeconds: 60 * 60, lockoutMs: 60 * 60 * 1000})
    if (!ipLimit.ok) return json({ok: false, error: 'rate_limited', message: 'Too many requests. Try again later.'}, 429)
    const emailLimit = await applyRateLimit({db: context.env.DB, key: `email:${email}`, purpose: 'guest_access', kind: 'recover', maxPerWindow: 3, windowSeconds: 60 * 60, lockoutMs: 60 * 60 * 1000})
    // Over the per-email limit we still answer normally, but send nothing more.
    if (!emailLimit.ok) return accepted
    const outcome = await sendAccessRecovery(context.env.DB, context.env, email)
    if (outcome === 'failed') console.warn('[guest-access] recovery email not sent')
    return accepted
  } catch (error) {
    console.error('[guest-access] recovery failed', error instanceof Error ? error.name : 'unknown')
    return accepted
  }
}

/**
 * Links guest purchases to the signed-in account. Requires a fresh verifiedToken from the emailed
 * code flow for the account's own email, so purchases are never claimed by an unverified address.
 */
export async function claimStorePurchases(context: Context): Promise<Response> {
  const auth = await authenticated(context)
  if (auth instanceof Response) return auth
  try {
    const body = await context.request.json().catch(() => null) as {verifiedToken?: unknown} | null
    const verified = await verifyVerifiedToken({env: context.env, token: String(body?.verifiedToken ?? '')})
    if (!verified.ok) return json({ok: false, error: 'verification_required', message: 'Verify your email again to link purchases.'}, 401)
    const user = await context.env.DB.prepare('SELECT email FROM users WHERE id = ?1').bind(auth.userId).first() as {email: string} | null
    if (!user || normalizeEmail(user.email) !== verified.payload.email) {
      return json({ok: false, error: 'email_mismatch', message: 'Verify the email address on your MeJay account.'}, 403)
    }
    const claimed = await claimGuestPurchases(context.env.DB, auth.userId, verified.payload.email)
    return json({ok: true, data: {claimed}})
  } catch (error) {
    return failed(error)
  }
}
export async function getStorePurchaseArtwork(context: Context): Promise<Response> {
  const auth = await authenticated(context)
  if (auth instanceof Response) return auth
  if (!context.env.DOWNLOADS) return json({ok: false, error: 'storage_unavailable'}, 503)
  const entitlementId = context.params?.entitlementId?.trim()
  if (!entitlementId) return json({ok: false, error: 'entitlement_id_required'}, 400)
  try {
    const artwork = await commerceService(context).getPurchaseArtwork(auth.userId, entitlementId)
    const object = await context.env.DOWNLOADS.getExact(artwork.storageKey)
    if (!object) return json({ok: false, error: 'not_found'}, 404)
    return new Response(object.body, {
      status: 200,
      headers: {
        'content-type': artwork.mimeType,
        'cache-control': 'private, max-age=3600',
        'content-disposition': 'inline',
        ...(object.contentLength !== undefined ? {'content-length': String(object.contentLength)} : {}),
      },
    })
  } catch (error) {
    return failed(error)
  }
}
