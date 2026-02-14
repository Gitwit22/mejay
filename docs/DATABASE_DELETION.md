# MEJay Database Deletion Guide

## Database Info

- **Database**: mejaydb
- **Type**: Cloudflare D1 (SQLite)
- **ID**: 1218d7a8-4fa7-4ed7-a31c-d673a2450229

## Tables Overview

| Table | Has user_id FK? | Delete Before users? |
|-------|----------------|---------------------|
| `users` | — | N/A (target) |
| `entitlements` | ✅ Yes | ✅ Yes |
| `sessions` | ✅ Yes | ✅ Yes |
| `auth_codes` | ❌ No (uses email) | ❌ No |
| `email_codes` | ❌ No (uses email) | ❌ No |
| `auth_ip_rates` | ❌ No (uses ip) | ❌ No |
| `_cf_KV` | ❌ No | ❌ No |
| `d1_migrations` | ❌ No | ❌ No |
| `sqlite_sequence` | ❌ No | ❌ No |

## Delete User(s) — Step by Step

### 1. Delete from entitlements first
```bash
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM entitlements WHERE user_id IN (SELECT id FROM users WHERE email IN ('user1@example.com','user2@example.com'));"
```

### 2. Delete from sessions
```bash
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email IN ('user1@example.com','user2@example.com'));"
```

### 3. Finally delete from users
```bash
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM users WHERE email IN ('user1@example.com','user2@example.com');"
```

## Single User Delete (Copy & Paste Template)

Replace `TARGET_EMAIL` with the user's email:

```bash
# Step 1: entitlements
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM entitlements WHERE user_id = (SELECT id FROM users WHERE email = 'TARGET_EMAIL');"

# Step 2: sessions
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'TARGET_EMAIL');"

# Step 3: user
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM users WHERE email = 'TARGET_EMAIL';"
```

## Bulk Delete (Multiple Users)

Replace the email list:

```bash
# Step 1: entitlements
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM entitlements WHERE user_id IN (SELECT id FROM users WHERE email IN ('email1@example.com','email2@example.com','email3@example.com'));"

# Step 2: sessions
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email IN ('email1@example.com','email2@example.com','email3@example.com'));"

# Step 3: users
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM users WHERE email IN ('email1@example.com','email2@example.com','email3@example.com');"
```

## Useful Queries

### List all users
```bash
npx wrangler d1 execute mejaydb --remote --command "SELECT id, email, created_at FROM users ORDER BY created_at DESC;"
```

### Count users
```bash
npx wrangler d1 execute mejaydb --remote --command "SELECT COUNT(*) as total FROM users;"
```

### Find user by email
```bash
npx wrangler d1 execute mejaydb --remote --command "SELECT * FROM users WHERE email = 'someone@example.com';"
```

### List all tables
```bash
npx wrangler d1 execute mejaydb --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```

### Check table schema
```bash
npx wrangler d1 execute mejaydb --remote --command "PRAGMA table_info(users);"
```

### Find foreign key references to users
```bash
npx wrangler d1 execute mejaydb --remote --command "SELECT * FROM entitlements WHERE user_id = 'USER_ID_HERE';"
npx wrangler d1 execute mejaydb --remote --command "SELECT * FROM sessions WHERE user_id = 'USER_ID_HERE';"
```

## ⚠️ Important Notes

- **Always delete child records first** — Foreign key constraints will block user deletion if related records exist.
- **Order matters**:
  1. `entitlements` → `sessions` → `users`
- **No subscriptions table** — Despite what you might expect, this table doesn't exist.
- **auth_codes and email_codes** — These use email as the key, not user_id, so they don't block user deletion.
- **Local vs Remote** — Remove `--remote` flag to execute on local dev database instead.
- **Backup first (optional but recommended for production)**:
  ```bash
  npx wrangler d1 export mejaydb --remote --output=backup.sql
  ```

## Nuclear Option: Delete ALL Users

⚠️ **DANGER** — This wipes everything

```bash
# Clear all child tables
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM entitlements;"
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM sessions;"

# Clear users
npx wrangler d1 execute mejaydb --remote --command "DELETE FROM users;"
```

## Future: Add CASCADE Deletes

To avoid manual multi-step deletion, update your schema to use `ON DELETE CASCADE`:

```sql
CREATE TABLE entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- ...
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- ...
);
```

Then deleting a user automatically removes their entitlements and sessions.
