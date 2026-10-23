import type {Migration} from './types'

/**
 * Additive only. Artist-chosen release dates, pre-orders, guest purchases and emailed download access.
 *
 * - releases: the artist's requested public release time (UTC) and display timezone, plus the
 *   pre-order opt-in. scheduled_release_at stays the date MeJay approved.
 * - Purchases record whether they were pre-orders. Delivery availability lives on the entitlement
 *   (delivery_status) and is independent of payment/dispute state (status). Existing rows default to
 *   'available', so every current purchase keeps downloading exactly as before.
 * - download_entitlements.buyer_user_id becomes nullable for guest purchases; buyer_email lets a
 *   buyer claim them later after verifying that address.
 * - Guest access tokens store only a SHA-256 hash of the secret.
 * - Email jobs and pre-order cancellations are durable, deduplicated and retryable.
 */
export const preordersMigration: Migration = {
  version: 19,
  name: 'preorders',
  sql: `
ALTER TABLE releases ADD COLUMN requested_release_at TIMESTAMPTZ;
ALTER TABLE releases ADD COLUMN release_timezone TEXT;
ALTER TABLE releases ADD COLUMN preorders_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE marketplace_checkout_attempts ADD COLUMN purchase_type TEXT NOT NULL DEFAULT 'standard'
  CHECK (purchase_type IN ('standard', 'preorder'));
ALTER TABLE marketplace_checkout_attempts ADD COLUMN guest_checkout BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE marketplace_orders ADD COLUMN purchase_type TEXT NOT NULL DEFAULT 'standard'
  CHECK (purchase_type IN ('standard', 'preorder'));

ALTER TABLE download_entitlements ALTER COLUMN buyer_user_id DROP NOT NULL;
ALTER TABLE download_entitlements ADD COLUMN buyer_email TEXT;
ALTER TABLE download_entitlements ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'available'
  CHECK (delivery_status IN ('held', 'available'));
ALTER TABLE download_entitlements ADD COLUMN delivery_available_at TIMESTAMPTZ;
CREATE INDEX idx_download_entitlements_unclaimed_email
  ON download_entitlements(buyer_email) WHERE buyer_user_id IS NULL;
CREATE INDEX idx_download_entitlements_held
  ON download_entitlements(order_id) WHERE delivery_status = 'held';

CREATE TABLE marketplace_guest_access_tokens (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES download_entitlements(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES marketplace_orders(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('email_link', 'download_session')),
  token_hash TEXT NOT NULL UNIQUE,
  recipient_email TEXT,
  issued_for TEXT NOT NULL CHECK (issued_for IN ('purchase', 'release_day', 'recovery', 'exchange')),
  expires_at TIMESTAMPTZ NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_marketplace_guest_access_tokens_entitlement
  ON marketplace_guest_access_tokens(entitlement_id, created_at DESC);

CREATE TABLE marketplace_email_jobs (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('release_day', 'release_date_changed', 'preorder_canceled')),
  order_id TEXT NOT NULL REFERENCES marketplace_orders(id) ON DELETE RESTRICT,
  entitlement_id TEXT REFERENCES download_entitlements(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_marketplace_email_jobs_due
  ON marketplace_email_jobs(next_attempt_at) WHERE status IN ('pending', 'sending');

CREATE TABLE marketplace_preorder_cancellations (
  order_id TEXT PRIMARY KEY REFERENCES marketplace_orders(id) ON DELETE RESTRICT,
  release_id TEXT REFERENCES releases(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'refund_requested', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  stripe_refund_id TEXT,
  last_error TEXT,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`,
}
