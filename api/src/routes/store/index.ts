import {MarketplaceError} from '../../marketplace/service'
import {previewByteLimit, resolvePreviewRange, StoreService} from '../../marketplace/store-service'
import {ArtistProfileService} from '../../marketplace/artist-profile-service'
import type {PrivateBucket} from '../../services/r2'
import {getSessionUserId, readJson} from '../_auth'
import {applyRateLimit, getClientIp} from '../_security'

type Context = {
  request: Request
  env: {DB?: ConstructorParameters<typeof StoreService>[0]; DOWNLOADS?: PrivateBucket; SESSION_PEPPER?: string}
  params?: Record<string, string | undefined>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'},
  })
}

function marketplaceError(error: unknown): Response {
  if (error instanceof MarketplaceError) {
    return json({ok: false, error: error.code, message: error.message}, error.status)
  }
  console.error('[store] public catalog request failed', error)
  return json({ok: false, error: 'server_error'}, 500)
}

export async function listCatalog(context: Context): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  try {
    return json({ok: true, data: await new StoreService(context.env.DB).listCatalog()})
  } catch (error) {
    return marketplaceError(error)
  }
}

export async function getPublicArtist(context: Context): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  const slug = context.params?.slug?.trim().toLowerCase()
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return json({ok: false, error: 'not_found'}, 404)
  try {
    return json({ok: true, data: await new ArtistProfileService(context.env.DB as never).getPublicArtist(slug)})
  } catch (error) {
    return marketplaceError(error)
  }
}

export async function getCatalogRelease(context: Context): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  const releaseId = context.params?.releaseId?.trim()
  if (!releaseId) return json({ok: false, error: 'missing_parameter'}, 400)
  try {
    return json({ok: true, data: await new StoreService(context.env.DB).getRelease(releaseId)})
  } catch (error) {
    return marketplaceError(error)
  }
}

export async function getCatalogAsset(context: Context): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  if (!context.env.DOWNLOADS) return json({ok: false, error: 'storage_unavailable'}, 503)
  const assetId = context.params?.assetId?.trim()
  if (!assetId) return json({ok: false, error: 'missing_parameter'}, 400)
  try {
    const asset = await new StoreService(context.env.DB).getAsset(assetId)
    if (!asset.mimeType.startsWith('audio/')) {
      const object = await context.env.DOWNLOADS.getExact(asset.storageKey)
      if (!object) return json({ok: false, error: 'not_found'}, 404)
      return new Response(object.body, {
        status: 200,
        headers: {
          'content-type': asset.mimeType,
          'cache-control': 'private, max-age=300',
          'content-disposition': 'inline',
          ...(object.contentLength ? {'content-length': String(object.contentLength)} : {}),
        },
      })
    }

    // Audio: only a short leading window of the master is ever served, and the browser sees it
    // as a complete file of that length so seeking/range requests stay inside the window.
    const limit = previewByteLimit(asset.byteSize, asset.durationMs)
    const range = resolvePreviewRange(context.request.headers.get('range'), limit)
    if (!range) {
      return new Response(null, {status: 416, headers: {'content-range': `bytes */${limit}`}})
    }
    const object = await context.env.DOWNLOADS.getExact(asset.storageKey, `bytes=${range.start}-${range.end}`)
    if (!object) return json({ok: false, error: 'not_found'}, 404)
    return new Response(object.body, {
      status: 206,
      headers: {
        'content-type': asset.mimeType,
        'cache-control': 'private, no-store, max-age=0',
        'content-disposition': 'inline',
        'content-length': String(range.end - range.start + 1),
        'content-range': `bytes ${range.start}-${range.end}/${limit}`,
        'accept-ranges': 'bytes',
      },
    })
  } catch (error) {
    return marketplaceError(error)
  }
}

export async function recordCatalogPreview(context: Context): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  const body = await readJson(context.request) as {assetId?: unknown}
  const assetId = typeof body.assetId === 'string' ? body.assetId.trim() : ''
  if (!assetId) return json({ok: false, error: 'invalid_request'}, 400)
  try {
    // Count at most one preview per caller per asset per 30 minutes, and cap total preview
    // events per caller, so the "Most Previewed" ranking can't be inflated by replaying requests.
    const ip = getClientIp(context.request)
    const perAsset = await applyRateLimit({db: context.env.DB, key: ip, purpose: 'store_preview', kind: assetId.slice(0, 128), maxPerWindow: 1, windowSeconds: 30 * 60, lockoutMs: 30 * 60 * 1000})
    const overall = perAsset.ok
      ? await applyRateLimit({db: context.env.DB, key: ip, purpose: 'store_preview', kind: '*', maxPerWindow: 120, windowSeconds: 60 * 60})
      : {ok: false}
    if (!perAsset.ok || !overall.ok) return json({ok: true, data: {recorded: false}}, 200)
    const userId = await getSessionUserId(context.request, context.env as never)
    await new StoreService(context.env.DB).recordPreview(assetId, userId)
    return json({ok: true, data: {recorded: true}}, 201)
  } catch (error) {
    return marketplaceError(error)
  }
}