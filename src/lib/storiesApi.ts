import {apiFetch, apiUrl} from './api'
import type {StoreReleaseDetail} from './musicStoreApi'

export type StoryTemplate = 'headliner' | 'artist_spotlight' | 'release_drop'
export type StoryPalette = 'ink' | 'midnight' | 'violet' | 'teal' | 'paper'

export type StoryBlock =
  | {type: 'paragraph'; text: string}
  | {type: 'heading'; text: string}
  | {type: 'list'; items: string[]}
  | {type: 'quote'; text: string; attribution?: string}
  | {type: 'image'; mediaId: string}

export type StoryAppearance = {palette: StoryPalette; overlay: number; coverFocal: {x: number; y: number}}

/** An image as the renderer needs it. `url` is an API path; resolve it with `apiUrl`. */
export type StoryMedia = {id: string; url: string; width: number; height: number; altText: string; caption: string | null; credit: string | null}

export type StoryArtistLink = {id: string; name: string; slug: string; profile_photo_asset_id: string | null}

/** Everything the public page shows. The admin preview builds the same shape from a draft. */
export type StoryView = {
  slug: string
  template: StoryTemplate
  title: string
  teaser: string | null
  authorName: string | null
  category: string | null
  tags: string[]
  content: StoryBlock[]
  quote: {text: string; attribution: string | null} | null
  source: {name: string | null; url: string | null} | null
  appearance: StoryAppearance
  cover: StoryMedia | null
  background: StoryMedia | null
  gallery: StoryMedia[]
  inlineMedia: Record<string, StoryMedia>
  publishedAt: string | null
  updatedAt: string | null
  artist: StoryArtistLink | null
  release: StoreReleaseDetail | null
}

export type StoryCard = {
  slug: string
  template: StoryTemplate
  title: string
  teaser: string | null
  category: string | null
  publishedAt: string | null
  featured: boolean
  image: {url: string; altText: string; focal: {x: number; y: number}} | null
}

type Envelope<T> = {ok: true; data: T} | {ok: false; error: string; message?: string}

export class StoryNotFoundError extends Error {}

async function request<T>(path: string): Promise<T> {
  const response = await apiFetch(path, {cache: 'no-store'})
  const payload = await response.json().catch(() => null) as Envelope<T> | null
  if (response.status === 404) throw new StoryNotFoundError(payload && 'message' in payload ? payload.message ?? 'Story was not found' : 'Story was not found')
  if (!payload) throw new Error(`Stories request failed (${response.status})`)
  if ('error' in payload) throw new Error(payload.message || payload.error)
  if (!response.ok) throw new Error(`Stories request failed (${response.status})`)
  return payload.data
}

export function getStoriesHome(): Promise<{featured: StoryCard | null; latest: StoryCard[]}> {
  return request('/api/stories/home')
}

export function listStories(offset = 0, limit = 12): Promise<{items: StoryCard[]; total: number}> {
  return request(`/api/stories?limit=${limit}&offset=${offset}`)
}

export function getStory(slug: string): Promise<StoryView> {
  return request(`/api/stories/${encodeURIComponent(slug)}`)
}

export function storyMediaUrl(path: string): string {
  return apiUrl(path)
}
