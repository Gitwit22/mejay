import type {Migration} from './types'

/**
 * Additive only. Extra artist credits on a release beyond its lead primary artist: more primary
 * artists ("A & B") and featured artists ("feat. C"). Each is one of the account's artists or just a
 * name for someone not on MeJay. The lead stays the single release_artists row with is_primary, so
 * every existing query that expects exactly one primary artist is unaffected.
 */
export const releaseArtistCreditsMigration: Migration = {
  version: 21,
  name: 'release_artist_credits',
  sql: `
CREATE TABLE release_artist_credits (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('primary', 'featured')),
  artist_id TEXT,
  display_name TEXT NOT NULL CHECK (LENGTH(BTRIM(display_name)) BETWEEN 1 AND 300),
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_profile_id, release_id) REFERENCES releases(provider_profile_id, id) ON DELETE CASCADE,
  FOREIGN KEY (provider_profile_id, artist_id) REFERENCES artists(provider_profile_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_release_artist_credits_release ON release_artist_credits(release_id, role, position);
`,
}
