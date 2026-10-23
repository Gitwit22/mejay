import type {Migration} from './types'

/**
 * Additive only. Changes to an approved, scheduled or live release are proposed as a change request
 * that MeJay approves before anything on the release changes. Replacement cover art or audio is
 * uploaded as 'staged': every catalog, checkout, preview and download query requires 'ready', so a
 * staged file is invisible until approval flips it to 'ready'. The status check is replaced with a
 * superset, so existing rows are unaffected.
 */
export const releaseChangeRequestsMigration: Migration = {
  version: 22,
  name: 'release_change_requests',
  sql: `
ALTER TABLE marketplace_assets DROP CONSTRAINT IF EXISTS marketplace_assets_processing_status_check;
ALTER TABLE marketplace_assets ADD CONSTRAINT marketplace_assets_processing_status_check
  CHECK (processing_status IN ('pending', 'ready', 'failed', 'staged'));

CREATE TABLE release_change_requests (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'in_review', 'approved', 'rejected', 'withdrawn')),
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  base_release_version INTEGER NOT NULL,
  artwork_asset_id TEXT REFERENCES marketplace_assets(id) ON DELETE SET NULL,
  audio_replacements JSONB NOT NULL DEFAULT '[]'::jsonb,
  same_recording_required BOOLEAN NOT NULL DEFAULT FALSE,
  same_recording_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  review_note TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_profile_id, release_id) REFERENCES releases(provider_profile_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_release_change_requests_open
  ON release_change_requests(release_id) WHERE status IN ('draft', 'submitted', 'in_review');
CREATE INDEX idx_release_change_requests_queue
  ON release_change_requests(status, submitted_at) WHERE status IN ('submitted', 'in_review');
`,
}
