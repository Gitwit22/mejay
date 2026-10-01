import type {Migration} from './types'

export const marketplacePayoutIntegrityMigration: Migration = {
  version: 13,
  name: 'marketplace_payout_integrity',
  sql: `
ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS transfer_reversed_minor INTEGER NOT NULL DEFAULT 0
    CHECK (transfer_reversed_minor >= 0);

UPDATE marketplace_orders SET transfer_reversed_minor = provider_proceeds_minor
WHERE transfer_status = 'reversed' AND transfer_reversed_minor = 0;
`,
}
