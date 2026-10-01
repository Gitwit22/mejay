import type {Migration} from './types'

export const marketplaceSalePolicyMigration: Migration = {
  version: 8,
  name: 'marketplace_sale_policy',
  sql: `
UPDATE prices
SET active = FALSE
WHERE active = TRUE AND (amount_minor < 100 OR currency <> 'USD');

ALTER TABLE prices
  ADD CONSTRAINT prices_active_sale_policy_check
  CHECK (active = FALSE OR (amount_minor >= 100 AND currency = 'USD'));
`,
}
