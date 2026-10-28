import {ZodError} from 'zod'

import {EditorialStoryService} from '../../editorial/story-service'
import {createStorySchema, mediaUploadSchema, storyCommandSchema, updateStorySchema} from '../../editorial/schemas'
import {MarketplaceError} from '../../marketplace/service'
import {isEditorialStorageKey} from '../../marketplace/storage-keys'
import type {PrivateBucket} from '../../services/r2'
import {getSessionUserId, readJson, type EnvWithDb} from '../_auth'

type StoryEnv = EnvWithDb & {DOWNLOADS?: PrivateBucket}
type StoryContext = {request: Request; env: StoryEnv; params: Record<string, string | undefined>}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}})
}

/** Staff story endpoints: session, error mapping and the service; the service enforces roles. */
async function storyRoute(context: StoryContext, run: (service: EditorialStoryService, userId: string) => Promise<unknown>, status = 200): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, 401)
  try {
    return json({ok: true, data: await run(new EditorialStoryService(context.env.DB), userId)}, status)
  } catch (error) {
    if (error instanceof ZodError) return json({ok: false, error: 'invalid_request', message: error.issues[0]?.message, issues: error.issues}, 400)
    if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message, details: error.details}, error.status)
    const database = error as {code?: string; constraint?: string}
    if (database?.code === '23505' && database.constraint === 'editorial_stories_slug_key') {
      return json({ok: false, error: 'slug_taken', message: 'Another story already uses this link. Choose a different one.'}, 409)
    }
    if (database?.code === '23505') return json({ok: false, error: 'conflict', message: 'This change conflicts with another one. Reload and try again.'}, 409)
    console.error('[marketplace-admin] story request failed', error)
    return json({ok: false, error: 'server_error'}, 500)
  }
}

const param = (context: StoryContext, name: string) => context.params[name]?.trim() ?? ''

export const listAdminStories = (context: StoryContext) => storyRoute(context, (service, userId) => {
  const url = new URL(context.request.url)
  return service.list(userId, {status: url.searchParams.get('status') ?? undefined, limit: Number(url.searchParams.get('limit')) || undefined, offset: Number(url.searchParams.get('offset')) || undefined})
})
export const createAdminStory = (context: StoryContext) => storyRoute(context, async (service, userId) =>
  service.create(userId, createStorySchema.parse(await readJson(context.request))), 201)
export const getAdminStory = (context: StoryContext) => storyRoute(context, (service, userId) => service.get(userId, param(context, 'storyId')))
export const updateAdminStory = (context: StoryContext) => storyRoute(context, async (service, userId) =>
  service.update(userId, param(context, 'storyId'), updateStorySchema.parse(await readJson(context.request))))
export const commandAdminStory = (context: StoryContext) => storyRoute(context, async (service, userId) =>
  service.command(userId, param(context, 'storyId'), storyCommandSchema.parse(await readJson(context.request))))
export const lookupStoryLinks = (context: StoryContext) => storyRoute(context, (service, userId) => {
  const url = new URL(context.request.url)
  return service.lookup(userId, url.searchParams.get('kind') === 'release' ? 'release' : 'artist', (url.searchParams.get('q') ?? '').slice(0, 80))
})
export const initiateStoryUpload = (context: StoryContext) => storyRoute(context, async (service, userId) =>
  service.initiateUpload(userId, param(context, 'storyId'), mediaUploadSchema.parse(await readJson(context.request)), context.env.DOWNLOADS), 201)
export const finalizeStoryUpload = (context: StoryContext) => storyRoute(context, (service, userId) =>
  service.finalizeUpload(userId, param(context, 'mediaId'), context.env.DOWNLOADS))
export const deleteStoryMedia = (context: StoryContext) => storyRoute(context, async (service, userId) => {
  const {storageKey} = await service.deleteMedia(userId, param(context, 'mediaId'))
  // Best effort after commit: the row is gone, so a leftover object is unreachable.
  if (context.env.DOWNLOADS && isEditorialStorageKey(storageKey)) {
    await context.env.DOWNLOADS.delete(storageKey).catch(() => console.warn('[marketplace-admin] story image could not be removed from storage'))
  }
  return {deleted: true}
})

/** Any ready story image, for staff previews of drafts. */
export async function getStaffStoryMedia(context: StoryContext): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  if (!context.env.DOWNLOADS) return json({ok: false, error: 'storage_unavailable'}, 503)
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, 401)
  try {
    const media = await new EditorialStoryService(context.env.DB).getStaffMedia(userId, param(context, 'mediaId'))
    if (!isEditorialStorageKey(media.storageKey)) return json({ok: false, error: 'not_found'}, 404)
    const object = await context.env.DOWNLOADS.getExact(media.storageKey)
    if (!object) return json({ok: false, error: 'not_found'}, 404)
    return new Response(object.body, {
      headers: {
        'content-type': media.mimeType, 'cache-control': 'private, no-store, max-age=0', 'content-disposition': 'inline', 'x-content-type-options': 'nosniff',
        ...(object.contentLength !== undefined ? {'content-length': String(object.contentLength)} : {}),
      },
    })
  } catch (error) {
    if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, error.status)
    console.error('[marketplace-admin] story media failed', error)
    return json({ok: false, error: 'server_error'}, 500)
  }
}
