# Dev Admin Quick Start Guide

## 🚀 Get Started in 3 Steps

### 1. Configure Environment (Optional)

Create `.dev.vars` in your project root:

```bash
ALLOW_DEV_ADMIN=true
DEV_ADMIN_EMAILS=your-email@example.com
```

> **Note**: If you skip this, any authenticated user can access the admin panel in dev mode.

### 2. Start Development Server

```bash
npm run dev
```

Wait for the server to start at `http://localhost:5173`

### 3. Access Admin Panel

1. **Log in first**: Go to `http://localhost:5173` and authenticate
2. **Open admin panel**: Navigate to `http://localhost:5173/app/dev-admin`
3. **Done!** You can now view and delete users

## 📋 Quick Reference

### Access URL
```
http://localhost:5173/app/dev-admin
```

### Environment Variables
```bash
# .dev.vars
ALLOW_DEV_ADMIN=true                           # Enable admin (required in non-dev)
DEV_ADMIN_EMAILS=email1@ex.com,email2@ex.com  # Optional allowlist
```

### Features
- ✅ List all users with entitlements
- ✅ Search by email or user ID
- ✅ Delete users (with confirmation)
- ✅ Cascading deletes (handles FK constraints)
- ✅ Real-time feedback with toasts

### Security
- 🔒 Only works in dev mode (`import.meta.env.DEV`)
- 🔒 Requires authentication
- 🔒 Optional email allowlist
- 🔒 Returns 404 in production

## 🎯 Common Tasks

### Delete a Test User

1. Navigate to `/app/dev-admin`
2. Find the user in the list (or use search)
3. Click **DELETE** button
4. Click **CONFIRM** to proceed
5. User and all related data deleted atomically

### Allow Specific Admins

Edit `.dev.vars`:
```bash
DEV_ADMIN_EMAILS=alice@example.com,bob@example.com
```

Restart dev server for changes to take effect.

### Troubleshooting

**"Failed to fetch users"**
- Ensure you're logged in
- Check browser console for errors
- Verify dev server is running

**"Forbidden" (403)**
- Your email isn't in `DEV_ADMIN_EMAILS`
- Add it and restart dev server

**Page not found**
- Use `/app/dev-admin` not `/dev-admin`
- Ensure dev server is running

## 📖 Full Documentation

For detailed information, see:
- [DEV_ADMIN_README.md](DEV_ADMIN_README.md) - Complete setup guide
- [DEV_ADMIN_IMPLEMENTATION.md](DEV_ADMIN_IMPLEMENTATION.md) - Technical details

## ⚠️ Important

**Never enable in production!**
- Don't set `ALLOW_DEV_ADMIN=true` in production
- The route won't even exist in production builds
- Multiple safety layers prevent accidental access

**Deletions are permanent!**
- No undo functionality
- All related data is removed
- Use the confirmation step carefully

---

That's it! You now have a working dev admin panel. 🎉
