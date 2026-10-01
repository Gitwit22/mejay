import type {Migration} from './types'

export const industryReportingMigration: Migration = {
  version: 10,
  name: 'industry_reporting',
  sql: `
CREATE TABLE marketplace_reporting_batches (
  id TEXT PRIMARY KEY,
  report_date DATE NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'exported'
    CHECK (status IN ('exported', 'submitted', 'accepted', 'rejected')),
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  export_format TEXT NOT NULL DEFAULT 'csv' CHECK (export_format = 'csv'),
  export_data TEXT NOT NULL,
  submitted_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE marketplace_reporting_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES marketplace_orders(id) ON DELETE RESTRICT,
  order_item_id TEXT NOT NULL REFERENCES marketplace_order_items(id) ON DELETE RESTRICT,
  ledger_transaction_id TEXT NOT NULL REFERENCES marketplace_ledger_transactions(id) ON DELETE RESTRICT,
  track_id TEXT REFERENCES tracks(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('sale', 'refund')),
  isrc TEXT,
  upc TEXT,
  artist_name TEXT NOT NULL,
  release_title TEXT NOT NULL,
  track_title TEXT NOT NULL,
  stripe_transaction_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  territory TEXT CHECK (territory IS NULL OR territory ~ '^[A-Z]{2}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_transaction_id, track_id)
);
CREATE INDEX idx_marketplace_reporting_events_daily
  ON marketplace_reporting_events(((occurred_at AT TIME ZONE 'UTC')::date), event_type);
CREATE INDEX idx_marketplace_reporting_events_trace
  ON marketplace_reporting_events(order_id, ledger_transaction_id, track_id);

CREATE TABLE marketplace_reporting_event_states (
  event_id TEXT PRIMARY KEY REFERENCES marketplace_reporting_events(id) ON DELETE RESTRICT,
  batch_id TEXT REFERENCES marketplace_reporting_batches(id) ON DELETE RESTRICT,
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'ready', 'metadata_error')),
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  validated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_marketplace_reporting_event_states_ready
  ON marketplace_reporting_event_states(validation_status, batch_id);

WITH catalog_source AS (
  SELECT orders.id AS order_id, orders.gross_amount_minor, orders.stripe_payment_intent_id,
    orders.buyer_country_code, item.id AS order_item_id, item.release_title, item.artist_name,
    item.unit_amount_minor, release.upc, track.id AS track_id, track.title AS track_title, isrc.isrc,
    ROW_NUMBER() OVER (PARTITION BY item.id ORDER BY track.disc_number, track.track_number, track.id) AS track_position,
    COUNT(*) OVER (PARTITION BY item.id) AS track_count
  FROM marketplace_orders orders
  JOIN marketplace_order_items item ON item.order_id = orders.id
  JOIN tracks track ON track.release_id = item.release_id
  LEFT JOIN releases release ON release.id = item.release_id
  LEFT JOIN isrc_assignments isrc ON isrc.track_id = track.id AND isrc.revoked_at IS NULL
), track_layout AS (
  SELECT catalog_source.*,
    FLOOR(unit_amount_minor::numeric / track_count)::integer
      + CASE WHEN track_position <= MOD(unit_amount_minor, track_count) THEN 1 ELSE 0 END AS sale_price_minor
  FROM catalog_source
), ledger_source AS (
  SELECT ledger.id AS ledger_transaction_id, ledger.transaction_type AS event_type,
    ledger.stripe_reference_id, ledger.currency, ledger.occurred_at, track_layout.*,
    CASE WHEN ledger.transaction_type = 'refund' THEN COALESCE(
      NULLIF(SUBSTRING(ledger.idempotency_key FROM '([0-9]+)$'), '')::integer,
      (SELECT SUM(entry.credit_minor) FROM marketplace_ledger_entries entry
        WHERE entry.transaction_id = ledger.id AND entry.account_code = 'stripe_clearing'),
      0
    ) ELSE 0 END AS cumulative_refunded_minor
  FROM marketplace_ledger_transactions ledger
  JOIN track_layout ON track_layout.order_id = ledger.order_id
  WHERE ledger.transaction_type IN ('sale', 'refund')
), refund_base AS (
  SELECT ledger_source.*,
    FLOOR(cumulative_refunded_minor::numeric * sale_price_minor / gross_amount_minor)::integer AS base_target_minor,
    MOD(cumulative_refunded_minor::numeric * sale_price_minor, gross_amount_minor) AS target_remainder
  FROM ledger_source
  WHERE event_type = 'refund' AND gross_amount_minor > 0
), refund_ranked AS (
  SELECT refund_base.*,
    ROW_NUMBER() OVER (PARTITION BY ledger_transaction_id ORDER BY target_remainder DESC, track_id) AS remainder_rank,
    SUM(base_target_minor) OVER (PARTITION BY ledger_transaction_id) AS base_total_minor
  FROM refund_base
), refund_targets AS (
  SELECT refund_ranked.*,
    base_target_minor + CASE WHEN remainder_rank <= cumulative_refunded_minor - base_total_minor THEN 1 ELSE 0 END AS target_minor
  FROM refund_ranked
), refund_rows AS (
  SELECT refund_targets.*,
    target_minor - LAG(target_minor, 1, 0) OVER (
      PARTITION BY order_id, track_id ORDER BY occurred_at, ledger_transaction_id
    ) AS price_minor
  FROM refund_targets
), reporting_source AS (
  SELECT ledger_source.*, sale_price_minor AS price_minor FROM ledger_source WHERE event_type = 'sale'
  UNION ALL
  SELECT ledger_source.*, refund_rows.price_minor FROM ledger_source
  JOIN refund_rows USING (ledger_transaction_id, track_id)
  WHERE ledger_source.event_type = 'refund' AND refund_rows.price_minor > 0
), inserted_events AS (
  INSERT INTO marketplace_reporting_events
    (id, order_id, order_item_id, ledger_transaction_id, track_id, event_type, isrc, upc,
      artist_name, release_title, track_title, stripe_transaction_id, currency, price_minor,
      quantity, territory, occurred_at)
  SELECT 'report-' || MD5(ledger_transaction_id || ':' || track_id), order_id, order_item_id,
    ledger_transaction_id, track_id, event_type, isrc, upc, artist_name, release_title, track_title,
    COALESCE(stripe_reference_id, stripe_payment_intent_id, ''), currency, price_minor,
    1, buyer_country_code, occurred_at
  FROM reporting_source
  RETURNING id, isrc, upc, artist_name, release_title, track_title,
    stripe_transaction_id, currency, price_minor, territory
)
INSERT INTO marketplace_reporting_event_states
  (event_id, validation_status, validation_errors, validated_at)
SELECT id,
  CASE WHEN isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'
    AND upc ~ '^[0-9]{12,14}$' AND LENGTH(BTRIM(artist_name)) > 0
    AND LENGTH(BTRIM(release_title)) > 0 AND LENGTH(BTRIM(track_title)) > 0
    AND LENGTH(BTRIM(stripe_transaction_id)) > 0 AND currency ~ '^[A-Z]{3}$'
    AND price_minor >= 0 AND territory ~ '^[A-Z]{2}$'
    THEN 'ready' ELSE 'metadata_error' END,
  TO_JSONB(ARRAY_REMOVE(ARRAY[
    CASE WHEN isrc IS NULL OR isrc !~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$' THEN 'isrc_missing_or_invalid' END,
    CASE WHEN upc IS NULL OR upc !~ '^[0-9]{12,14}$' THEN 'upc_missing_or_invalid' END,
    CASE WHEN territory IS NULL OR territory !~ '^[A-Z]{2}$' THEN 'territory_missing_or_invalid' END
  ]::TEXT[], NULL)), CURRENT_TIMESTAMP
FROM inserted_events;

CREATE FUNCTION prevent_marketplace_reporting_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'marketplace reporting events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marketplace_reporting_events_append_only
BEFORE UPDATE OR DELETE ON marketplace_reporting_events
FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_reporting_mutation();
`,
}