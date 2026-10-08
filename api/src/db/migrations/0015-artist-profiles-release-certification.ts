import type {Migration} from './types'

/**
 * Additive. Public artist profiles on the existing `artists` catalog identity, structured track
 * credits, and the release rights-certification workflow. Existing statuses are unchanged; rights
 * and distribution state live in their own columns beside the release lifecycle.
 */
export const artistProfilesReleaseCertificationMigration: Migration = {
  version: 15,
  name: 'artist_profiles_release_certification',
  sql: `
-- Artist profile ------------------------------------------------------------------------------
ALTER TABLE artists ADD COLUMN slug TEXT;
ALTER TABLE artists ADD COLUMN tagline TEXT CHECK (tagline IS NULL OR LENGTH(tagline) <= 160);
ALTER TABLE artists ADD COLUMN bio TEXT CHECK (bio IS NULL OR LENGTH(bio) <= 5000);
ALTER TABLE artists ADD COLUMN location TEXT CHECK (location IS NULL OR LENGTH(location) <= 120);
ALTER TABLE artists ADD COLUMN genres TEXT[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE artists ADD COLUMN links JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE artists ADD COLUMN spotify_artist_id TEXT CHECK (spotify_artist_id IS NULL OR spotify_artist_id ~ '^[A-Za-z0-9]{22}$');
ALTER TABLE artists ADD COLUMN apple_music_artist_id TEXT CHECK (apple_music_artist_id IS NULL OR apple_music_artist_id ~ '^[0-9]{1,20}$');
ALTER TABLE artists ADD COLUMN profile_updated_at TIMESTAMPTZ;

-- Backfill URL slugs: lowercase name; a short id suffix keeps duplicates unique without guessing.
WITH base AS (
  SELECT id, created_at,
    COALESCE(NULLIF(BTRIM(LEFT(BTRIM(REGEXP_REPLACE(LOWER(name), '[^a-z0-9]+', '-', 'g'), '-'), 60), '-'), ''), 'artist') AS slug
  FROM artists
), ranked AS (
  SELECT id, slug, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at, id) AS position FROM base
)
UPDATE artists SET slug = CASE
  WHEN ranked.position = 1 THEN ranked.slug
  ELSE ranked.slug || '-' || SUBSTRING(REPLACE(artists.id, '-', '') FROM 1 FOR 6)
END
FROM ranked WHERE ranked.id = artists.id;
ALTER TABLE artists ALTER COLUMN slug SET NOT NULL;
ALTER TABLE artists ADD CONSTRAINT artists_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND LENGTH(slug) <= 80);
CREATE UNIQUE INDEX uq_artists_slug ON artists(slug);

-- Assets: artist photos/banners and private rights documents --------------------------------
ALTER TABLE marketplace_assets ADD COLUMN artist_id TEXT;
ALTER TABLE marketplace_assets ADD CONSTRAINT marketplace_assets_artist_fk
  FOREIGN KEY (provider_profile_id, artist_id) REFERENCES artists(provider_profile_id, id) ON DELETE CASCADE;
ALTER TABLE marketplace_assets DROP CONSTRAINT marketplace_assets_kind_check;
ALTER TABLE marketplace_assets DROP CONSTRAINT marketplace_assets_check;
ALTER TABLE marketplace_assets DROP CONSTRAINT marketplace_assets_check1;
ALTER TABLE marketplace_assets ADD CONSTRAINT marketplace_assets_kind_check
  CHECK (kind IN ('artwork', 'audio', 'artist_photo', 'artist_banner', 'rights_document'));
ALTER TABLE marketplace_assets ADD CONSTRAINT marketplace_assets_single_owner_check
  CHECK ((release_id IS NOT NULL)::integer + (track_id IS NOT NULL)::integer + (artist_id IS NOT NULL)::integer = 1);
ALTER TABLE marketplace_assets ADD CONSTRAINT marketplace_assets_kind_owner_check CHECK (
  (kind IN ('artwork', 'rights_document') AND release_id IS NOT NULL)
  OR (kind = 'audio' AND track_id IS NOT NULL)
  OR (kind IN ('artist_photo', 'artist_banner') AND artist_id IS NOT NULL)
);
CREATE INDEX idx_marketplace_assets_artist ON marketplace_assets(artist_id) WHERE artist_id IS NOT NULL;

ALTER TABLE artists ADD COLUMN profile_photo_asset_id TEXT REFERENCES marketplace_assets(id) ON DELETE SET NULL;
ALTER TABLE artists ADD COLUMN banner_asset_id TEXT REFERENCES marketplace_assets(id) ON DELETE SET NULL;

-- Structured credits: publisher for writers/composers (featured artists on the same account use
-- track_artists; everyone else is a named contributor).
ALTER TABLE track_contributors ADD COLUMN publisher_name TEXT CHECK (publisher_name IS NULL OR LENGTH(BTRIM(publisher_name)) > 0);

-- Release rights / distribution state ---------------------------------------------------------
ALTER TABLE releases ADD COLUMN rights_status TEXT NOT NULL DEFAULT 'NOT_CERTIFIED' CHECK (rights_status IN (
  'NOT_CERTIFIED', 'CERTIFIED_ORIGINAL', 'RIGHTS_DOCUMENTATION_ATTACHED', 'RIGHTS_REVIEW_REQUIRED',
  'RIGHTS_CLEARED', 'RIGHTS_ISSUE_FLAGGED'
));
ALTER TABLE releases ADD COLUMN third_party_material TEXT CHECK (third_party_material IS NULL OR third_party_material IN ('none', 'licensed', 'unsure'));
-- The artist's pending answers; consumed into an immutable release_certifications row on submit.
ALTER TABLE releases ADD COLUMN certification_draft JSONB;
-- Reserved for the later DSP delivery phase; MEJay marketplace only for now.
ALTER TABLE releases ADD COLUMN distribution_status TEXT NOT NULL DEFAULT 'MEJAY_EXCLUSIVE'
  CHECK (distribution_status IN ('MEJAY_EXCLUSIVE', 'DSP_SCHEDULED', 'DSP_DELIVERED'));
ALTER TABLE releases DROP CONSTRAINT releases_draft_step_check;
ALTER TABLE releases ADD CONSTRAINT releases_draft_step_check CHECK (draft_step IN (
  'release-information', 'artwork', 'tracks', 'track-metadata', 'credits', 'isrc',
  'rights', 'pricing', 'splits', 'certification', 'review'
));

CREATE TABLE release_rights_materials (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  material_type TEXT NOT NULL CHECK (material_type IN (
    'sample', 'interpolation', 'leased_beat', 'licensed_beat', 'purchased_instrumental', 'other'
  )),
  licensor_name TEXT NOT NULL CHECK (LENGTH(BTRIM(licensor_name)) > 0 AND LENGTH(licensor_name) <= 200),
  description TEXT NOT NULL CHECK (LENGTH(BTRIM(description)) > 0 AND LENGTH(description) <= 2000),
  license_type TEXT NOT NULL CHECK (license_type IN (
    'exclusive_license', 'non_exclusive_lease', 'sample_clearance', 'work_for_hire', 'producer_agreement', 'other'
  )),
  document_asset_id TEXT REFERENCES marketplace_assets(id) ON DELETE SET NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_profile_id, release_id) REFERENCES releases(provider_profile_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_release_rights_materials_release ON release_rights_materials(release_id, created_at);

-- Immutable submission evidence. certified_by_user_id / primary_artist_id are plain values, not
-- foreign keys, so deleting a user never needs to rewrite a certification.
CREATE TABLE release_certifications (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  primary_artist_id TEXT,
  certified_by_user_id TEXT NOT NULL,
  certification_version TEXT NOT NULL CHECK (LENGTH(BTRIM(certification_version)) > 0),
  accepted_certifications JSONB NOT NULL CHECK (jsonb_typeof(accepted_certifications) = 'array'),
  third_party_material TEXT NOT NULL CHECK (third_party_material IN ('none', 'licensed', 'unsure')),
  third_party_materials JSONB NOT NULL DEFAULT '[]'::jsonb,
  rights_document_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  rights_status TEXT NOT NULL,
  release_version INTEGER NOT NULL,
  release_snapshot JSONB NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  certified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_release_certifications_release ON release_certifications(release_id, certified_at DESC);

-- Never updated. Deleted only by the account-deletion transaction, which opts in explicitly.
CREATE FUNCTION prevent_release_certification_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('mejay.allow_certification_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'release certifications are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER release_certifications_immutable
BEFORE UPDATE OR DELETE ON release_certifications
FOR EACH ROW EXECUTE FUNCTION prevent_release_certification_mutation();

ALTER TABLE release_review_events DROP CONSTRAINT release_review_events_decision_check;
ALTER TABLE release_review_events ADD CONSTRAINT release_review_events_decision_check CHECK (decision IN (
  'review_started', 'approved', 'changes_requested', 'rejected',
  'restoration_requested', 'restoration_approved', 'rights_cleared', 'rights_flagged'
));
ALTER TABLE release_review_events DROP CONSTRAINT release_review_events_check;
ALTER TABLE release_review_events ADD CONSTRAINT release_review_events_check CHECK (
  (decision IN ('changes_requested', 'rejected', 'rights_cleared', 'rights_flagged') AND LENGTH(BTRIM(note)) > 0)
  OR decision NOT IN ('changes_requested', 'rejected', 'rights_cleared', 'rights_flagged')
);
`,
}
