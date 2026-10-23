import type {Migration} from './types'

/**
 * Additive only. Editorial stories written by MeJay staff for Discover, with their own images.
 * Stories reference existing artists and releases (never copies of their business data) and drop
 * the reference if that record is deleted. Staff images live in editorial_media rather than
 * marketplace_assets, which is provider-owned. At most one story can be the primary feature.
 */
export const editorialStoriesMigration: Migration = {
  version: 23,
  name: 'editorial_stories',
  sql: `
CREATE TABLE editorial_stories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  template TEXT NOT NULL CHECK (template IN ('headliner', 'artist_spotlight', 'release_drop')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  title TEXT NOT NULL,
  teaser TEXT,
  author_name TEXT,
  category TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  content JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(content) = 'array'),
  quote_text TEXT,
  quote_attribution TEXT,
  source_name TEXT,
  source_url TEXT,
  artist_id TEXT REFERENCES artists(id) ON DELETE SET NULL,
  release_id TEXT REFERENCES releases(id) ON DELETE SET NULL,
  cover_media_id TEXT,
  background_media_id TEXT,
  appearance JSONB NOT NULL DEFAULT '{}'::jsonb,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  CHECK (NOT featured OR status = 'published')
);
CREATE UNIQUE INDEX uq_editorial_stories_featured ON editorial_stories ((TRUE)) WHERE featured;
CREATE INDEX idx_editorial_stories_public ON editorial_stories (status, published_at DESC);
CREATE INDEX idx_editorial_stories_admin ON editorial_stories (updated_at DESC);

CREATE TABLE editorial_media (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES editorial_stories(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('cover', 'background', 'gallery', 'inline')),
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  alt_text TEXT,
  caption TEXT,
  credit TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_editorial_media_story ON editorial_media (story_id, role, position);

ALTER TABLE editorial_stories ADD CONSTRAINT editorial_stories_cover_fk
  FOREIGN KEY (cover_media_id) REFERENCES editorial_media(id) ON DELETE SET NULL;
ALTER TABLE editorial_stories ADD CONSTRAINT editorial_stories_background_fk
  FOREIGN KEY (background_media_id) REFERENCES editorial_media(id) ON DELETE SET NULL;
`,
}
