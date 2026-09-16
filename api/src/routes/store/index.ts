import {MarketplaceError} from '../../marketplace/service'
import {StoreService} from '../../marketplace/store-service'
import type {PrivateBucket} from '../../services/r2'

type Context = {
  env: {DB?: ConstructorParameters<typeof StoreService>[0]; DOWNLOADS?: PrivateBucket}
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
    const audioPreview = asset.mimeType.startsWith('audio/')
    const object = await context.env.DOWNLOADS.getExact(asset.storageKey, audioPreview ? 'bytes=0-5242879' : undefined)
    if (!object) return json({ok: false, error: 'not_found'}, 404)
    return new Response(object.body, {
      status: audioPreview ? 206 : 200,
      headers: {
        'content-type': asset.mimeType,
        'cache-control': 'private, no-store, max-age=0',
        'content-disposition': 'inline',
        ...(object.contentLength ? {'content-length': String(object.contentLength)} : {}),
        ...(object.contentRange ? {'content-range': object.contentRange} : {}),
        ...(audioPreview ? {'accept-ranges': 'bytes'} : {}),
      },
    })
  } catch (error) {
    return marketplaceError(error)
  }
}