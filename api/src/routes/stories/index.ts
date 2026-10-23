import {EditorialStoryService} from '../../editorial/story-service'
import {STORY_SLUG_PATTERN} from '../../editorial/schemas'
import {MarketplaceError} from '../../marketplace/service'
import {isEditorialStorageKey} from '../../marketplace/storage-keys'
import type {PrivateBucket} from '../../services/r2'

type Context = {
  request: Request
  env: {DB?: ConstructorParameters<typeof EditorialStoryService>[0]; DOWNLOADS?: PrivateBucket}
  params?: Record<string, string | undefined>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}})
}

function failure(error: unknown): Response {
  if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, error.status)
  console.error('[stories] public request failed', error)
  return json({ok: false, error: 'server_error'}, 500)
}

function numberParam(url: URL, name: string): number | undefined {
  const value = Number(url.searchParams.get(name))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** Published stories, newest first, paginated. */
export async function listStories(context: Context): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  const url = new URL(context.request.url)
  try {
    return json({ok: true, data: await new EditorialStoryService(context.env.DB).listPublished({limit: numberParam(url, 'limit'), offset: numberParam(url, 'offset')})})
  } catch (error) {
    return failure(error)
  }
}

export async function getStoriesHome(context: Context): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  try {
    return json({ok: true, data: await new EditorialStoryService(context.env.DB).home()})
  } catch (error) {
    return failure(error)
  }
}

export async function getStory(context: Context): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  const slug = context.params?.slug?.trim().toLowerCase() ?? ''
  if (!STORY_SLUG_PATTERN.test(slug) || slug.length > 80) return json({ok: false, error: 'not_found', message: 'Story was not found'}, 404)
  try {
    return json({ok: true, data: await new EditorialStoryService(context.env.DB).getPublished(slug)})
  } catch (error) {
    return failure(error)
  }
}

/** Streams an image a published story shows. Drafts, archived stories and unused uploads 404. */
export async function getStoryMedia(context: Context): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  if (!context.env.DOWNLOADS) return json({ok: false, error: 'storage_unavailable'}, 503)
  const mediaId = context.params?.mediaId?.trim() ?? ''
  if (!mediaId) return json({ok: false, error: 'not_found'}, 404)
  try {
    const media = await new EditorialStoryService(context.env.DB).getPublicMedia(mediaId)
    if (!isEditorialStorageKey(media.storageKey)) return json({ok: false, error: 'not_found'}, 404)
    const object = await context.env.DOWNLOADS.getExact(media.storageKey)
    if (!object) return json({ok: false, error: 'not_found'}, 404)
    return new Response(object.body, {
      status: 200,
      headers: {
        'content-type': media.mimeType,
        'cache-control': 'private, max-age=300',
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
        ...(object.contentLength !== undefined ? {'content-length': String(object.contentLength)} : {}),
      },
    })
  } catch (error) {
    return failure(error)
  }
}
