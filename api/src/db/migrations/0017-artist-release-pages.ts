import type {Migration} from './types'

/**
 * Additive only. Artist "release website" pages: an accent colour, a transparent cutout of the
 * artist, a second (story) photo, a chosen featured release, a highlight quote, and a photo gallery.
 * Existing rows are untouched; every new column is nullable. The asset kind checks are replaced
 * with supersets of the previous rules, so every existing asset still satisfies them.
 */
export const artistReleasePagesMigration: Migration = {
  version: 17,
  name: 'artist_release_pages',
  sql: `
ALTER TABLE marketplace_assets DROP CONSTRAINT marketplace_assets_kind_check;
ALTER TABLE marketplace_assets ADD CONSTRAINT marketplace_assets_kind_check
  CHECK (kind IN ('artwork', 'audio', 'artist_photo', 'artist_banner', 'artist_cutout', 'artist_gallery', 'rights_document'));
ALTER TABLE marketplace_assets DROP CONSTRAINT marketplace_assets_kind_owner_check;
ALTER TABLE marketplace_assets ADD CONSTRAINT marketplace_assets_kind_owner_check CHECK (
  (kind IN ('artwork', 'rights_document') AND release_id IS NOT NULL)
  OR (kind = 'audio' AND track_id IS NOT NULL)
  OR (kind IN ('artist_photo', 'artist_banner', 'artist_cutout', 'artist_gallery') AND artist_id IS NOT NULL)
);

ALTER TABLE artists ADD COLUMN accent_color TEXT CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-f]{6}$');
ALTER TABLE artists ADD COLUMN cutout_asset_id TEXT REFERENCES marketplace_assets(id) ON DELETE SET NULL;
ALTER TABLE artists ADD COLUMN story_photo_asset_id TEXT REFERENCES marketplace_assets(id) ON DELETE SET NULL;
ALTER TABLE artists ADD COLUMN featured_release_id TEXT REFERENCES releases(id) ON DELETE SET NULL;
ALTER TABLE artists ADD COLUMN highlight_quote TEXT CHECK (highlight_quote IS NULL OR LENGTH(highlight_quote) <= 280);

CREATE TABLE artist_gallery_images (
  id TEXT PRIMARY KEY,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL UNIQUE REFERENCES marketplace_assets(id) ON DELETE CASCADE,
  caption TEXT CHECK (caption IS NULL OR LENGTH(caption) <= 140),
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (artist_id, position)
);
`,
}
