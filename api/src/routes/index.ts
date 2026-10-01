import type {RequestHandler} from 'express'
import {onRequest as accountArtist} from './account/artist'
import {onRequest as accountMe} from './account/me'
import {onRequest as accountDelete} from './account/delete'
import {onRequest as authLogin} from './auth/login'
import {onRequest as authLogout} from './auth/logout'
import {onRequest as authSetPassword} from './auth/set-password'
import {onRequest as authStart} from './auth/start'
import {onRequest as authVerifyCode} from './auth/verify-code'
import {onRequest as authVerify} from './auth/verify'
import {onRequest as billingSync} from './billing/sync'
import {onRequest as billingPortal} from './billing-portal'
import {onRequest as checkoutStatus} from './checkout-status'
import {onRequest as checkout} from './checkout'
import {onRequest as devAdminUsers} from './dev-admin/users'
import {onRequest as devAdminDeleteUser} from './dev-admin/users/[userId]'
import {onRequestGet as downloadFullProgram} from './download/full-program'
import {onRequest as entitlements} from './entitlements'
import {
  assignIsrc,
  assignGeneratedIsrc,
  createArtist,
  createPrice,
  createProduct,
  createProvider,
  createRelease,
  createRightsDeclaration,
  createTrack,
  getDashboard,
  getRelease,
  initiateUpload,
  listArtists,
  listReleases,
  replaceRevenueSplits,
  submitRelease,
  transitionRelease,
  updateReleaseDraft,
  updateTrack,
  finalizeUpload,
} from './marketplace'
import {commandProvider as marketplaceAdminCommandProvider, commandRelease as marketplaceAdminCommandRelease, getOverview as marketplaceAdminOverview, recordSplitDispute, replaceDiscoveryFeatures, retryProviderPayouts} from './marketplace-admin'
import {createIndustryReportingBatch, createIndustryReportingCorrection, exportIndustryReportingBatch, getIndustryReporting, resolveIndustryReportingBatch, submitIndustryReportingBatch, validateIndustryReporting} from './marketplace-admin/reporting'
import {onRequest as stripeWebhook} from './stripe-webhook'
import {getCatalogAsset, getCatalogRelease, listCatalog, recordCatalogPreview} from './store'
import {createConnectDashboard, createConnectOnboarding, getConnectStatus} from './marketplace/connect'
import {getProviderReporting, getRecipientEarnings} from './marketplace/reporting'
import {createStoreCheckout, downloadStorePurchase, getStoreOrderStatus, listStorePurchases} from './store/commerce'
import {getMusicDiscovery} from './music'
import {CLIENT_IP_HEADER} from './_security'
import {assignTrackIsrc, exportIsrcRecords, getIsrcRecord, getIsrcSequence, listIsrcRecords, registerExistingIsrc} from './isrc'

export type RouteHandler = (context: any) => Promise<Response> | Response

export const routes: Array<{method: string; path: string; handler: RouteHandler}> = [
  {method: 'post', path: '/api/account/artist', handler: accountArtist},
  {method: 'get', path: '/api/account/me', handler: accountMe},
  {method: 'delete', path: '/api/account', handler: accountDelete},
  {method: 'post', path: '/api/auth/login', handler: authLogin},
  {method: 'post', path: '/api/auth/logout', handler: authLogout},
  {method: 'post', path: '/api/auth/set-password', handler: authSetPassword},
  {method: 'post', path: '/api/auth/start', handler: authStart},
  {method: 'post', path: '/api/auth/verify-code', handler: authVerifyCode},
  {method: 'post', path: '/api/auth/verify', handler: authVerify},
  {method: 'post', path: '/api/billing/sync', handler: billingSync},
  {method: 'post', path: '/api/billing-portal', handler: billingPortal},
  {method: 'get', path: '/api/checkout-status', handler: checkoutStatus},
  {method: 'post', path: '/api/checkout', handler: checkout},
  {method: 'get', path: '/api/dev-admin/users', handler: devAdminUsers},
  {method: 'delete', path: '/api/dev-admin/users/:userId', handler: devAdminDeleteUser},
  {method: 'get', path: '/api/download/full-program', handler: downloadFullProgram},
  {method: 'get', path: '/api/entitlements', handler: entitlements},
  {method: 'get', path: '/api/music/discovery', handler: getMusicDiscovery},
  {method: 'get', path: '/api/store/releases', handler: listCatalog},
  {method: 'get', path: '/api/store/releases/:releaseId', handler: getCatalogRelease},
  {method: 'get', path: '/api/store/assets/:assetId', handler: getCatalogAsset},
  {method: 'post', path: '/api/store/previews', handler: recordCatalogPreview},
  {method: 'post', path: '/api/store/checkout', handler: createStoreCheckout},
  {method: 'get', path: '/api/store/orders/by-session/:sessionId', handler: getStoreOrderStatus},
  {method: 'get', path: '/api/store/purchases', handler: listStorePurchases},
  {method: 'get', path: '/api/store/purchases/:entitlementId/files/:fileId/download', handler: downloadStorePurchase},
  {method: 'get', path: '/api/marketplace/connect', handler: getConnectStatus},
  {method: 'post', path: '/api/marketplace/connect/onboarding', handler: createConnectOnboarding},
  {method: 'post', path: '/api/marketplace/connect/dashboard', handler: createConnectDashboard},
  {method: 'get', path: '/api/marketplace/reporting', handler: getProviderReporting},
  {method: 'get', path: '/api/marketplace/recipient-earnings', handler: getRecipientEarnings},
  {method: 'post', path: '/api/marketplace/providers', handler: createProvider},
  {method: 'get', path: '/api/marketplace/dashboard', handler: getDashboard},
  {method: 'get', path: '/api/marketplace/artists', handler: listArtists},
  {method: 'post', path: '/api/marketplace/artists', handler: createArtist},
  {method: 'get', path: '/api/marketplace/releases', handler: listReleases},
  {method: 'post', path: '/api/marketplace/releases', handler: createRelease},
  {method: 'get', path: '/api/marketplace/releases/:releaseId', handler: getRelease},
  {method: 'patch', path: '/api/marketplace/releases/:releaseId', handler: updateReleaseDraft},
  {method: 'post', path: '/api/marketplace/releases/:releaseId/tracks', handler: createTrack},
  {method: 'patch', path: '/api/marketplace/tracks/:trackId', handler: updateTrack},
  {method: 'post', path: '/api/marketplace/uploads', handler: initiateUpload},
  {method: 'post', path: '/api/marketplace/uploads/finalize', handler: finalizeUpload},
  {method: 'post', path: '/api/marketplace/rights-declarations', handler: createRightsDeclaration},
  {method: 'post', path: '/api/marketplace/tracks/:trackId/isrc-assignments', handler: assignIsrc},
  {method: 'post', path: '/api/marketplace/tracks/:trackId/isrc-assignments/generated', handler: assignGeneratedIsrc},
  {method: 'post', path: '/api/marketplace/products', handler: createProduct},
  {method: 'post', path: '/api/marketplace/products/:productId/prices', handler: createPrice},
  {method: 'put', path: '/api/marketplace/tracks/:trackId/revenue-splits', handler: replaceRevenueSplits},
  {method: 'post', path: '/api/marketplace/releases/:releaseId/submit', handler: submitRelease},
  {method: 'post', path: '/api/marketplace/releases/:releaseId/transitions', handler: transitionRelease},
  {method: 'get', path: '/api/isrc/sequence', handler: getIsrcSequence},
  {method: 'get', path: '/api/isrc/export', handler: exportIsrcRecords},
  {method: 'get', path: '/api/isrc/:id', handler: getIsrcRecord},
  {method: 'get', path: '/api/isrc', handler: listIsrcRecords},
  {method: 'post', path: '/api/tracks/:trackId/isrc/assign', handler: assignTrackIsrc},
  {method: 'post', path: '/api/tracks/:trackId/isrc/existing', handler: registerExistingIsrc},
  {method: 'post', path: '/api/marketplace-admin/releases/:releaseId/commands', handler: marketplaceAdminCommandRelease},
  {method: 'post', path: '/api/marketplace-admin/providers/:providerId/commands', handler: marketplaceAdminCommandProvider},
  {method: 'post', path: '/api/marketplace-admin/split-disputes', handler: recordSplitDispute},
  {method: 'post', path: '/api/marketplace-admin/payouts/retry', handler: retryProviderPayouts},
  {method: 'get', path: '/api/marketplace-admin/overview', handler: marketplaceAdminOverview},
  {method: 'put', path: '/api/marketplace-admin/discovery/features', handler: replaceDiscoveryFeatures},
  {method: 'get', path: '/api/marketplace-admin/reporting', handler: getIndustryReporting},
  {method: 'post', path: '/api/marketplace-admin/reporting/validate', handler: validateIndustryReporting},
  {method: 'post', path: '/api/marketplace-admin/reporting/batches', handler: createIndustryReportingBatch},
  {method: 'get', path: '/api/marketplace-admin/reporting/batches/:batchId/export', handler: exportIndustryReportingBatch},
  {method: 'post', path: '/api/marketplace-admin/reporting/batches/:batchId/submit', handler: submitIndustryReportingBatch},
  {method: 'post', path: '/api/marketplace-admin/reporting/batches/:batchId/resolve', handler: resolveIndustryReportingBatch},
  {method: 'post', path: '/api/marketplace-admin/reporting/events/:eventId/corrections', handler: createIndustryReportingCorrection},
  {method: 'post', path: '/api/stripe-webhook', handler: stripeWebhook},
]

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

let warnedMissingProxySecret = false

/**
 * Resolve the caller IP for rate limiting. The Cloudflare Pages proxy forwards the edge-verified
 * client IP alongside a shared secret; requests that don't carry the secret fall back to the
 * trusted-proxy `req.ip`.
 */
export function resolveClientIp(request: Parameters<RequestHandler>[0], env: Record<string, unknown>): string {
  const secret = typeof env.API_PROXY_SECRET === 'string' ? env.API_PROXY_SECRET.trim() : ''
  const forwarded = (request.get('x-mejay-proxy-client-ip') || '').trim()
  if (secret) {
    const presented = (request.get('x-mejay-proxy-secret') || '').trim()
    if (forwarded && presented && timingSafeEqualString(presented, secret)) return forwarded
    return request.ip || 'unknown'
  }
  if (env.NODE_ENV === 'production' && !warnedMissingProxySecret) {
    warnedMissingProxySecret = true
    console.warn('API_PROXY_SECRET is not set; rate limiting trusts the cf-connecting-ip header')
  }
  return (request.get('cf-connecting-ip') || '').trim() || request.ip || 'unknown'
}

export function adaptRoute(handler: RouteHandler, env: Record<string, unknown>): RequestHandler {
  return async (request, response, next) => {
    try {
      // Express resolves protocol from the trusted proxy hop ('trust proxy'). Never build the
      // request URL from X-Forwarded-Host: it is client-controlled.
      const protocol = request.protocol
      const host = request.get('host')
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
        else if (value !== undefined) headers.set(key, value)
      }
      headers.set(CLIENT_IP_HEADER, resolveClientIp(request, env))

      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body
      const webRequest = new Request(`${protocol}://${host}${request.originalUrl}`, {
        method: request.method,
        headers,
        body,
        duplex: body ? 'half' : undefined,
      } as RequestInit)
      const webResponse = await handler({request: webRequest, env, params: request.params})

      response.status(webResponse.status)
      webResponse.headers.forEach((value, key) => {
        if (!key.toLowerCase().startsWith('access-control-')) response.setHeader(key, value)
      })
      const responseBody = Buffer.from(await webResponse.arrayBuffer())
      response.send(responseBody)
    } catch (error) {
      next(error)
    }
  }
}