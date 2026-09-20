import type {Migration} from './types'

export const productionHardeningMigration: Migration = {
  version: 11,
  name: 'production_hardening',
  sql: `
ALTER TABLE provider_profiles ADD COLUMN suspended_at TIMESTAMPTZ;
ALTER TABLE provider_profiles ADD COLUMN suspension_reason TEXT;
ALTER TABLE provider_profiles ADD CONSTRAINT provider_suspension_complete CHECK (
  (suspended_at IS NULL AND suspension_reason IS NULL)
  OR (suspended_at IS NOT NULL AND LENGTH(BTRIM(suspension_reason)) > 0)
);

ALTER TABLE marketplace_checkout_attempts ADD COLUMN stripe_destination_account_id TEXT;
ALTER TABLE marketplace_orders ADD COLUMN stripe_destination_account_id TEXT;
UPDATE marketplace_checkout_attempts attempt SET stripe_destination_account_id = provider.stripe_account_id
FROM provider_profiles provider WHERE provider.id = attempt.provider_profile_id;
UPDATE marketplace_orders orders SET stripe_destination_account_id = provider.stripe_account_id
FROM provider_profiles provider WHERE provider.id = orders.provider_profile_id;

ALTER TABLE releases ADD COLUMN duplicate_fingerprint TEXT;
WITH fingerprints AS (
  SELECT release.id, CONCAT_WS('|',
      COALESCE((SELECT credit.artist_id FROM release_artists credit
        WHERE credit.release_id = release.id AND credit.is_primary = TRUE
        ORDER BY credit.artist_id LIMIT 1), ''),
      LOWER(REGEXP_REPLACE(BTRIM(release.title), '\\s+', ' ', 'g')),
      LOWER(REGEXP_REPLACE(BTRIM(COALESCE(release.version_title, '')), '\\s+', ' ', 'g')),
      release.release_type,
      COALESCE(release.original_release_date::text, '')
    ) AS fingerprint
  FROM releases release
), ranked AS (
  SELECT fingerprints.*, ROW_NUMBER() OVER (
    PARTITION BY release.provider_profile_id, fingerprints.fingerprint
    ORDER BY release.created_at, release.id
  ) AS duplicate_number
  FROM fingerprints JOIN releases release ON release.id = fingerprints.id
  WHERE release.status <> 'TAKEN_DOWN'
)
UPDATE releases release SET duplicate_fingerprint = CASE
  WHEN ranked.duplicate_number = 1 THEN ranked.fingerprint
  ELSE ranked.fingerprint || '|legacy-duplicate|' || release.id
END
FROM ranked WHERE ranked.id = release.id;
UPDATE releases release SET duplicate_fingerprint = CONCAT_WS('|',
  COALESCE((SELECT credit.artist_id FROM release_artists credit
    WHERE credit.release_id = release.id AND credit.is_primary = TRUE
    ORDER BY credit.artist_id LIMIT 1), ''),
  LOWER(REGEXP_REPLACE(BTRIM(release.title), '\\s+', ' ', 'g')),
  LOWER(REGEXP_REPLACE(BTRIM(COALESCE(release.version_title, '')), '\\s+', ' ', 'g')),
  release.release_type, COALESCE(release.original_release_date::text, ''), 'taken-down', release.id
) WHERE release.duplicate_fingerprint IS NULL;
ALTER TABLE releases ALTER COLUMN duplicate_fingerprint SET NOT NULL;
CREATE UNIQUE INDEX uq_releases_provider_fingerprint ON releases(provider_profile_id, duplicate_fingerprint)
  WHERE status <> 'TAKEN_DOWN';

CREATE TABLE marketplace_operational_incidents (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  order_id TEXT REFERENCES marketplace_orders(id) ON DELETE RESTRICT,
  stripe_event_id TEXT REFERENCES stripe_webhook_events(stripe_event_id) ON DELETE RESTRICT,
  incident_type TEXT NOT NULL CHECK (incident_type IN (
    'chargeback_opened', 'chargeback_won', 'chargeback_lost', 'payout_failed',
    'transfer_failed', 'split_dispute', 'provider_suspended', 'provider_reinstated'
  )),
  external_reference TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (stripe_event_id, incident_type)
);
CREATE INDEX idx_marketplace_incidents_provider ON marketplace_operational_incidents(provider_profile_id, occurred_at DESC);
CREATE INDEX idx_marketplace_incidents_order ON marketplace_operational_incidents(order_id, occurred_at DESC);

CREATE TABLE marketplace_reporting_corrections (
  id TEXT PRIMARY KEY,
  reporting_event_id TEXT NOT NULL REFERENCES marketplace_reporting_events(id) ON DELETE RESTRICT,
  correction_type TEXT NOT NULL CHECK (correction_type IN ('void', 'replace')),
  reason TEXT NOT NULL CHECK (LENGTH(BTRIM(reason)) > 0),
  replacement_data JSONB,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((correction_type = 'replace' AND replacement_data IS NOT NULL)
    OR (correction_type = 'void' AND replacement_data IS NULL))
);
CREATE INDEX idx_marketplace_reporting_corrections_event
  ON marketplace_reporting_corrections(reporting_event_id, created_at DESC);

CREATE TRIGGER marketplace_operational_incidents_append_only
BEFORE UPDATE OR DELETE ON marketplace_operational_incidents
FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_audit_mutation();
CREATE TRIGGER marketplace_reporting_corrections_append_only
BEFORE UPDATE OR DELETE ON marketplace_reporting_corrections
FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_reporting_mutation();
`,
}