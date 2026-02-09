-- Password-based auth + purpose-scoped email codes

-- Users: allow password auth (nullable => not set yet)
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;

-- Email codes: used for signup verification and password resets.
CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT NOT NULL,
  purpose TEXT NOT NULL, -- 'signup_verify' | 'password_reset'
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (email, purpose)
);

CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email);

-- Basic per-IP rate limiting for auth endpoints.
CREATE TABLE IF NOT EXISTS auth_ip_rates (
  ip TEXT NOT NULL,
  purpose TEXT NOT NULL, -- same purpose values
  kind TEXT NOT NULL, -- 'start' | 'verify'
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  PRIMARY KEY (ip, purpose, kind)
);

CREATE INDEX IF NOT EXISTS idx_auth_ip_rates_ip ON auth_ip_rates(ip);
