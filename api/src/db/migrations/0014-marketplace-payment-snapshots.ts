import type {Migration} from './types'

/**
 * Additive only. Snapshots the commission rate and Stripe mode on each order so finance reporting
 * no longer depends on the checkout attempt row, and lets checkout attempts record a failed payment
 * distinctly from a failed session creation.
 *
 * Legacy orders: platform_fee_bps is copied from the attempt that priced the sale (the same value
 * fulfillment used); livemode stays NULL because it was never recorded and must not be guessed.
 */
export const marketplacePaymentSnapshotsMigration: Migration = {
  version: 14,
  name: 'marketplace_payment_snapshots',
  sql: `
ALTER TABLE marketplace_orders
  ADD COLUMN platform_fee_bps INTEGER CHECK (platform_fee_bps IS NULL OR platform_fee_bps BETWEEN 0 AND 10000);
ALTER TABLE marketplace_orders ADD COLUMN livemode BOOLEAN;

UPDATE marketplace_orders purchase_order SET platform_fee_bps = attempt.platform_fee_bps
FROM marketplace_checkout_attempts attempt
WHERE attempt.id = purchase_order.checkout_attempt_id AND purchase_order.platform_fee_bps IS NULL;

ALTER TABLE marketplace_checkout_attempts DROP CONSTRAINT marketplace_checkout_attempts_status_check;
ALTER TABLE marketplace_checkout_attempts ADD CONSTRAINT marketplace_checkout_attempts_status_check
  CHECK (status IN ('pending', 'checkout_created', 'paid', 'expired', 'canceled', 'failed', 'payment_failed'));

CREATE INDEX idx_marketplace_orders_paid_at ON marketplace_orders(paid_at DESC);
`,
}
