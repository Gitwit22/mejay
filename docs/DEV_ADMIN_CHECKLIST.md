# Dev Admin Deployment Checklist

Use this checklist to ensure dev admin is properly configured before deploying.

## ✅ Development Setup

- [ ] `.dev.vars` created (or environment variables set)
- [ ] `ALLOW_DEV_ADMIN=true` set in dev environment
- [ ] `DEV_ADMIN_EMAILS` configured (optional but recommended)
- [ ] Dev server starts without errors
- [ ] Can access `/app/dev-admin` when logged in
- [ ] User list loads correctly
- [ ] Search functionality works
- [ ] Can delete a test user successfully
- [ ] Toast notifications appear
- [ ] No console errors

## ✅ Security Verification

- [ ] Route only accessible in development mode
- [ ] Backend returns 404 when `ALLOW_DEV_ADMIN` not set
- [ ] Cannot access without authentication
- [ ] Email allowlist blocks unauthorized users (if configured)
- [ ] `.dev.vars` is in `.gitignore`
- [ ] No sensitive data committed to git

## ✅ Code Review

- [ ] All TypeScript files compile without errors
- [ ] No hardcoded credentials or secrets
- [ ] Error handling properly implemented
- [ ] Console logs don't expose sensitive data
- [ ] Foreign key deletion order correct for your schema

## ✅ Testing

- [ ] Delete user with active sessions
- [ ] Delete user with entitlements  
- [ ] Delete user with email codes
- [ ] Delete user that doesn't exist (handles error)
- [ ] Delete while network is slow (no race conditions)
- [ ] Search with various queries
- [ ] Refresh page while on admin panel

## ✅ Documentation

- [ ] Team knows about dev admin feature
- [ ] Quick start guide available
- [ ] Security practices documented
- [ ] Environment variable requirements clear

## ✅ Production Safety

**CRITICAL: Before deploying to production**

- [ ] `ALLOW_DEV_ADMIN` is NOT set in production environment
- [ ] `NODE_ENV=production` is set in production
- [ ] Verified production build doesn't include route
- [ ] Tested that backend returns 404 in production
- [ ] Production logs don't show dev admin attempts
- [ ] Monitoring alerts configured (optional)

### Quick Production Test

After deploying to production, verify:

```bash
# Should return 404
curl https://your-production-url.com/api/dev-admin/users

# Should not have the route
# Navigate to /app/dev-admin - should 404
```

## 🚨 Production Incident Response

If dev admin is accidentally enabled in production:

### Immediate Actions

1. **Emergency disable**:
   ```bash
   # Remove or set to false
   ALLOW_DEV_ADMIN=false
   ```

2. **Redeploy immediately**:
   ```bash
   npm run build
   # Deploy to production
   ```

3. **Verify it's disabled**:
   ```bash
   curl https://your-prod-url.com/api/dev-admin/users
   # Should return 404
   ```

### Follow-up

4. **Check audit logs** (if implemented):
   - Review who accessed admin panel
   - Check what actions were taken
   - Document any data changes

5. **Notify team**:
   - Inform stakeholders
   - Document incident
   - Review how it happened

6. **Prevent recurrence**:
   - Add CI/CD check for `ALLOW_DEV_ADMIN`
   - Add deployment checklist
   - Improve environment variable management

## 📊 Monitoring (Optional)

Consider adding monitoring for:

- [ ] Admin endpoint access attempts in production
- [ ] Failed authentication on admin endpoints  
- [ ] User deletion events (count, frequency)
- [ ] Admin panel usage metrics in dev/staging

### Example Alert

```
Alert: Admin endpoint accessed in production
Severity: HIGH
Action: Immediately verify ALLOW_DEV_ADMIN setting
```

## 🔄 Regular Maintenance

### Weekly
- [ ] Review admin access logs (if implemented)
- [ ] Verify production environment variables
- [ ] Check no `.dev.vars` in git history

### Monthly  
- [ ] Review and update email allowlist
- [ ] Test dev admin functionality
- [ ] Update documentation if needed

### Per Release
- [ ] Run this checklist before each production deploy
- [ ] Verify environment variable configuration
- [ ] Test in staging first

## 📝 Sign-off

Before deploying to production, have these stakeholders sign off:

- [ ] Developer: Tested and verified
- [ ] Tech Lead: Code reviewed and approved
- [ ] DevOps: Environment variables verified
- [ ] Security: Security requirements met (if applicable)

---

**Deployment Date**: _______________  
**Deployed By**: _______________  
**Environment**: [ ] Dev [ ] Staging [ ] Production  
**All items checked**: [ ] Yes [ ] No

---

## Additional Resources

- [DEV_ADMIN_QUICKSTART.md](DEV_ADMIN_QUICKSTART.md) - Quick start guide
- [DEV_ADMIN_README.md](DEV_ADMIN_README.md) - Complete documentation
- [DEV_ADMIN_IMPLEMENTATION.md](DEV_ADMIN_IMPLEMENTATION.md) - Technical details
