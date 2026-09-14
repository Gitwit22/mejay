import type {Migration} from './types'

export const marketplaceFoundationMigration: Migration = {
  version: 2,
  name: 'marketplace_foundation',
  sql: `
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS bio TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_profiles_slug ON provider_profiles (LOWER(slug)) WHERE slug IS NOT NULL;
ALTER TABLE provider_members ADD CONSTRAINT provider_members_role_check CHECK (role IN ('owner', 'admin', 'editor', 'viewer'));
CREATE UNIQUE INDEX uq_provider_members_user ON provider_members(user_id);

CREATE TABLE marketplace_staff (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('reviewer', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE artists (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (LENGTH(BTRIM(name)) > 0),
  sort_name TEXT,
  country_code TEXT CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider_profile_id, id)
);
CREATE INDEX idx_artists_provider ON artists(provider_profile_id);

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (LENGTH(BTRIM(title)) > 0),
  version_title TEXT,
  release_type TEXT NOT NULL CHECK (release_type IN ('single', 'ep', 'album')),
  label_name TEXT,
  catalog_number TEXT,
  original_release_date DATE,
  scheduled_release_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE', 'PRICING_COMPLETE', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'LIVE')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider_profile_id, id),
  UNIQUE (provider_profile_id, catalog_number)
);
CREATE INDEX idx_releases_provider_status ON releases(provider_profile_id, status);

CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (LENGTH(BTRIM(title)) > 0),
  version_title TEXT,
  disc_number INTEGER NOT NULL DEFAULT 1 CHECK (disc_number > 0),
  track_number INTEGER NOT NULL CHECK (track_number > 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms > 0),
  explicit BOOLEAN NOT NULL DEFAULT FALSE,
  language_code TEXT CHECK (language_code IS NULL OR language_code ~ '^[a-z]{2,3}$'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_profile_id, release_id) REFERENCES releases(provider_profile_id, id) ON DELETE CASCADE,
  UNIQUE (provider_profile_id, id),
  UNIQUE (release_id, disc_number, track_number)
);
CREATE INDEX idx_tracks_release ON tracks(release_id, disc_number, track_number);

CREATE TABLE release_artists (
  provider_profile_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  credited_name TEXT,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'featured', 'remixer', 'producer')),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (release_id, artist_id, role),
  FOREIGN KEY (provider_profile_id, release_id) REFERENCES releases(provider_profile_id, id) ON DELETE CASCADE,
  FOREIGN KEY (provider_profile_id, artist_id) REFERENCES artists(provider_profile_id, id) ON DELETE RESTRICT
);

CREATE TABLE track_artists (
  provider_profile_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  credited_name TEXT,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'featured', 'remixer', 'producer')),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (track_id, artist_id, role),
  FOREIGN KEY (provider_profile_id, track_id) REFERENCES tracks(provider_profile_id, id) ON DELETE CASCADE,
  FOREIGN KEY (provider_profile_id, artist_id) REFERENCES artists(provider_profile_id, id) ON DELETE RESTRICT
);

CREATE TABLE marketplace_assets (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  release_id TEXT,
  track_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('artwork', 'audio')),
  storage_key TEXT NOT NULL UNIQUE,
  public_url TEXT,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  processing_status TEXT NOT NULL DEFAULT 'ready' CHECK (processing_status IN ('pending', 'ready', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_profile_id, release_id) REFERENCES releases(provider_profile_id, id) ON DELETE CASCADE,
  FOREIGN KEY (provider_profile_id, track_id) REFERENCES tracks(provider_profile_id, id) ON DELETE CASCADE,
  CHECK ((release_id IS NOT NULL)::integer + (track_id IS NOT NULL)::integer = 1),
  CHECK ((kind = 'artwork' AND release_id IS NOT NULL) OR (kind = 'audio' AND track_id IS NOT NULL))
);
CREATE INDEX idx_marketplace_assets_release ON marketplace_assets(release_id) WHERE release_id IS NOT NULL;
CREATE INDEX idx_marketplace_assets_track ON marketplace_assets(track_id) WHERE track_id IS NOT NULL;

CREATE TABLE rights_declarations (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  release_id TEXT,
  track_id TEXT,
  declaration_type TEXT NOT NULL CHECK (declaration_type IN ('distribution', 'master', 'composition')),
  rights_holder TEXT NOT NULL CHECK (LENGTH(BTRIM(rights_holder)) > 0),
  ownership_bps INTEGER NOT NULL CHECK (ownership_bps BETWEEN 1 AND 10000),
  territories TEXT[] NOT NULL DEFAULT ARRAY['WORLD']::text[],
  valid_from DATE,
  valid_until DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  affirmed_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  affirmed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_profile_id, release_id) REFERENCES releases(provider_profile_id, id) ON DELETE CASCADE,
  FOREIGN KEY (provider_profile_id, track_id) REFERENCES tracks(provider_profile_id, id) ON DELETE CASCADE,
  CHECK ((release_id IS NOT NULL)::integer + (track_id IS NOT NULL)::integer = 1),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  CHECK ((declaration_type = 'distribution' AND release_id IS NOT NULL) OR (declaration_type IN ('master', 'composition') AND track_id IS NOT NULL))
);
CREATE INDEX idx_rights_release_active ON rights_declarations(release_id, declaration_type) WHERE status = 'active';
CREATE INDEX idx_rights_track_active ON rights_declarations(track_id, declaration_type) WHERE status = 'active';

CREATE TABLE isrc_assignments (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  track_id TEXT NOT NULL,
  isrc TEXT NOT NULL CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
  source TEXT NOT NULL CHECK (source IN ('provider', 'imported', 'agency')),
  assigned_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY (provider_profile_id, track_id) REFERENCES tracks(provider_profile_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_isrc_assignments_active_isrc ON isrc_assignments(isrc) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX uq_isrc_assignments_active_track ON isrc_assignments(track_id) WHERE revoked_at IS NULL;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  release_id TEXT,
  track_id TEXT,
  name TEXT NOT NULL CHECK (LENGTH(BTRIM(name)) > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_profile_id, release_id) REFERENCES releases(provider_profile_id, id) ON DELETE CASCADE,
  FOREIGN KEY (provider_profile_id, track_id) REFERENCES tracks(provider_profile_id, id) ON DELETE CASCADE,
  CHECK ((release_id IS NOT NULL)::integer + (track_id IS NOT NULL)::integer = 1)
);
CREATE INDEX idx_products_release_active ON products(release_id, active);
CREATE INDEX idx_products_track_active ON products(track_id, active);

CREATE TABLE prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX idx_prices_product_active ON prices(product_id, active, effective_from);

CREATE TABLE revenue_split_sets (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  track_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (track_id, version),
  FOREIGN KEY (provider_profile_id, track_id) REFERENCES tracks(provider_profile_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_revenue_split_sets_active_track ON revenue_split_sets(track_id) WHERE active;

CREATE TABLE revenue_split_entries (
  id TEXT PRIMARY KEY,
  split_set_id TEXT NOT NULL REFERENCES revenue_split_sets(id) ON DELETE CASCADE,
  payee_name TEXT NOT NULL CHECK (LENGTH(BTRIM(payee_name)) > 0),
  payee_email TEXT,
  role TEXT,
  share_bps INTEGER NOT NULL CHECK (share_bps BETWEEN 1 AND 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_revenue_split_entries_set ON revenue_split_entries(split_set_id);

CREATE TABLE marketplace_audit_events (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_marketplace_audit_entity ON marketplace_audit_events(entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_marketplace_audit_provider ON marketplace_audit_events(provider_profile_id, occurred_at DESC);

CREATE FUNCTION prevent_marketplace_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'marketplace audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marketplace_audit_events_append_only
BEFORE UPDATE OR DELETE ON marketplace_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_audit_mutation();
`,
}
