import type {Migration} from './types'

export const marketplaceReportingMigration: Migration = {
  version: 9,
  name: 'marketplace_reporting',
  sql: `
ALTER TABLE marketplace_orders
  ADD COLUMN buyer_country_code TEXT
  CHECK (buyer_country_code IS NULL OR buyer_country_code ~ '^[A-Z]{2}$');

CREATE INDEX idx_marketplace_orders_provider_reporting
  ON marketplace_orders(provider_profile_id, paid_at DESC, buyer_country_code);
`,
}
