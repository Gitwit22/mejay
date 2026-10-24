import type {Migration} from './types'

/** Additive only. A running view count per story; drafts never receive views. */
export const editorialStoryViewsMigration: Migration = {
  version: 24,
  name: 'editorial_story_views',
  sql: `
ALTER TABLE editorial_stories ADD COLUMN view_count BIGINT NOT NULL DEFAULT 0 CHECK (view_count >= 0);
`,
}
