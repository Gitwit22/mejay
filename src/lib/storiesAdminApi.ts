import {apiFetch} from './api'
import type {StoryAppearance, StoryBlock, StoryTemplate} from './storiesApi'

export type StoryStatus = 'draft' | 'published' | 'archived'
export type MediaRole = 'cover' | 'background' | 'gallery' | 'inline'

export type AdminStoryMedia = {
  id: string; role: MediaRole; status: 'pending' | 'ready'; mime_type: string; byte_size: number; width: number; height: number
  alt_text: string | null; caption: string | null; credit: string | null; position: number
}

export type AdminStory = {
  id: string
  slug: string
  template: StoryTemplate
  status: StoryStatus
  title: string
  teaser: string | null
  author_name: string | null
  category: string | null
  tags: string[]
  content: StoryBlock[]
  quote_text: string | null
  quote_attribution: string | null
  source_name: string | null
  source_url: string | null
  artist_id: string | null
  release_id: string | null
  cover_media_id: string | null
  background_media_id: string | null
  appearance: StoryAppearance
  featured: boolean
  version: number
  created_at: string
  updated_at: string
  published_at: string | null
  archived_at: string | null
  media: AdminStoryMedia[]
  linked_artist: {id: string; name: string; slug: string; public: boolean} | null
  linked_release: {id: string; title: string; status: string; artist_name: string | null; public: boolean} | null
  /** What still blocks publishing (empty when ready). */
  publishProblems: string[]
}

export type AdminStoryListItem = Pick<AdminStory, 'id' | 'slug' | 'template' | 'status' | 'title' | 'featured' | 'version' | 'published_at' | 'updated_at' | 'cover_media_id'> & {view_count?: number}

export type StoryUpdateInput = {
  expectedVersion: number
  template: StoryTemplate
  title: string
  slug: string
  teaser: string | null
  authorName: string | null
  category: string | null
  tags: string[]
  content: StoryBlock[]
  quoteText: string | null
  quoteAttribution: string | null
  sourceName: string | null
  sourceUrl: string | null
  artistId: string | null
  releaseId: string | null
  coverMediaId: string | null
  backgroundMediaId: string | null
  appearance: StoryAppearance
  media: Array<{mediaId: string; altText: string | null; caption: string | null; credit: string | null}>
}

export type StoryCommandAction = 'publish' | 'unpublish' | 'archive' | 'feature' | 'unfeature'
export type StoryLinkOption = {id: string; name?: string; title?: string; slug?: string; artist_name?: string | null; status?: string; release_type?: string; public: boolean}

/** Error carrying the API's code and details, so the editor can keep the form and explain what failed. */
export class StoryApiError extends Error {
  constructor(message: string, readonly code: string, readonly details?: string[]) {
    super(message)
  }
}

type Envelope<T> = {ok: true; data: T} | {ok: false; error: string; message?: string; details?: unknown}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init)
  const payload = await response.json().catch(() => null) as Envelope<T> | null
  if (!payload) throw new StoryApiError(`Request failed (${response.status})`, 'network')
  if ('error' in payload) throw new StoryApiError(payload.message || payload.error, payload.error, Array.isArray(payload.details) ? payload.details.map(String) : undefined)
  if (!response.ok) throw new StoryApiError(`Request failed (${response.status})`, 'http')
  return payload.data
}

const base = '/api/marketplace-admin/stories'
const jsonInit = (method: string, body: unknown): RequestInit => ({method, headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})

export function listAdminStories(params: {status?: StoryStatus | ''; offset?: number; limit?: number} = {}): Promise<{items: AdminStoryListItem[]; total: number}> {
  const search = new URLSearchParams()
  if (params.status) search.set('status', params.status)
  search.set('limit', String(params.limit ?? 25))
  search.set('offset', String(params.offset ?? 0))
  return request(`${base}?${search}`)
}

export function createAdminStory(input: {template: StoryTemplate; title: string}): Promise<AdminStory> {
  return request(base, jsonInit('POST', input))
}

export function getAdminStory(id: string): Promise<AdminStory> {
  return request(`${base}/${encodeURIComponent(id)}`)
}

export function updateAdminStory(id: string, input: StoryUpdateInput): Promise<AdminStory> {
  return request(`${base}/${encodeURIComponent(id)}`, jsonInit('PUT', input))
}

export function commandAdminStory(id: string, action: StoryCommandAction, expectedVersion: number): Promise<AdminStory> {
  return request(`${base}/${encodeURIComponent(id)}/commands`, jsonInit('POST', {action, expectedVersion}))
}

export function lookupStoryLinks(kind: 'artist' | 'release', query: string): Promise<StoryLinkOption[]> {
  return request(`${base}/lookup?kind=${kind}&q=${encodeURIComponent(query)}`)
}

export function deleteStoryMedia(mediaId: string): Promise<unknown> {
  return request(`${base}/media/${encodeURIComponent(mediaId)}`, {method: 'DELETE'})
}

export function staffStoryMediaPath(mediaId: string): string {
  return `${base}/media/${encodeURIComponent(mediaId)}`
}

/** Signed upload: start, PUT to private storage, then the server checks the real bytes. */
export async function uploadStoryImage(storyId: string, role: MediaRole, file: File): Promise<AdminStoryMedia> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new StoryApiError('Choose a JPEG, PNG or WebP image.', 'invalid_type')
  const bitmap = await createImageBitmap(file)
  const size = {width: bitmap.width, height: bitmap.height}
  bitmap.close()
  const started = await request<{media: {id: string}; upload: {url: string; headers: Record<string, string>}}>(`${base}/${encodeURIComponent(storyId)}/media`, jsonInit('POST', {
    role, fileName: file.name, mimeType: file.type, byteSize: file.size, ...size,
  }))
  const response = await fetch(started.upload.url, {method: 'PUT', headers: started.upload.headers, body: file})
  if (!response.ok) throw new StoryApiError(`The upload did not finish (${response.status}). Try again.`, 'upload_failed')
  return request(`${base}/media/${encodeURIComponent(started.media.id)}/finalize`, {method: 'POST'})
}
