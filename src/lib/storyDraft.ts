import type {StoreReleaseDetail} from './musicStoreApi'
import {staffStoryMediaPath, type AdminStory, type AdminStoryMedia, type StoryUpdateInput} from './storiesAdminApi'
import type {StoryAppearance, StoryBlock, StoryMedia, StoryTemplate, StoryView} from './storiesApi'

/** The wizard's editable copy of a story. Saved through `toUpdateInput`; previewed through `toStoryView`. */
export type StoryDraft = {
  template: StoryTemplate
  title: string
  slug: string
  teaser: string
  authorName: string
  category: string
  tags: string
  content: StoryBlock[]
  quoteText: string
  quoteAttribution: string
  sourceName: string
  sourceUrl: string
  artist: {id: string; name: string; slug: string; public: boolean} | null
  release: {id: string; title: string; public: boolean} | null
  coverMediaId: string | null
  backgroundMediaId: string | null
  appearance: StoryAppearance
  /** Alt text, caption and credit by image id. */
  mediaText: Record<string, {altText: string; caption: string; credit: string}>
  /** Gallery order (image ids). */
  gallery: string[]
}

export const TEMPLATE_INFO: Record<StoryTemplate, {name: string; description: string}> = {
  headliner: {name: 'The Headliner', description: 'A classic article: headline, cover photo, story and quote.'},
  artist_spotlight: {name: 'Artist Spotlight', description: 'A big portrait, the artist in their own words, and a gallery.'},
  release_drop: {name: 'New Release Drop', description: 'Artwork, previews and a buy link for a release on MeJay.'},
}

export function draftFromStory(story: AdminStory): StoryDraft {
  return {
    template: story.template,
    title: story.title,
    slug: story.slug,
    teaser: story.teaser ?? '',
    authorName: story.author_name ?? '',
    category: story.category ?? '',
    tags: story.tags.join(', '),
    content: story.content,
    quoteText: story.quote_text ?? '',
    quoteAttribution: story.quote_attribution ?? '',
    sourceName: story.source_name ?? '',
    sourceUrl: story.source_url ?? '',
    artist: story.linked_artist ? {id: story.linked_artist.id, name: story.linked_artist.name, slug: story.linked_artist.slug, public: story.linked_artist.public} : null,
    release: story.linked_release ? {id: story.linked_release.id, title: story.linked_release.title, public: story.linked_release.public} : null,
    coverMediaId: story.cover_media_id,
    backgroundMediaId: story.background_media_id,
    appearance: story.appearance,
    mediaText: Object.fromEntries(story.media.map((media) => [media.id, {altText: media.alt_text ?? '', caption: media.caption ?? '', credit: media.credit ?? ''}])),
    gallery: story.media.filter((media) => media.role === 'gallery').map((media) => media.id),
  }
}

const orNull = (value: string) => value.trim() || null

export function toUpdateInput(draft: StoryDraft, version: number, media: AdminStoryMedia[]): StoryUpdateInput {
  const known = new Set(media.map((item) => item.id))
  const galleryIds = draft.gallery.filter((id) => known.has(id))
  // Gallery first, in the chosen order; then every other image (order only matters for the gallery).
  const ordered = [...galleryIds, ...media.map((item) => item.id).filter((id) => !galleryIds.includes(id))]
  return {
    expectedVersion: version,
    template: draft.template,
    title: draft.title.trim(),
    slug: draft.slug.trim(),
    teaser: orNull(draft.teaser),
    authorName: orNull(draft.authorName),
    category: orNull(draft.category),
    tags: [...new Set(draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 12),
    content: draft.content.filter((block) => block.type !== 'image' || known.has(block.mediaId)),
    quoteText: orNull(draft.quoteText),
    quoteAttribution: orNull(draft.quoteAttribution),
    sourceName: orNull(draft.sourceName),
    sourceUrl: orNull(draft.sourceUrl),
    artistId: draft.artist?.id ?? null,
    releaseId: draft.release?.id ?? null,
    coverMediaId: draft.coverMediaId && known.has(draft.coverMediaId) ? draft.coverMediaId : null,
    backgroundMediaId: draft.backgroundMediaId && known.has(draft.backgroundMediaId) ? draft.backgroundMediaId : null,
    appearance: draft.appearance,
    media: ordered.map((id) => ({mediaId: id, altText: orNull(draft.mediaText[id]?.altText ?? ''), caption: orNull(draft.mediaText[id]?.caption ?? ''), credit: orNull(draft.mediaText[id]?.credit ?? '')})),
  }
}

function previewMedia(media: AdminStoryMedia | undefined, draft: StoryDraft): StoryMedia | null {
  if (!media || media.status !== 'ready') return null
  const text = draft.mediaText[media.id]
  return {id: media.id, url: staffStoryMediaPath(media.id), width: media.width, height: media.height, altText: text?.altText ?? '', caption: orNull(text?.caption ?? ''), credit: orNull(text?.credit ?? '')}
}

/** The draft as readers would see it, with staff image URLs, for the preview. */
export function toStoryView(draft: StoryDraft, media: AdminStoryMedia[], links: {release: StoreReleaseDetail | null}, publishedAt: string | null): StoryView {
  const byId = new Map(media.map((item) => [item.id, item]))
  const input = toUpdateInput(draft, 1, media)
  const inline = Object.fromEntries(input.content.flatMap((block) => {
    if (block.type !== 'image') return []
    const view = previewMedia(byId.get(block.mediaId), draft)
    return view ? [[block.mediaId, view]] : []
  }))
  return {
    slug: input.slug,
    template: input.template,
    title: input.title || 'Untitled story',
    teaser: input.teaser,
    authorName: input.authorName,
    category: input.category,
    tags: input.tags,
    content: input.content,
    quote: input.quoteText ? {text: input.quoteText, attribution: input.quoteAttribution} : null,
    source: input.sourceUrl || input.sourceName ? {name: input.sourceName, url: input.sourceUrl} : null,
    appearance: draft.appearance,
    cover: previewMedia(input.coverMediaId ? byId.get(input.coverMediaId) : undefined, draft),
    background: previewMedia(input.backgroundMediaId ? byId.get(input.backgroundMediaId) : undefined, draft),
    gallery: draft.gallery.map((id) => previewMedia(byId.get(id), draft)).filter((item): item is StoryMedia => Boolean(item)),
    inlineMedia: inline,
    publishedAt: publishedAt ?? new Date().toISOString(),
    updatedAt: null,
    artist: draft.artist?.public ? {id: draft.artist.id, name: draft.artist.name, slug: draft.artist.slug, profile_photo_asset_id: null} : null,
    release: links.release,
  }
}
