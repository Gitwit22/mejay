import type {Migration} from './types'

export const marketplaceCommerceMigration: Migration = {
  version: 6,
  name: 'marketplace_commerce',
  sql: `
ALTER TABLE provider_profiles ADD COLUMN stripe_account_id TEXT;
ALTER TABLE provider_profiles ADD COLUMN stripe_details_submitted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE provider_profiles ADD COLUMN stripe_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE provider_profiles ADD COLUMN stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE provider_profiles ADD COLUMN stripe_transfers_status TEXT NOT NULL DEFAULT 'inactive'
  CHECK (stripe_transfers_status IN ('inactive', 'pending', 'active'));
ALTER TABLE provider_profiles ADD COLUMN stripe_requirements JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE provider_profiles ADD COLUMN stripe_account_synced_at TIMESTAMPTZ;
CREATE UNIQUE INDEX uq_provider_profiles_stripe_account
  ON provider_profiles(stripe_account_id) WHERE stripe_account_id IS NOT NULL;

CREATE TABLE marketplace_checkout_attempts (
  id TEXT PRIMARY KEY,
  buyer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE SET NULL,
  product_id TEXT REFERENCES products(id) ON DELETE RESTRICT,
  release_id TEXT REFERENCES releases(id) ON DELETE RESTRICT,
  price_id TEXT REFERENCES prices(id) ON DELETE SET NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  platform_fee_bps INTEGER NOT NULL CHECK (platform_fee_bps BETWEEN 0 AND 10000),
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_idempotency_key TEXT NOT NULL UNIQUE,
  transfer_group TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'checkout_created', 'paid', 'expired', 'canceled', 'failed')),
  snapshot JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_marketplace_checkout_attempts_buyer
  ON marketplace_checkout_attempts(buyer_user_id, created_at DESC);

CREATE TABLE marketplace_orders (
  id TEXT PRIMARY KEY,
  buyer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE SET NULL,
  checkout_attempt_id TEXT REFERENCES marketplace_checkout_attempts(id) ON DELETE SET NULL,
  buyer_email TEXT,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  gross_amount_minor INTEGER NOT NULL CHECK (gross_amount_minor > 0),
  platform_fee_minor INTEGER NOT NULL CHECK (platform_fee_minor >= 0),
  provider_proceeds_minor INTEGER NOT NULL CHECK (provider_proceeds_minor >= 0),
  stripe_fee_minor INTEGER CHECK (stripe_fee_minor IS NULL OR stripe_fee_minor >= 0),
  refunded_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount_minor >= 0),
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT NOT NULL UNIQUE,
  stripe_charge_id TEXT UNIQUE,
  stripe_balance_transaction_id TEXT,
  stripe_transfer_id TEXT UNIQUE,
  stripe_transfer_reversal_id TEXT,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('paid', 'refunded', 'partially_refunded', 'disputed', 'failed')),
  transfer_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (transfer_status IN ('pending', 'transferred', 'reversing', 'reversed', 'failed')),
  dispute_status TEXT NOT NULL DEFAULT 'none'
    CHECK (dispute_status IN ('none', 'open', 'won', 'lost')),
  paid_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (platform_fee_minor + provider_proceeds_minor = gross_amount_minor),
  CHECK (refunded_amount_minor <= gross_amount_minor)
);
CREATE INDEX idx_marketplace_orders_buyer ON marketplace_orders(buyer_user_id, paid_at DESC);
CREATE INDEX idx_marketplace_orders_provider ON marketplace_orders(provider_profile_id, paid_at DESC);
CREATE INDEX idx_marketplace_orders_pending_transfer
  ON marketplace_orders(created_at) WHERE transfer_status IN ('pending', 'failed');

CREATE TABLE marketplace_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES marketplace_orders(id) ON DELETE RESTRICT,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  release_id TEXT REFERENCES releases(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  release_title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  artwork_asset_id TEXT REFERENCES marketplace_assets(id) ON DELETE RESTRICT,
  unit_amount_minor INTEGER NOT NULL CHECK (unit_amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  catalog_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (order_id, product_id)
);

CREATE TABLE marketplace_split_allocations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES marketplace_orders(id) ON DELETE RESTRICT,
  order_item_id TEXT NOT NULL REFERENCES marketplace_order_items(id) ON DELETE RESTRICT,
  track_id TEXT REFERENCES tracks(id) ON DELETE RESTRICT,
  split_entry_id TEXT REFERENCES revenue_split_entries(id) ON DELETE RESTRICT,
  track_title TEXT NOT NULL,
  payee_name TEXT NOT NULL,
  payee_email TEXT,
  payee_role TEXT,
  share_bps INTEGER NOT NULL CHECK (share_bps BETWEEN 1 AND 10000),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_marketplace_split_allocations_order ON marketplace_split_allocations(order_id);
CREATE INDEX idx_marketplace_split_allocations_payee ON marketplace_split_allocations(LOWER(payee_email))
  WHERE payee_email IS NOT NULL;

CREATE TABLE marketplace_ledger_transactions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES marketplace_orders(id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'sale', 'stripe_fee', 'provider_transfer', 'transfer_reversal', 'refund', 'dispute_loss'
  )),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  stripe_reference_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_marketplace_ledger_transactions_order
  ON marketplace_ledger_transactions(order_id, occurred_at);

CREATE TABLE marketplace_ledger_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES marketplace_ledger_transactions(id) ON DELETE RESTRICT,
  account_code TEXT NOT NULL CHECK (LENGTH(BTRIM(account_code)) > 0),
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
);
CREATE INDEX idx_marketplace_ledger_entries_transaction
  ON marketplace_ledger_entries(transaction_id);

CREATE TABLE download_entitlements (
  id TEXT PRIMARY KEY,
  buyer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES marketplace_orders(id) ON DELETE RESTRICT,
  order_item_id TEXT NOT NULL REFERENCES marketplace_order_items(id) ON DELETE RESTRICT,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  suspended_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (order_id, order_item_id)
);
CREATE INDEX idx_download_entitlements_buyer
  ON download_entitlements(buyer_user_id, granted_at DESC);

CREATE TABLE download_entitlement_files (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES download_entitlements(id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  source_asset_id TEXT REFERENCES marketplace_assets(id) ON DELETE SET NULL,
  track_title TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  disc_number INTEGER NOT NULL CHECK (disc_number > 0),
  track_number INTEGER NOT NULL CHECK (track_number > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (entitlement_id, track_id)
);

CREATE TABLE marketplace_download_events (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT REFERENCES download_entitlements(id) ON DELETE SET NULL,
  entitlement_file_id TEXT REFERENCES download_entitlement_files(id) ON DELETE SET NULL,
  buyer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ip_hash TEXT,
  user_agent TEXT,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_marketplace_download_events_entitlement
  ON marketplace_download_events(entitlement_id, downloaded_at DESC);

CREATE TABLE stripe_webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  stripe_created_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'processed', 'failed', 'ignored')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION prevent_marketplace_financial_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'marketplace financial records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marketplace_order_items_append_only
BEFORE UPDATE OR DELETE ON marketplace_order_items
FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_financial_mutation();
CREATE TRIGGER marketplace_split_allocations_append_only
BEFORE UPDATE OR DELETE ON marketplace_split_allocations
FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_financial_mutation();
CREATE TRIGGER marketplace_ledger_transactions_append_only
BEFORE UPDATE OR DELETE ON marketplace_ledger_transactions
FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_financial_mutation();
CREATE TRIGGER marketplace_ledger_entries_append_only
BEFORE UPDATE OR DELETE ON marketplace_ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_financial_mutation();
`,
}