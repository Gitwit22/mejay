CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,             -- UUID
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id TEXT PRIMARY KEY,
  access_type TEXT NOT NULL DEFAULT 'free',
  has_full_access INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
