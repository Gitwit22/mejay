import type {Migration} from './types'

/**
 * Additive only. Artist-controlled store previews: whether a release's previews play before release
 * (during pre-orders) or only after, and where in each song the 10-second clip starts. Null start
 * means automatic. Each conversion job records the start it was queued with, so a file that keeps
 * failing is not re-queued for the same setting.
 */
export const previewSettingsMigration: Migration = {
  version: 20,
  name: 'preview_settings',
  sql: `
ALTER TABLE releases ADD COLUMN preview_timing TEXT NOT NULL DEFAULT 'after_release'
  CHECK (preview_timing IN ('before_release', 'after_release'));
ALTER TABLE tracks ADD COLUMN preview_start_ms INTEGER CHECK (preview_start_ms IS NULL OR preview_start_ms >= 0);
ALTER TABLE audio_processing_jobs ADD COLUMN preview_start_ms INTEGER;
`,
}
