import type {Migration} from './types'

/**
 * Additive only. Artist-chosen store preview length per song, 5 to 30 seconds. Songs that already
 * exist keep the 10 seconds their clips were made with; songs added from now on start at 15.
 * Each conversion job records the length it was queued with (null on jobs queued before this,
 * which made 10-second clips).
 */
export const previewLengthMigration: Migration = {
  version: 25,
  name: 'preview_length',
  sql: `
ALTER TABLE tracks ADD COLUMN preview_length_ms INTEGER NOT NULL DEFAULT 10000
  CHECK (preview_length_ms BETWEEN 5000 AND 30000);
ALTER TABLE tracks ALTER COLUMN preview_length_ms SET DEFAULT 15000;
ALTER TABLE audio_processing_jobs ADD COLUMN preview_length_ms INTEGER;
`,
}
