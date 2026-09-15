import type {Migration} from './types'

export const marketplaceAdminPublishingMigration: Migration = {
  version: 5,
  name: 'marketplace_admin_publishing',
  sql: `
ALTER TABLE releases DROP CONSTRAINT releases_status_check;
ALTER TABLE releases ADD CONSTRAINT releases_status_check CHECK (status IN (
  'DRAFT', 'METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE',
  'PRICING_COMPLETE', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED',
  'APPROVED', 'SCHEDULED', 'LIVE', 'REJECTED', 'TAKEN_DOWN'
));

ALTER TABLE marketplace_staff ADD COLUMN protected_owner BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE marketplace_staff ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE marketplace_staff_invites (
  email TEXT PRIMARY KEY CHECK (email = LOWER(BTRIM(email))),
  role TEXT NOT NULL CHECK (role IN ('reviewer', 'admin')),
  protected_owner BOOLEAN NOT NULL DEFAULT FALSE,
  full_site_access BOOLEAN NOT NULL DEFAULT FALSE,
  artist_portal_access BOOLEAN NOT NULL DEFAULT FALSE,
  invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  claimed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((claimed_at IS NULL) = (claimed_by_user_id IS NULL))
);
CREATE INDEX idx_marketplace_staff_invites_pending
  ON marketplace_staff_invites (created_at)
  WHERE claimed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE platform_access_grants (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_site_access BOOLEAN NOT NULL DEFAULT FALSE,
  artist_portal_access BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL CHECK (source IN ('bootstrap', 'marketplace_admin')),
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (full_site_access OR artist_portal_access)
);

CREATE TABLE release_review_events (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN (
    'review_started', 'approved', 'changes_requested', 'rejected',
    'restoration_requested', 'restoration_approved'
  )),
  note TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (decision IN ('changes_requested', 'rejected') AND LENGTH(BTRIM(note)) > 0)
    OR decision NOT IN ('changes_requested', 'rejected')
  )
);
CREATE INDEX idx_release_review_events_release
  ON release_review_events (release_id, created_at DESC);
CREATE INDEX idx_release_review_events_provider
  ON release_review_events (provider_profile_id, created_at DESC);

CREATE TABLE release_takedowns (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (LENGTH(BTRIM(reason)) > 0),
  prior_status TEXT NOT NULL CHECK (prior_status IN ('LIVE', 'SCHEDULED')),
  restored_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((restored_at IS NULL) OR (restored_by_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX uq_release_takedowns_active
  ON release_takedowns (release_id)
  WHERE restored_at IS NULL;
CREATE INDEX idx_release_takedowns_provider
  ON release_takedowns (provider_profile_id, created_at DESC);

CREATE INDEX idx_releases_review_queue
  ON releases (status, submitted_at, updated_at)
  WHERE status IN ('SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED');
CREATE INDEX idx_releases_due_schedule
  ON releases (scheduled_release_at)
  WHERE status = 'SCHEDULED';

INSERT INTO marketplace_staff_invites (
  email, role, protected_owner, full_site_access, artist_portal_access
) VALUES (
  'nxtlvltechllc@gmail.com', 'admin', TRUE, TRUE, TRUE
)
ON CONFLICT (email) DO UPDATE SET
  role = 'admin',
  protected_owner = TRUE,
  full_site_access = TRUE,
  artist_portal_access = TRUE,
  revoked_at = NULL,
  updated_at = CURRENT_TIMESTAMP;
`,
}