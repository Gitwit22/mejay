import type {Migration} from './types'

export const marketplaceDiscoveryMigration: Migration = {
  version: 7,
  name: 'marketplace_discovery',
  sql: `
CREATE TABLE marketplace_preview_events (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES marketplace_assets(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  previewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_marketplace_preview_events_release
  ON marketplace_preview_events(release_id, previewed_at DESC);
CREATE INDEX idx_marketplace_preview_events_asset
  ON marketplace_preview_events(asset_id, previewed_at DESC);

CREATE TABLE marketplace_discovery_features (
  id TEXT PRIMARY KEY,
  release_id TEXT REFERENCES releases(id) ON DELETE CASCADE,
  artist_id TEXT REFERENCES artists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((release_id IS NOT NULL)::integer + (artist_id IS NOT NULL)::integer = 1)
);
CREATE UNIQUE INDEX uq_marketplace_discovery_feature_release
  ON marketplace_discovery_features(release_id) WHERE release_id IS NOT NULL;
CREATE UNIQUE INDEX uq_marketplace_discovery_feature_artist
  ON marketplace_discovery_features(artist_id) WHERE artist_id IS NOT NULL;
CREATE UNIQUE INDEX uq_marketplace_discovery_release_position
  ON marketplace_discovery_features(position) WHERE release_id IS NOT NULL;
CREATE UNIQUE INDEX uq_marketplace_discovery_artist_position
  ON marketplace_discovery_features(position) WHERE artist_id IS NOT NULL;
`,
}
