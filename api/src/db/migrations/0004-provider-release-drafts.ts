import type {Migration} from './types'

export const providerReleaseDraftsMigration: Migration = {
  version: 4,
  name: 'provider_release_drafts',
  sql: `
ALTER TABLE releases ADD COLUMN draft_step TEXT NOT NULL DEFAULT 'release-information';
ALTER TABLE releases ADD COLUMN genre TEXT;
ALTER TABLE releases ADD COLUMN subgenre TEXT;
ALTER TABLE releases ADD COLUMN upc TEXT;
ALTER TABLE releases ADD COLUMN copyright_year INTEGER;
ALTER TABLE releases ADD COLUMN copyright_holder TEXT;
ALTER TABLE releases ADD COLUMN phonographic_copyright_year INTEGER;
ALTER TABLE releases ADD COLUMN phonographic_copyright_holder TEXT;
ALTER TABLE releases ADD CONSTRAINT releases_draft_step_check CHECK (draft_step IN (
  'release-information', 'artwork', 'tracks', 'track-metadata', 'isrc',
  'rights', 'pricing', 'splits', 'review'
));
ALTER TABLE releases ADD CONSTRAINT releases_upc_check CHECK (upc IS NULL OR upc ~ '^[0-9]{12,14}$');
ALTER TABLE releases ADD CONSTRAINT releases_copyright_year_check CHECK (copyright_year IS NULL OR copyright_year BETWEEN 1900 AND 2200);
ALTER TABLE releases ADD CONSTRAINT releases_phonographic_copyright_year_check CHECK (phonographic_copyright_year IS NULL OR phonographic_copyright_year BETWEEN 1900 AND 2200);

ALTER TABLE tracks ADD COLUMN genre TEXT;
ALTER TABLE tracks ADD COLUMN instrumental BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tracks ADD COLUMN recording_year INTEGER;
ALTER TABLE tracks ADD COLUMN recording_location TEXT;
ALTER TABLE tracks ADD CONSTRAINT tracks_recording_year_check CHECK (recording_year IS NULL OR recording_year BETWEEN 1900 AND 2200);

CREATE TABLE track_contributors (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (LENGTH(BTRIM(name)) > 0),
  role TEXT NOT NULL CHECK (role IN ('writer', 'composer', 'producer', 'featured_artist', 'remixer', 'other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_profile_id, track_id) REFERENCES tracks(provider_profile_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_track_contributors_track ON track_contributors(track_id, role);

CREATE TABLE isrc_registry (
  id TEXT PRIMARY KEY,
  isrc TEXT NOT NULL UNIQUE CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
  prefix TEXT NOT NULL CHECK (prefix ~ '^[A-Z]{2}[A-Z0-9]{3}$'),
  assignment_year INTEGER NOT NULL CHECK (assignment_year BETWEEN 0 AND 99),
  designation INTEGER NOT NULL CHECK (designation BETWEEN 1 AND 99999),
  source TEXT NOT NULL CHECK (source IN ('provider', 'imported', 'agency')),
  provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE SET NULL,
  original_track_id TEXT,
  assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (prefix, assignment_year, designation)
);
CREATE INDEX idx_isrc_registry_provider ON isrc_registry(provider_profile_id, assigned_at DESC);

CREATE TABLE isrc_counters (
  prefix TEXT NOT NULL CHECK (prefix ~ '^[A-Z]{2}[A-Z0-9]{3}$'),
  assignment_year INTEGER NOT NULL CHECK (assignment_year BETWEEN 0 AND 99),
  last_designation INTEGER NOT NULL CHECK (last_designation BETWEEN 0 AND 99999),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (prefix, assignment_year)
);

ALTER TABLE isrc_assignments ADD COLUMN registry_id TEXT REFERENCES isrc_registry(id) ON DELETE RESTRICT;

INSERT INTO isrc_registry (
  id, isrc, prefix, assignment_year, designation, source,
  provider_profile_id, original_track_id, assigned_by_user_id, assigned_at
)
SELECT
  i.id, i.isrc, SUBSTRING(i.isrc FROM 1 FOR 5),
  SUBSTRING(i.isrc FROM 6 FOR 2)::integer,
  SUBSTRING(i.isrc FROM 8 FOR 5)::integer,
  i.source, i.provider_profile_id, i.track_id, i.assigned_by_user_id, i.assigned_at
FROM isrc_assignments i
ON CONFLICT (isrc) DO NOTHING;

UPDATE isrc_assignments i
SET registry_id = r.id
FROM isrc_registry r
WHERE r.isrc = i.isrc AND i.registry_id IS NULL;

ALTER TABLE isrc_assignments ALTER COLUMN registry_id SET NOT NULL;
CREATE UNIQUE INDEX uq_isrc_assignments_registry ON isrc_assignments(registry_id);

INSERT INTO isrc_counters (prefix, assignment_year, last_designation)
SELECT prefix, assignment_year, MAX(designation)
FROM isrc_registry
WHERE prefix = 'QTA3L'
GROUP BY prefix, assignment_year
ON CONFLICT (prefix, assignment_year) DO UPDATE
SET last_designation = GREATEST(isrc_counters.last_designation, EXCLUDED.last_designation),
    updated_at = CURRENT_TIMESTAMP;
`,
}