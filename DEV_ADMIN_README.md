# Dev Admin Panel

## Overview

A dev-only admin interface for managing users during development. Provides a clean UI to list and delete users with proper cascading deletes that respect foreign key constraints.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND                                │
│  /app/dev-admin (DevAdminPage.tsx)                          │
│                                                              │
│  • Only rendered when import.meta.env.DEV === true          │
│  • Lists users with search                                  │
│  • Two-step delete confirmation                             │
│  • Toast notifications                                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTP Requests
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    API ENDPOINTS                             │
│  functions/api/dev-admin/                                   │
│                                                              │
│  GET  /api/dev-admin/users                                  │
│  └─▶ Lists all users (limit 500)                           │
│                                                              │
│  DELETE /api/dev-admin/users/[userId]                       │
│  └─▶ Cascading delete in transaction                       │
│                                                              │
│  🔒 Protected by _guard.ts                                  │
│     ✓ Environment check (NODE_ENV/ALLOW_DEV_ADMIN)         │
│     ✓ Session authentication                                │
│     ✓ Email allowlist (optional)                            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ D1 Batch Operations
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    DATABASE (D1)                             │
│                                                              │
│  Deletion Order (handles FK constraints):                   │
│  1. DELETE FROM sessions WHERE user_id = ?                  │
│  2. DELETE FROM entitlements WHERE user_id = ?              │
│  3. DELETE FROM email_codes WHERE email = ?                 │
│  4. DELETE FROM auth_codes WHERE email = ?                  │
│  5. DELETE FROM users WHERE id = ?                          │
│                                                              │
│  ⚡ Atomic: All succeed or all fail                         │
└─────────────────────────────────────────────────────────────┘
```

## Security Features

✅ **Environment Guard**: Only works when `NODE_ENV !== "production"` or `ALLOW_DEV_ADMIN=true`  
✅ **Authentication Required**: Must be logged in to access  
✅ **Email Allowlist**: Optional `DEV_ADMIN_EMAILS` environment variable for additional security  
✅ **Frontend Guard**: Route only registered in development mode (`import.meta.env.DEV`)

## Setup

### 1. Environment Variables

Add to your `.dev.vars` or local environment:

```bash
# Enable dev admin (required in non-dev environments)
ALLOW_DEV_ADMIN=true

# Optional: restrict access to specific emails (comma-separated)
DEV_ADMIN_EMAILS=you@example.com,admin@example.com
```

If `DEV_ADMIN_EMAILS` is not set, any authenticated user can access the admin panel in dev mode (with a console warning).

### 2. Access the Admin Panel

During development, navigate to:

```
http://localhost:5173/app/dev-admin
```

You must be logged in first.

## Architecture

### Backend (`functions/api/dev-admin/`)

#### `_guard.ts`
- Checks environment (`NODE_ENV` or `ALLOW_DEV_ADMIN`)
- Verifies user authentication via session
- Validates user email against allowlist (if configured)
- Returns 404 in production, 401/403 for unauthorized access

#### `users.ts` (GET)
- Lists all users with entitlements
- Limited to 500 results for safety
- Returns: `id`, `email`, `created_at`, `access_type`, `has_full_access`

#### `users/[userId].ts` (DELETE)
- Performs atomic cascading delete using D1 batch operations
- Deletion order:
  1. Sessions (user_id FK)
  2. Entitlements (user_id FK)
  3. Email codes (email)
  4. Auth codes (email)
  5. User record
- Returns deleted user ID and email on success

### Frontend (`src/app/pages/DevAdminPage.tsx`)

- Terminal/industrial aesthetic UI
- Real-time search by email or user ID
- Two-step delete confirmation (button → confirm)
- Toast notifications for success/errors
- Automatic user list refresh after deletion
- Only rendered when `import.meta.env.DEV === true`

## Database Schema

The delete endpoint handles these tables in order:

```sql
sessions (user_id → users.id)
entitlements (user_id → users.id)
email_codes (email → users.email)
auth_codes (email → users.email)  -- legacy, may not exist
users (primary table)
```

### Why This Order Matters

SQLite enforces foreign key constraints. Child records (sessions, entitlements) must be deleted before the parent (users), otherwise you get constraint violation errors.

## Usage

1. **List Users**: Page automatically fetches all users on load
2. **Search**: Type in the search box to filter by email or ID
3. **Delete**:
   - Click "DELETE" button
   - Click "CONFIRM" to execute (or × to cancel)
   - User is removed atomically with all related data
   - Success toast shows deleted email

## Best Practices

### For Development
- Use `DEV_ADMIN_EMAILS` even in dev to practice good security habits
- Test deletion with various account states (free, pro, with sessions, etc.)

### For Staging/Pre-Production
- Always set `ALLOW_DEV_ADMIN=true` explicitly
- **Always set `DEV_ADMIN_EMAILS`** to a restricted list
- Never leave enabled in production

### For Production
- **Never set `ALLOW_DEV_ADMIN=true`**
- Frontend route won't even be registered
- Backend returns 404 if somehow accessed

## Alternative: Soft Delete

If you don't want to permanently delete users, consider implementing soft delete instead:

1. Add `deleted_at` column to users table:
   ```sql
   ALTER TABLE users ADD COLUMN deleted_at TEXT;
   ```

2. Modify delete endpoint to set timestamp instead of deleting:
   ```typescript
   await env.DB.prepare('UPDATE users SET deleted_at = ?1 WHERE id = ?2')
     .bind(new Date().toISOString(), userId)
     .run()
   ```

3. Filter deleted users in all queries:
   ```sql
   WHERE deleted_at IS NULL
   ```

This avoids FK headaches and allows user recovery if needed.

## Troubleshooting

### "Failed to fetch users"
- Check that backend endpoints are accessible at `/api/dev-admin/users`
- Verify you're logged in (check `/api/account/me`)
- Check browser console for detailed error

### "Forbidden" (403)
- Your email is not in `DEV_ADMIN_EMAILS` allowlist
- Add your email to the environment variable and restart dev server

### "Not found" (404)
- `ALLOW_DEV_ADMIN` is not set (required outside of dev mode)
- Or `NODE_ENV` is set to "production"

### Foreign Key Constraint Errors
- Should not happen with current implementation
- If you see these, check that all tables referencing `users` are included in deletion order
- Query schema to find missing FKs:
  ```sql
  SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';
  ```

## Files Changed

### Created
- `functions/api/dev-admin/_guard.ts` - Authorization guard
- `functions/api/dev-admin/users.ts` - List users endpoint (GET)
- `functions/api/dev-admin/users/[userId].ts` - Delete user endpoint (DELETE)
- `src/app/pages/DevAdminPage.tsx` - Frontend UI component

### Modified
- `src/App.tsx` - Added dev-only route for `/app/dev-admin`

## Security Considerations

⚠️ **This is a destructive admin tool**

- Deletions are permanent and atomic
- No undo functionality
- No audit trail (consider adding one for production-like environments)
- Access logs only in console (consider persisting for compliance)

### Production Safeguards

The multi-layered approach ensures this never runs in production:

1. Frontend route guard: `import.meta.env.DEV`
2. Backend environment guard: `NODE_ENV !== "production" || ALLOW_DEV_ADMIN=true`
3. Authentication requirement
4. Optional email allowlist

Even if someone bypasses frontend, backend will reject in production.
