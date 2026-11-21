import type {Migration} from './types'

/**
 * Additive only. Staff-managed store discount codes (percent off), modeled on Beat Wing's promo
 * codes: a code works on every release, or only on one release and its songs.
 *
 * The checkout attempt records the code and list price it was created with, and the order copies
 * the code and discount, so finance can see which sales were discounted. Existing rows get no
 * code and a zero discount, which is exactly what they were.
 */
export const discountCodesMigration: Migration = {
  version: 26,
  name: 'discount_codes',
  sql: `
CREATE TABLE marketplace_discount_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  percent_off INTEGER NOT NULL CHECK (percent_off BETWEEN 1 AND 90),
  release_id TEXT REFERENCES releases(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemption_count INTEGER NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uq_marketplace_discount_codes_code ON marketplace_discount_codes(code);

ALTER TABLE marketplace_checkout_attempts
  ADD COLUMN discount_code_id TEXT REFERENCES marketplace_discount_codes(id) ON DELETE SET NULL;
ALTER TABLE marketplace_checkout_attempts ADD COLUMN discount_code TEXT;
ALTER TABLE marketplace_checkout_attempts ADD COLUMN list_amount_minor INTEGER
  CHECK (list_amount_minor IS NULL OR list_amount_minor > 0);
ALTER TABLE marketplace_checkout_attempts ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0
  CHECK (discount_minor >= 0);

ALTER TABLE marketplace_orders ADD COLUMN discount_code TEXT;
ALTER TABLE marketplace_orders ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0
  CHECK (discount_minor >= 0);
`,
}
