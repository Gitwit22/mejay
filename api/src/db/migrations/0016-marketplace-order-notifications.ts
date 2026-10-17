import type {Migration} from './types'

/**
 * Additive only: a new table, no changes to existing rows. One row per order and notification kind
 * makes the purchase confirmation email exactly-once even when Stripe delivers several events for
 * the same paid order (checkout.session.completed and async_payment_succeeded, or retries).
 */
export const marketplaceOrderNotificationsMigration: Migration = {
  version: 16,
  name: 'marketplace_order_notifications',
  sql: `
CREATE TABLE marketplace_order_notifications (
  order_id TEXT NOT NULL REFERENCES marketplace_orders(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('purchase_confirmation')),
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 0),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id, kind)
);
`,
}
