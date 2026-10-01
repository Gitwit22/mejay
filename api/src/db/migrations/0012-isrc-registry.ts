import type {Migration} from './types'

export const isrcRegistryMigration: Migration = {
  version: 12,
  name: 'isrc_registry',
  sql: `
CREATE TABLE IF NOT EXISTS isrc_rights_certifications (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE SET NULL,
  track_id TEXT,
  attested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  controls_recording BOOLEAN NOT NULL DEFAULT FALSE,
  never_assigned_isrc BOOLEAN NOT NULL DEFAULT FALSE,
  authorize_assignment BOOLEAN NOT NULL DEFAULT FALSE,
  attested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (controls_recording = TRUE AND never_assigned_isrc = TRUE AND authorize_assignment = TRUE)
);
CREATE INDEX IF NOT EXISTS idx_isrc_rights_certifications_track
  ON isrc_rights_certifications(track_id, attested_at DESC);

ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS track_id TEXT;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS artist_id TEXT;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS rights_owner_id TEXT;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS registrant_code TEXT;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS assignment_type TEXT;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS rights_certification_id TEXT REFERENCES isrc_rights_certifications(id) ON DELETE SET NULL;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS track_title TEXT;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS artist_name TEXT;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS provider_name TEXT;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS rights_owner_name TEXT;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE isrc_registry ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'isrc_registry_country_code_check') THEN
    ALTER TABLE isrc_registry ADD CONSTRAINT isrc_registry_country_code_check CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'isrc_registry_registrant_code_check') THEN
    ALTER TABLE isrc_registry ADD CONSTRAINT isrc_registry_registrant_code_check CHECK (registrant_code IS NULL OR registrant_code ~ '^[A-Z0-9]{3}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'isrc_registry_assignment_type_check') THEN
    ALTER TABLE isrc_registry ADD CONSTRAINT isrc_registry_assignment_type_check CHECK (assignment_type IS NULL OR assignment_type IN ('MEJAY_ASSIGNED', 'EXTERNAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'isrc_registry_status_check') THEN
    ALTER TABLE isrc_registry ADD CONSTRAINT isrc_registry_status_check CHECK (status IS NULL OR status IN ('RESERVED', 'ASSIGNED', 'REGISTERED', 'VOIDED'));
  END IF;
END $$;

UPDATE isrc_registry
SET
  track_id = COALESCE(track_id, original_track_id),
  country_code = COALESCE(country_code, SUBSTRING(prefix FROM 1 FOR 2)),
  registrant_code = COALESCE(registrant_code, SUBSTRING(prefix FROM 3 FOR 3)),
  assignment_type = COALESCE(assignment_type, CASE WHEN source = 'agency' THEN 'MEJAY_ASSIGNED' ELSE 'EXTERNAL' END),
  status = COALESCE(status, CASE WHEN source = 'agency' THEN 'ASSIGNED' ELSE 'REGISTERED' END),
  created_at = COALESCE(created_at, assigned_at),
  updated_at = COALESCE(updated_at, assigned_at)
WHERE
  track_id IS NULL
  OR country_code IS NULL
  OR registrant_code IS NULL
  OR assignment_type IS NULL
  OR status IS NULL;

UPDATE isrc_registry r
SET
  artist_id = COALESCE(r.artist_id, (
    SELECT ta.artist_id
    FROM track_artists ta
    WHERE ta.track_id = track_data.id AND ta.is_primary = TRUE
    LIMIT 1
  )),
  rights_owner_id = COALESCE(r.rights_owner_id, r.provider_profile_id),
  track_title = COALESCE(r.track_title, track_data.title),
  artist_name = COALESCE(r.artist_name, (
    SELECT a.name
    FROM track_artists ta
    JOIN artists a ON a.id = ta.artist_id AND a.provider_profile_id = ta.provider_profile_id
    WHERE ta.track_id = track_data.id AND ta.is_primary = TRUE
    LIMIT 1
  )),
  provider_name = COALESCE(r.provider_name, provider.display_name),
  rights_owner_name = COALESCE(r.rights_owner_name, (
    SELECT rights_holder
    FROM rights_declarations
    WHERE track_id = track_data.id AND declaration_type = 'master' AND status = 'active'
    ORDER BY affirmed_at DESC, created_at DESC
    LIMIT 1
  ))
FROM tracks track_data
LEFT JOIN provider_profiles provider ON provider.id = track_data.provider_profile_id
WHERE track_data.id = COALESCE(r.track_id, r.original_track_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_isrc_registry_track
  ON isrc_registry(track_id)
  WHERE track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_isrc_registry_search
  ON isrc_registry(assignment_year, assigned_at DESC, isrc);

CREATE TABLE IF NOT EXISTS isrc_sequences (
  prefix TEXT NOT NULL CHECK (prefix ~ '^[A-Z]{2}[A-Z0-9]{3}$'),
  assignment_year INTEGER NOT NULL CHECK (assignment_year BETWEEN 0 AND 99),
  next_number INTEGER NOT NULL CHECK (next_number BETWEEN 1 AND 100000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (prefix, assignment_year)
);

INSERT INTO isrc_sequences (prefix, assignment_year, next_number)
SELECT prefix, assignment_year, LEAST(MAX(last_designation) + 1, 100000)
FROM isrc_counters
GROUP BY prefix, assignment_year
ON CONFLICT (prefix, assignment_year) DO UPDATE
SET next_number = GREATEST(isrc_sequences.next_number, EXCLUDED.next_number),
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO isrc_sequences (prefix, assignment_year, next_number)
SELECT prefix, assignment_year, LEAST(MAX(designation) + 1, 100000)
FROM isrc_registry
GROUP BY prefix, assignment_year
ON CONFLICT (prefix, assignment_year) DO UPDATE
SET next_number = GREATEST(isrc_sequences.next_number, EXCLUDED.next_number),
    updated_at = CURRENT_TIMESTAMP;
`,
}
