import type {Migration} from './types'

/**
 * Additive only. Background audio processing: a durable job record per conversion of an uploaded
 * master, and two derived asset kinds (the tagged delivery MP3 and the preview clip). The asset kind
 * checks are replaced with supersets of the previous rules, so every existing asset still satisfies
 * them. Nothing reads the new kinds yet except the converter.
 */
export const audioProcessingMigration: Migration = {
  version: 18,
  name: 'audio_processing',
  sql: `
ALTER TABLE marketplace_assets DROP CONSTRAINT marketplace_assets_kind_check;
ALTER TABLE marketplace_assets ADD CONSTRAINT marketplace_assets_kind_check
  CHECK (kind IN ('artwork', 'audio', 'audio_delivery', 'audio_preview', 'artist_photo', 'artist_banner', 'artist_cutout', 'artist_gallery', 'rights_document'));
ALTER TABLE marketplace_assets DROP CONSTRAINT marketplace_assets_kind_owner_check;
ALTER TABLE marketplace_assets ADD CONSTRAINT marketplace_assets_kind_owner_check CHECK (
  (kind IN ('artwork', 'rights_document') AND release_id IS NOT NULL)
  OR (kind IN ('audio', 'audio_delivery', 'audio_preview') AND track_id IS NOT NULL)
  OR (kind IN ('artist_photo', 'artist_banner', 'artist_cutout', 'artist_gallery') AND artist_id IS NOT NULL)
);

CREATE TABLE audio_processing_jobs (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  source_asset_id TEXT NOT NULL REFERENCES marketplace_assets(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  run_after TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT CHECK (last_error IS NULL OR LENGTH(last_error) <= 1000),
  outputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- One active conversion per uploaded master; finished jobs stay as history.
CREATE UNIQUE INDEX uq_audio_processing_jobs_active_source
  ON audio_processing_jobs(source_asset_id) WHERE status IN ('queued', 'processing');
CREATE INDEX idx_audio_processing_jobs_claim ON audio_processing_jobs(status, run_after);
CREATE INDEX idx_audio_processing_jobs_track ON audio_processing_jobs(track_id, created_at DESC);
`,
}
