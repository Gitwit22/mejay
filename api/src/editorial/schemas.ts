import {z} from 'zod'

/**
 * Editorial story input. Article text is stored as structured blocks, never HTML. Inline
 * formatting is limited to **bold**, *italic* and [text](https://link); links must be http(s).
 * The renderer turns blocks into React elements, so nothing a writer types is ever run as markup.
 */

export const STORY_TEMPLATES = ['headliner', 'artist_spotlight', 'release_drop'] as const
export type StoryTemplate = typeof STORY_TEMPLATES[number]
export const STORY_PALETTES = ['ink', 'midnight', 'violet', 'teal', 'paper'] as const
export const STORY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const MEDIA_ROLES = ['cover', 'background', 'gallery', 'inline'] as const
export type MediaRole = typeof MEDIA_ROLES[number]

/** The only link targets allowed in stories: absolute http(s) URLs of sane length. */
export function safeHttpUrl(value: string): string | null {
  if (value.length > 2000) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

const INLINE_LINK = /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g

/** Every [text](url) in a block must point to an http(s) URL. */
function inlineLinksAreSafe(text: string): boolean {
  for (const match of text.matchAll(INLINE_LINK)) if (!safeHttpUrl(match[2])) return false
  return true
}

const id = z.string().trim().min(1).max(128)
const inlineText = (max: number) => z.string().max(max).refine(inlineLinksAreSafe, 'Links must start with https:// or http://')
const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null).nullable().optional()

export const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('paragraph'), text: inlineText(5000)}).strict(),
  z.object({type: z.literal('heading'), text: z.string().max(200)}).strict(),
  z.object({type: z.literal('list'), items: z.array(inlineText(500)).max(30)}).strict(),
  z.object({type: z.literal('quote'), text: z.string().max(600), attribution: z.string().max(120).optional()}).strict(),
  z.object({type: z.literal('image'), mediaId: id}).strict(),
])
export type ContentBlock = z.infer<typeof contentBlockSchema>

export const appearanceSchema = z.object({
  palette: z.enum(STORY_PALETTES).default('ink'),
  /** Darkening over a background image, percent. */
  overlay: z.number().int().min(0).max(90).default(55),
  /** Cover focal point (percent), used as object-position so the crop keeps the subject. */
  coverFocal: z.object({x: z.number().min(0).max(100), y: z.number().min(0).max(100)}).default({x: 50, y: 50}),
}).strict()
export type StoryAppearance = z.infer<typeof appearanceSchema>

/** A background image never goes below this overlay, so text on top stays readable. */
export const MIN_OVERLAY_WITH_BACKGROUND = 35

export const createStorySchema = z.object({
  template: z.enum(STORY_TEMPLATES),
  title: z.string().trim().min(1).max(160),
}).strict()

export const updateStorySchema = z.object({
  expectedVersion: z.number().int().positive(),
  template: z.enum(STORY_TEMPLATES),
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().toLowerCase().max(80).regex(STORY_SLUG_PATTERN, 'Use lowercase letters, numbers and single dashes'),
  teaser: optionalText(400),
  authorName: optionalText(120),
  category: optionalText(60),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  content: z.array(contentBlockSchema).max(200).default([]),
  quoteText: optionalText(600),
  quoteAttribution: optionalText(120),
  sourceName: optionalText(120),
  sourceUrl: z.string().trim().max(2000).transform((value) => value || null).nullable().optional()
    .refine((value) => !value || Boolean(safeHttpUrl(value)), 'The source link must start with https:// or http://'),
  artistId: id.nullable().optional(),
  releaseId: id.nullable().optional(),
  coverMediaId: id.nullable().optional(),
  backgroundMediaId: id.nullable().optional(),
  appearance: appearanceSchema.default({}),
  /** Alt text, caption and credit for every uploaded image; order sets the gallery order. */
  media: z.array(z.object({
    mediaId: id,
    altText: optionalText(300),
    caption: optionalText(300),
    credit: optionalText(120),
  }).strict()).max(60).default([]),
}).strict()
export type UpdateStoryInput = z.infer<typeof updateStorySchema>

export const storyCommandSchema = z.object({
  action: z.enum(['publish', 'unpublish', 'archive', 'feature', 'unfeature']),
  expectedVersion: z.number().int().positive(),
}).strict()
export type StoryCommand = z.infer<typeof storyCommandSchema>

export const EDITORIAL_IMAGE_MAX_BYTES = 15 * 1024 * 1024
export const EDITORIAL_IMAGE_RULES: Record<MediaRole, {minWidth: number; minHeight: number}> = {
  cover: {minWidth: 1200, minHeight: 630},
  background: {minWidth: 1200, minHeight: 630},
  gallery: {minWidth: 800, minHeight: 600},
  inline: {minWidth: 800, minHeight: 600},
}

export const mediaUploadSchema = z.object({
  role: z.enum(MEDIA_ROLES),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteSize: z.number().int().positive().max(EDITORIAL_IMAGE_MAX_BYTES, 'Images can be up to 15 MB'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict().superRefine((value, context) => {
  const rule = EDITORIAL_IMAGE_RULES[value.role]
  if (value.width < rule.minWidth || value.height < rule.minHeight) {
    context.addIssue({code: z.ZodIssueCode.custom, message: `This image must be at least ${rule.minWidth} x ${rule.minHeight} pixels`})
  }
})
export type MediaUploadInput = z.infer<typeof mediaUploadSchema>

/** Slug from a title: lowercase words joined by single dashes, at most 80 characters. */
export function slugify(title: string): string {
  const slug = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72).replace(/-+$/g, '')
  return slug || 'story'
}
