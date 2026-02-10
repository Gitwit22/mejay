-- Fix bug where Pro purchases were persisted with has_full_access=0,
-- causing the app to treat Pro users as Free.
--
-- NOTE: Best-effort remediation. If you later add Stripe webhooks
-- for subscription lifecycle updates, this can be removed/adjusted.

UPDATE entitlements
SET
  has_full_access = 1,
  updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
WHERE
  access_type = 'pro'
  AND has_full_access = 0
  AND stripe_subscription_id IS NOT NULL;
