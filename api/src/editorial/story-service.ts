import {MarketplaceError, type Database} from '../marketplace/service'
import {STORE_LISTED_RELEASE_SQL, StoreService} from '../marketplace/store-service'
import {artistPubliclyVisibleSql} from '../marketplace/artist-visibility'
import {EDITORIAL_STORAGE_PREFIX} from '../marketplace/storage-keys'
import {inspectUpload, isTruncatedJpegHeader} from '../marketplace/upload-validation'
import type {PrivateBucket} from '../services/r2'
import {
  EDITORIAL_IMAGE_RULES, MIN_OVERLAY_WITH_BACKGROUND, appearanceSchema, slugify,
  type ContentBlock, type MediaRole, type MediaUploadInput, type StoryCommand, type StoryTemplate, type UpdateStoryInput,
} from './schemas'

/**
 * Editorial stories for Discover. Staff with the marketplace 'admin' role write and publish them;
 * any staff member can read the admin views. Public reads only ever see published stories, and
 * only the fields and images a published story actually uses.
 */

type StoryRow = {
  id: string
  slug: string
  template: StoryTemplate
  status: 'draft' | 'published' | 'archived'
  title: string
  teaser: string | null
  author_name: string | null
  category: string | null
  tags: string[]
  content: ContentBlock[] | string
  quote_text: string | null
  quote_attribution: string | null
  source_name: string | null
  source_url: string | null
  artist_id: string | null
  release_id: string | null
  cover_media_id: string | null
  background_media_id: string | null
  appearance: unknown
  featured: boolean
  version: number
  view_count: number | string
  created_at: string | Date
  updated_at: string | Date
  published_at: string | Date | null
  archived_at: string | Date | null
}

type MediaRow = {
  id: string
  story_id: string
  role: MediaRole
  storage_key: string
  mime_type: string
  byte_size: number | string
  width: number
  height: number
  status: 'pending' | 'ready' | 'failed'
  alt_text: string | null
  caption: string | null
  credit: string | null
  position: number
}

export type PublicMedia = {id: string; url: string; width: number; height: number; altText: string; caption: string | null; credit: string | null}

const JPEG_HEADER_SCAN_BYTES = 4 * 1024 * 1024
const FEATURE_LOCK_KEY = 764_329_202
const PUBLIC_PAGE_MAX = 24

function iso(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

function parseContent(value: StoryRow['content']): ContentBlock[] {
  return typeof value === 'string' ? JSON.parse(value) : value ?? []
}

function appearanceOf(row: StoryRow) {
  const raw = typeof row.appearance === 'string' ? JSON.parse(row.appearance) : row.appearance
  const parsed = appearanceSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : appearanceSchema.parse({})
}

/** Every image a story's article body references. */
function inlineMediaIds(content: ContentBlock[]): string[] {
  return content.flatMap((block) => block.type === 'image' ? [block.mediaId] : [])
}

function hasBody(content: ContentBlock[]): boolean {
  return content.some((block) => (block.type === 'paragraph' && block.text.trim()) || (block.type === 'list' && block.items.some((item) => item.trim())))
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!value || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(max, Math.floor(value)))
}

async function requireStaff(db: Database, userId: string): Promise<'reviewer' | 'admin'> {
  const staff = await db.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1').bind(userId).first<{role: 'reviewer' | 'admin'}>()
  if (!staff) throw new MarketplaceError(403, 'marketplace_staff_required', 'Marketplace staff access is required')
  return staff.role
}

async function requireAdmin(db: Database, userId: string): Promise<void> {
  if (await requireStaff(db, userId) !== 'admin') {
    throw new MarketplaceError(403, 'marketplace_admin_required', 'Only MeJay admins can change stories')
  }
}

async function auditStory(db: Database, userId: string, storyId: string, action: string, before: unknown, after: unknown): Promise<void> {
  await db.prepare(
    `INSERT INTO marketplace_audit_events (id, provider_profile_id, actor_user_id, entity_type, entity_id, action, before_data, after_data, metadata)
     VALUES (?1, NULL, ?2, 'editorial_story', ?3, ?4, ?5, ?6, '{}'::jsonb)`,
  ).bind(crypto.randomUUID(), userId, storyId, `editorial_story.${action}`, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after)).run()
}

export class EditorialStoryService {
  constructor(private readonly database: Database) {}

  // ---- Admin ----

  async list(userId: string, filters: {status?: string; limit?: number; offset?: number} = {}): Promise<{items: unknown[]; total: number}> {
    await requireStaff(this.database, userId)
    const status = ['draft', 'published', 'archived'].includes(filters.status ?? '') ? filters.status! : ''
    const limit = clampLimit(filters.limit, 25, 100)
    const offset = Math.max(0, Math.floor(filters.offset ?? 0))
    const {results} = await this.database.prepare(
      `SELECT id, slug, template, status, title, featured, version, view_count::integer AS view_count, published_at, updated_at, cover_media_id
       FROM editorial_stories WHERE (?1 = '' OR status = ?1)
       ORDER BY featured DESC, updated_at DESC, id LIMIT ?2 OFFSET ?3`,
    ).bind(status, limit, offset).all()
    const count = await this.database.prepare(`SELECT COUNT(*)::integer AS total FROM editorial_stories WHERE (?1 = '' OR status = ?1)`).bind(status).first<{total: number}>()
    return {items: results, total: Number(count?.total ?? 0)}
  }

  async create(userId: string, input: {template: StoryTemplate; title: string}): Promise<unknown> {
    return this.database.transaction(async (db) => {
      await requireAdmin(db, userId)
      const slug = await uniqueSlug(db, slugify(input.title))
      const id = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO editorial_stories (id, slug, template, title, created_by_user_id, updated_by_user_id) VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
      ).bind(id, slug, input.template, input.title, userId).run()
      await auditStory(db, userId, id, 'created', undefined, {template: input.template, title: input.title, slug})
      return this.loadAdmin(db, id)
    })
  }

  async get(userId: string, storyId: string): Promise<unknown> {
    await requireStaff(this.database, userId)
    return this.loadAdmin(this.database, storyId)
  }

  /** Saves any step of the wizard. Drafts may be incomplete; publishing checks completeness. */
  async update(userId: string, storyId: string, input: UpdateStoryInput): Promise<unknown> {
    return this.database.transaction(async (db) => {
      await requireAdmin(db, userId)
      const story = await db.prepare('SELECT * FROM editorial_stories WHERE id = ?1 FOR UPDATE').bind(storyId).first<StoryRow>()
      if (!story) throw new MarketplaceError(404, 'not_found', 'Story was not found')
      if (story.status === 'archived') throw new MarketplaceError(409, 'story_archived', 'Restore this story to a draft before editing it.')
      if (story.version !== input.expectedVersion) {
        throw new MarketplaceError(409, 'stale_story_version', 'Someone else saved this story since you opened it. Reload to get the latest version.')
      }
      if (story.published_at && input.slug !== story.slug) {
        throw new MarketplaceError(409, 'slug_locked', 'The link of a story that has been published cannot change, so existing links keep working.')
      }
      if (input.artistId) {
        const artist = await db.prepare('SELECT id FROM artists WHERE id = ?1').bind(input.artistId).first()
        if (!artist) throw new MarketplaceError(422, 'artist_not_found', 'The linked artist no longer exists.')
      }
      if (input.releaseId) {
        const release = await db.prepare('SELECT id FROM releases WHERE id = ?1').bind(input.releaseId).first()
        if (!release) throw new MarketplaceError(422, 'release_not_found', 'The linked release no longer exists.')
      }
      const {results: media} = await db.prepare(`SELECT id, role, status FROM editorial_media WHERE story_id = ?1`).bind(storyId).all<Pick<MediaRow, 'id' | 'role' | 'status'>>()
      const ready = new Map(media.filter((row) => row.status === 'ready').map((row) => [row.id, row]))
      const requireReady = (mediaId: string | null | undefined, label: string) => {
        if (mediaId && !ready.has(mediaId)) throw new MarketplaceError(422, 'media_not_ready', `The ${label} image is still uploading or failed. Upload it again.`)
      }
      requireReady(input.coverMediaId, 'cover')
      requireReady(input.backgroundMediaId, 'background')
      for (const mediaId of inlineMediaIds(input.content)) requireReady(mediaId, 'article')
      const appearance = {
        ...input.appearance,
        overlay: input.backgroundMediaId ? Math.max(input.appearance.overlay, MIN_OVERLAY_WITH_BACKGROUND) : input.appearance.overlay,
      }
      for (const [position, entry] of input.media.entries()) {
        if (!media.some((row) => row.id === entry.mediaId)) continue
        await db.prepare(
          `UPDATE editorial_media SET alt_text = ?1, caption = ?2, credit = ?3, position = ?4 WHERE id = ?5 AND story_id = ?6`,
        ).bind(entry.altText ?? null, entry.caption ?? null, entry.credit ?? null, position, entry.mediaId, storyId).run()
      }
      const updated = await db.prepare(
        `UPDATE editorial_stories SET template = ?1, title = ?2, slug = ?3, teaser = ?4, author_name = ?5, category = ?6, tags = ?7,
           content = ?8::jsonb, quote_text = ?9, quote_attribution = ?10, source_name = ?11, source_url = ?12, artist_id = ?13,
           release_id = ?14, cover_media_id = ?15, background_media_id = ?16, appearance = ?17::jsonb,
           version = version + 1, updated_at = CURRENT_TIMESTAMP, updated_by_user_id = ?18
         WHERE id = ?19 AND version = ?20 RETURNING id`,
      ).bind(
        input.template, input.title, input.slug, input.teaser ?? null, input.authorName ?? null, input.category ?? null, input.tags,
        JSON.stringify(input.content), input.quoteText ?? null, input.quoteAttribution ?? null, input.sourceName ?? null, input.sourceUrl ?? null,
        input.artistId ?? null, input.releaseId ?? null, input.coverMediaId ?? null, input.backgroundMediaId ?? null, JSON.stringify(appearance),
        userId, storyId, input.expectedVersion,
      ).first()
      if (!updated) throw new MarketplaceError(409, 'stale_story_version', 'Someone else saved this story since you opened it. Reload to get the latest version.')
      await auditStory(db, userId, storyId, 'updated', {version: story.version, slug: story.slug, title: story.title}, {version: story.version + 1, slug: input.slug, title: input.title})
      return this.loadAdmin(db, storyId)
    })
  }

  async command(userId: string, storyId: string, command: StoryCommand): Promise<unknown> {
    return this.database.transaction(async (db) => {
      await requireAdmin(db, userId)
      if (command.action === 'feature') await db.prepare('SELECT pg_advisory_xact_lock(?1)').bind(FEATURE_LOCK_KEY).first()
      const story = await db.prepare('SELECT * FROM editorial_stories WHERE id = ?1 FOR UPDATE').bind(storyId).first<StoryRow>()
      if (!story) throw new MarketplaceError(404, 'not_found', 'Story was not found')
      if (story.version !== command.expectedVersion) {
        throw new MarketplaceError(409, 'stale_story_version', 'This story changed since you opened it. Reload to get the latest version.')
      }
      const before = {status: story.status, featured: story.featured, version: story.version}
      let set: string
      switch (command.action) {
        case 'publish': {
          if (story.status === 'published') throw new MarketplaceError(409, 'invalid_transition', 'This story is already published.')
          if (story.status === 'archived') throw new MarketplaceError(409, 'invalid_transition', 'Restore this story to a draft before publishing it.')
          const problems = await publishProblems(db, story)
          if (problems.length > 0) throw new MarketplaceError(422, 'story_incomplete', 'Finish these before publishing', problems)
          set = `status = 'published', published_at = COALESCE(published_at, CURRENT_TIMESTAMP), published_by_user_id = ?2, archived_at = NULL`
          break
        }
        case 'unpublish':
          if (story.status === 'draft') throw new MarketplaceError(409, 'invalid_transition', 'This story is already a draft.')
          set = `status = 'draft', featured = FALSE, archived_at = NULL`
          break
        case 'archive':
          if (story.status === 'archived') throw new MarketplaceError(409, 'invalid_transition', 'This story is already archived.')
          set = `status = 'archived', featured = FALSE, archived_at = CURRENT_TIMESTAMP`
          break
        case 'feature':
          if (story.status !== 'published') throw new MarketplaceError(409, 'story_not_published', 'Publish this story before featuring it.')
          // One primary feature: replace the previous one in this transaction.
          await db.prepare('UPDATE editorial_stories SET featured = FALSE, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE featured AND id <> ?1').bind(storyId).run()
          set = 'featured = TRUE'
          break
        case 'unfeature':
          set = 'featured = FALSE'
          break
      }
      const row = await db.prepare(
        `UPDATE editorial_stories SET ${set}, version = version + 1, updated_at = CURRENT_TIMESTAMP, updated_by_user_id = ?2
         WHERE id = ?1 RETURNING status, featured, version`,
      ).bind(storyId, userId).first<{status: string; featured: boolean; version: number}>()
      await auditStory(db, userId, storyId, command.action, before, row)
      return this.loadAdmin(db, storyId)
    })
  }

  /** Artists and releases to link, searched by name. Flags whether each is public right now. */
  async lookup(userId: string, kind: 'artist' | 'release', query: string): Promise<unknown[]> {
    await requireStaff(this.database, userId)
    const pattern = `%${query.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`
    if (kind === 'artist') {
      const {results} = await this.database.prepare(
        `SELECT artist.id, artist.name, artist.slug, ${artistPubliclyVisibleSql('artist', 'provider')} AS public
         FROM artists artist JOIN provider_profiles provider ON provider.id = artist.provider_profile_id
         WHERE artist.name ILIKE ?1 ORDER BY LOWER(artist.name) LIMIT 20`,
      ).bind(pattern).all()
      return results
    }
    const {results} = await this.database.prepare(
      `SELECT r.id, r.title, r.status, r.release_type, artist.name AS artist_name, (r.status = 'LIVE') AS public
       FROM releases r
       LEFT JOIN release_artists credit ON credit.release_id = r.id AND credit.is_primary = TRUE
       LEFT JOIN artists artist ON artist.id = credit.artist_id
       WHERE r.title ILIKE ?1 OR artist.name ILIKE ?1
       ORDER BY (r.status = 'LIVE') DESC, r.updated_at DESC LIMIT 20`,
    ).bind(pattern).all()
    return results
  }

  // ---- Media ----

  async initiateUpload(userId: string, storyId: string, input: MediaUploadInput, bucket: PrivateBucket | undefined): Promise<unknown> {
    if (!bucket) throw new MarketplaceError(503, 'storage_unavailable', 'Image storage is not configured')
    return this.database.transaction(async (db) => {
      await requireAdmin(db, userId)
      const story = await db.prepare('SELECT status FROM editorial_stories WHERE id = ?1').bind(storyId).first<{status: string}>()
      if (!story) throw new MarketplaceError(404, 'not_found', 'Story was not found')
      if (story.status === 'archived') throw new MarketplaceError(409, 'story_archived', 'Restore this story to a draft before adding images.')
      const id = crypto.randomUUID()
      const extension = input.mimeType === 'image/png' ? 'png' : input.mimeType === 'image/webp' ? 'webp' : 'jpg'
      const storageKey = `${EDITORIAL_STORAGE_PREFIX}${storyId}/${id}.${extension}`
      const position = await db.prepare('SELECT COALESCE(MAX(position) + 1, 0)::integer AS next FROM editorial_media WHERE story_id = ?1').bind(storyId).first<{next: number}>()
      const uploadUrl = await bucket.createUploadUrl(storageKey, input.mimeType, input.byteSize)
      const media = await db.prepare(
        `INSERT INTO editorial_media (id, story_id, role, storage_key, mime_type, byte_size, width, height, position, created_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id, story_id, role, mime_type, byte_size, width, height, status, alt_text, caption, credit, position`,
      ).bind(id, storyId, input.role, storageKey, input.mimeType, input.byteSize, input.width, input.height, position?.next ?? 0, userId).first()
      return {media, upload: {url: uploadUrl, method: 'PUT', headers: {'content-type': input.mimeType}}}
    })
  }

  /** Checks the uploaded bytes really are the declared image, at the declared size. */
  async finalizeUpload(userId: string, mediaId: string, bucket: PrivateBucket | undefined): Promise<unknown> {
    if (!bucket) throw new MarketplaceError(503, 'storage_unavailable', 'Image storage is not configured')
    try {
      return await this.database.transaction(async (db) => {
        await requireAdmin(db, userId)
        const media = await db.prepare('SELECT * FROM editorial_media WHERE id = ?1 FOR UPDATE').bind(mediaId).first<MediaRow>()
        if (!media) throw new MarketplaceError(404, 'not_found', 'Upload was not found')
        if (media.status === 'ready') return publicAdminMedia(media)
        if (media.status === 'failed') throw new MarketplaceError(409, 'upload_failed', 'This upload failed. Upload the image again.')
        const object = await bucket.head(media.storage_key)
        if (!object) throw new MarketplaceError(422, 'upload_missing', 'The image did not finish uploading. Try again.')
        if (object.byteSize !== Number(media.byte_size) || object.contentType !== media.mime_type) {
          throw new MarketplaceError(422, 'upload_mismatch', 'The uploaded file does not match the selected image.')
        }
        const head = await bucket.getExact(media.storage_key, 'bytes=0-65535')
        if (!head) throw new MarketplaceError(422, 'upload_missing', 'The image did not finish uploading. Try again.')
        let bytes = new Uint8Array(await new Response(head.body).arrayBuffer())
        if (isTruncatedJpegHeader(bytes) && Number(media.byte_size) > bytes.length) {
          const larger = await bucket.getExact(media.storage_key, `bytes=0-${Math.min(Number(media.byte_size), JPEG_HEADER_SCAN_BYTES) - 1}`)
          if (larger) bytes = new Uint8Array(await new Response(larger.body).arrayBuffer())
        }
        const problems = imageProblems(media, inspectUpload(bytes))
        if (problems.length > 0) throw new MarketplaceError(422, 'upload_validation_failed', 'The image failed validation', problems)
        const ready = await db.prepare(`UPDATE editorial_media SET status = 'ready' WHERE id = ?1 RETURNING *`).bind(mediaId).first<MediaRow>()
        return publicAdminMedia(ready!)
      })
    } catch (error) {
      if (error instanceof MarketplaceError && ['upload_validation_failed', 'upload_mismatch'].includes(error.code)) {
        await this.database.prepare(`UPDATE editorial_media SET status = 'failed' WHERE id = ?1 AND status = 'pending'`).bind(mediaId).run()
      }
      throw error
    }
  }

  /** Removes an image; covers and backgrounds pointing at it are cleared. Returns the key to delete after commit. */
  async deleteMedia(userId: string, mediaId: string): Promise<{storageKey: string}> {
    return this.database.transaction(async (db) => {
      await requireAdmin(db, userId)
      const media = await db.prepare('DELETE FROM editorial_media WHERE id = ?1 RETURNING storage_key, story_id').bind(mediaId).first<{storage_key: string; story_id: string}>()
      if (!media) throw new MarketplaceError(404, 'not_found', 'Image was not found')
      await auditStory(db, userId, media.story_id, 'media_deleted', {mediaId}, undefined)
      return {storageKey: media.storage_key}
    })
  }

  async getStaffMedia(userId: string, mediaId: string): Promise<{storageKey: string; mimeType: string}> {
    await requireStaff(this.database, userId)
    const media = await this.database.prepare(`SELECT storage_key, mime_type FROM editorial_media WHERE id = ?1 AND status = 'ready'`).bind(mediaId).first<{storage_key: string; mime_type: string}>()
    if (!media) throw new MarketplaceError(404, 'not_found', 'Image was not found')
    return {storageKey: media.storage_key, mimeType: media.mime_type}
  }

  // ---- Public ----

  async listPublished(options: {limit?: number; offset?: number} = {}): Promise<{items: unknown[]; total: number}> {
    const limit = clampLimit(options.limit, 12, PUBLIC_PAGE_MAX)
    const offset = Math.max(0, Math.floor(options.offset ?? 0))
    const {results} = await this.database.prepare(`${CARD_SELECT} WHERE s.status = 'published' ORDER BY s.published_at DESC, s.id LIMIT ?1 OFFSET ?2`).bind(limit, offset).all<CardRow>()
    const count = await this.database.prepare(`SELECT COUNT(*)::integer AS total FROM editorial_stories WHERE status = 'published'`).first<{total: number}>()
    return {items: results.map(toCard), total: Number(count?.total ?? 0)}
  }

  /** Discover: the primary featured story (or, if none, the newest) plus the next latest stories. */
  async home(): Promise<{featured: unknown | null; latest: unknown[]}> {
    const {results} = await this.database.prepare(
      `${CARD_SELECT} WHERE s.status = 'published' ORDER BY s.featured DESC, s.published_at DESC, s.id LIMIT 10`,
    ).all<CardRow>()
    const [featured, ...latest] = results.map(toCard)
    return {featured: featured ?? null, latest}
  }

  async getPublished(slug: string): Promise<unknown> {
    const story = await this.database.prepare(`SELECT * FROM editorial_stories WHERE slug = ?1 AND status = 'published'`).bind(slug).first<StoryRow>()
    if (!story) throw new MarketplaceError(404, 'not_found', 'Story was not found')
    const content = parseContent(story.content)
    const {results: media} = await this.database.prepare(
      `SELECT * FROM editorial_media WHERE story_id = ?1 AND status = 'ready' ORDER BY position, created_at`,
    ).bind(story.id).all<MediaRow>()
    const byId = new Map(media.map((row) => [row.id, row]))
    const inline = new Set(inlineMediaIds(content))
    const toPublic = (row: MediaRow | undefined): PublicMedia | null => row ? {
      id: row.id, url: `/api/stories/media/${row.id}`, width: row.width, height: row.height,
      altText: row.alt_text ?? '', caption: row.caption, credit: row.credit,
    } : null
    const artist = story.artist_id ? await this.database.prepare(
      `SELECT artist.id, artist.name, artist.slug, artist.profile_photo_asset_id
       FROM artists artist JOIN provider_profiles provider ON provider.id = artist.provider_profile_id
       WHERE artist.id = ?1 AND ${artistPubliclyVisibleSql('artist', 'provider')}`,
    ).bind(story.artist_id).first() : null
    let release: unknown = null
    if (story.release_id) {
      try {
        release = await new StoreService(this.database as never).getRelease(story.release_id)
      } catch (error) {
        // No longer listed (taken down, unpublished, deleted): the story stays, the link goes.
        if (!(error instanceof MarketplaceError && error.status === 404)) throw error
      }
    }
    return {
      slug: story.slug,
      template: story.template,
      title: story.title,
      teaser: story.teaser,
      authorName: story.author_name,
      category: story.category,
      tags: story.tags,
      content: content.filter((block) => block.type !== 'image' || byId.has(block.mediaId)),
      quote: story.quote_text ? {text: story.quote_text, attribution: story.quote_attribution} : null,
      source: story.source_url || story.source_name ? {name: story.source_name, url: story.source_url} : null,
      appearance: appearanceOf(story),
      cover: toPublic(story.cover_media_id ? byId.get(story.cover_media_id) : undefined),
      background: toPublic(story.background_media_id ? byId.get(story.background_media_id) : undefined),
      gallery: media.filter((row) => row.role === 'gallery').map((row) => toPublic(row)!),
      inlineMedia: Object.fromEntries(media.filter((row) => inline.has(row.id)).map((row) => [row.id, toPublic(row)])),
      publishedAt: iso(story.published_at),
      updatedAt: iso(story.updated_at),
      viewCount: Number(story.view_count ?? 0),
      artist,
      release,
    }
  }

  /** Counts one view of a published story and returns the new total; drafts are never counted. */
  async recordView(slug: string): Promise<number> {
    const row = await this.database.prepare(
      `UPDATE editorial_stories SET view_count = view_count + 1 WHERE slug = ?1 AND status = 'published' RETURNING view_count`,
    ).bind(slug).first<{view_count: number | string}>()
    if (!row) throw new MarketplaceError(404, 'not_found', 'Story was not found')
    return Number(row.view_count)
  }

  /** The current total without counting a view (used when a repeat visit is not counted). */
  async viewCount(slug: string): Promise<number> {
    const row = await this.database.prepare(`SELECT view_count FROM editorial_stories WHERE slug = ?1 AND status = 'published'`).bind(slug).first<{view_count: number | string}>()
    if (!row) throw new MarketplaceError(404, 'not_found', 'Story was not found')
    return Number(row.view_count)
  }

  /** Images of published stories only, and only ones the story actually shows. */
  async getPublicMedia(mediaId: string): Promise<{storageKey: string; mimeType: string}> {
    const media = await this.database.prepare(
      `SELECT media.storage_key, media.mime_type FROM editorial_media media
       JOIN editorial_stories story ON story.id = media.story_id AND story.status = 'published'
       WHERE media.id = ?1 AND media.status = 'ready' AND (
         story.cover_media_id = media.id OR story.background_media_id = media.id OR media.role = 'gallery'
         OR story.content @> jsonb_build_array(jsonb_build_object('type', 'image', 'mediaId', media.id)))`,
    ).bind(mediaId).first<{storage_key: string; mime_type: string}>()
    if (!media) throw new MarketplaceError(404, 'not_found', 'Image was not found')
    return {storageKey: media.storage_key, mimeType: media.mime_type}
  }

  private async loadAdmin(db: Database, storyId: string): Promise<unknown> {
    const story = await db.prepare('SELECT * FROM editorial_stories WHERE id = ?1').bind(storyId).first<StoryRow>()
    if (!story) throw new MarketplaceError(404, 'not_found', 'Story was not found')
    const {results: media} = await db.prepare(
      `SELECT * FROM editorial_media WHERE story_id = ?1 AND status <> 'failed' ORDER BY position, created_at`,
    ).bind(storyId).all<MediaRow>()
    const linkedArtist = story.artist_id ? await db.prepare(
      `SELECT artist.id, artist.name, artist.slug, ${artistPubliclyVisibleSql('artist', 'provider')} AS public
       FROM artists artist JOIN provider_profiles provider ON provider.id = artist.provider_profile_id WHERE artist.id = ?1`,
    ).bind(story.artist_id).first() : null
    const linkedRelease = story.release_id ? await db.prepare(
      `SELECT r.id, r.title, r.status, artist.name AS artist_name, ${STORE_LISTED_RELEASE_SQL} AS public
       FROM releases r LEFT JOIN release_artists credit ON credit.release_id = r.id AND credit.is_primary = TRUE
       LEFT JOIN artists artist ON artist.id = credit.artist_id WHERE r.id = ?1`,
    ).bind(story.release_id).first() : null
    return {
      ...story,
      linked_artist: linkedArtist,
      linked_release: linkedRelease,
      content: parseContent(story.content),
      appearance: appearanceOf(story),
      created_at: iso(story.created_at), updated_at: iso(story.updated_at), published_at: iso(story.published_at), archived_at: iso(story.archived_at),
      media: media.map(publicAdminMedia),
      publishProblems: story.status === 'archived' ? [] : await publishProblems(db, story),
    }
  }
}

type CardRow = {
  id: string; slug: string; template: StoryTemplate; title: string; teaser: string | null; category: string | null
  published_at: string | Date; featured: boolean; cover_media_id: string | null; cover_alt: string | null; appearance: unknown; release_artwork_id: string | null
}

const CARD_SELECT = `
  SELECT s.id, s.slug, s.template, s.title, s.teaser, s.category, s.published_at, s.featured, s.appearance,
    cover.id AS cover_media_id, cover.alt_text AS cover_alt,
    (SELECT asset.id FROM marketplace_assets asset JOIN releases r ON r.id = asset.release_id
      WHERE asset.release_id = s.release_id AND asset.kind = 'artwork' AND asset.processing_status = 'ready'
        AND ${STORE_LISTED_RELEASE_SQL}
      ORDER BY asset.created_at DESC LIMIT 1) AS release_artwork_id
  FROM editorial_stories s
  LEFT JOIN editorial_media cover ON cover.id = s.cover_media_id AND cover.status = 'ready'`

function toCard(row: CardRow) {
  const appearance = appearanceOf(row as unknown as StoryRow)
  return {
    slug: row.slug, template: row.template, title: row.title, teaser: row.teaser, category: row.category,
    publishedAt: iso(row.published_at), featured: row.featured,
    image: row.cover_media_id ? {url: `/api/stories/media/${row.cover_media_id}`, altText: row.cover_alt ?? '', focal: appearance.coverFocal}
      : row.release_artwork_id ? {url: `/api/store/assets/${row.release_artwork_id}`, altText: `${row.title} artwork`, focal: {x: 50, y: 50}} : null,
  }
}

function publicAdminMedia(row: MediaRow) {
  return {
    id: row.id, role: row.role, status: row.status, mime_type: row.mime_type, byte_size: Number(row.byte_size), width: row.width, height: row.height,
    alt_text: row.alt_text, caption: row.caption, credit: row.credit, position: row.position,
  }
}

function imageProblems(media: MediaRow, inspected: ReturnType<typeof inspectUpload>): string[] {
  if (!inspected || !inspected.mimeType.startsWith('image/')) return ['The file is not a JPEG, PNG or WebP image.']
  const problems: string[] = []
  if (inspected.mimeType !== media.mime_type) problems.push(`The file is a ${inspected.mimeType.replace('image/', '').toUpperCase()}, not the selected type.`)
  if (inspected.width !== media.width || inspected.height !== media.height) problems.push('The image size does not match what was selected. Choose the file again.')
  const rule = EDITORIAL_IMAGE_RULES[media.role]
  if ((inspected.width ?? 0) < rule.minWidth || (inspected.height ?? 0) < rule.minHeight) problems.push(`This image must be at least ${rule.minWidth} x ${rule.minHeight} pixels.`)
  return problems
}

async function uniqueSlug(db: Database, base: string): Promise<string> {
  for (let attempt = 1; attempt < 50; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`
    const taken = await db.prepare('SELECT 1 AS taken FROM editorial_stories WHERE slug = ?1').bind(candidate).first()
    if (!taken) return candidate
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

/** What a story still needs before it can go public. */
async function publishProblems(db: Database, story: StoryRow): Promise<string[]> {
  const problems: string[] = []
  const content = parseContent(story.content)
  if (!story.teaser?.trim()) problems.push('Add a teaser. It appears on story cards.')
  if (!hasBody(content)) problems.push('Write the article body.')
  const {results: media} = await db.prepare(`SELECT id, role, alt_text FROM editorial_media WHERE story_id = ?1 AND status = 'ready'`).bind(story.id).all<{id: string; role: MediaRole; alt_text: string | null}>()
  const byId = new Map(media.map((row) => [row.id, row]))
  const cover = story.cover_media_id ? byId.get(story.cover_media_id) : undefined
  if (!cover && !(story.template === 'release_drop' && story.release_id)) problems.push('Upload a cover image.')
  const shown = [cover, story.background_media_id ? byId.get(story.background_media_id) : undefined, ...media.filter((row) => row.role === 'gallery'),
    ...inlineMediaIds(content).map((mediaId) => byId.get(mediaId))].filter((row): row is NonNullable<typeof row> => Boolean(row))
  if (shown.some((row) => !row.alt_text?.trim())) problems.push('Describe every image (alt text) so screen-reader users know what it shows.')
  if (story.template === 'release_drop') {
    if (!story.release_id) problems.push('Choose the release this story is about.')
    else {
      const listed = await new StoreService(db as never).getRelease(story.release_id).then(() => true, () => false)
      if (!listed) problems.push('The linked release is not on sale on MeJay, so its page cannot be linked.')
    }
  }
  if (story.artist_id) {
    const visible = await db.prepare(
      `SELECT 1 AS visible FROM artists artist JOIN provider_profiles provider ON provider.id = artist.provider_profile_id
       WHERE artist.id = ?1 AND ${artistPubliclyVisibleSql('artist', 'provider')}`,
    ).bind(story.artist_id).first()
    if (!visible) problems.push('The linked artist does not have a public page yet. Remove the link or wait until they do.')
  }
  return problems
}
