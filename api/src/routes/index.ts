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
  createArtist,
  createAsset,
  createPrice,
  createProduct,
  createProvider,
  createRelease,
  createRightsDeclaration,
  createTrack,
  getDashboard,
  listArtists,
  listReleases,
  replaceRevenueSplits,
  transitionRelease,
} from './marketplace'
import {onRequest as stripeWebhook} from './stripe-webhook'

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
  {method: 'post', path: '/api/marketplace/providers', handler: createProvider},
  {method: 'get', path: '/api/marketplace/dashboard', handler: getDashboard},
  {method: 'get', path: '/api/marketplace/artists', handler: listArtists},
  {method: 'post', path: '/api/marketplace/artists', handler: createArtist},
  {method: 'get', path: '/api/marketplace/releases', handler: listReleases},
  {method: 'post', path: '/api/marketplace/releases', handler: createRelease},
  {method: 'post', path: '/api/marketplace/releases/:releaseId/tracks', handler: createTrack},
  {method: 'post', path: '/api/marketplace/assets', handler: createAsset},
  {method: 'post', path: '/api/marketplace/rights-declarations', handler: createRightsDeclaration},
  {method: 'post', path: '/api/marketplace/tracks/:trackId/isrc-assignments', handler: assignIsrc},
  {method: 'post', path: '/api/marketplace/products', handler: createProduct},
  {method: 'post', path: '/api/marketplace/products/:productId/prices', handler: createPrice},
  {method: 'put', path: '/api/marketplace/tracks/:trackId/revenue-splits', handler: replaceRevenueSplits},
  {method: 'post', path: '/api/marketplace/releases/:releaseId/transitions', handler: transitionRelease},
  {method: 'post', path: '/api/stripe-webhook', handler: stripeWebhook},
]

export function adaptRoute(handler: RouteHandler, env: Record<string, unknown>): RequestHandler {
  return async (request, response, next) => {
    try {
      const protocol = request.get('x-forwarded-proto') || request.protocol
      const host = request.get('x-forwarded-host') || request.get('host')
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
        else if (value !== undefined) headers.set(key, value)
      }

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