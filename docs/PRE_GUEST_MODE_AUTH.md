# Pre-Guest Mode Authentication Flow

**Created:** February 14, 2026  
**Purpose:** Documentation of the authentication system before guest mode was implemented

## Overview

Before guest mode was implemented, MEJay required users to create an account and sign in before they could access the main application. This document serves as a reference for reverting back to the original authentication-required flow.

---

## Original Authentication Flow

### User Journey
1. User lands on Welcome page (`/`)
2. "Start the Party" button redirects to `/login`
3. User creates account or signs in
4. After authentication, user is redirected to `/app`
5. User can now access all app features (with free tier limits)

### Route Protection
- **Public routes:** `/`, `/about`, `/pricing`, `/terms`, `/privacy`, `/contact`
- **Protected routes:** Everything under `/app/*` required authentication
- **Auth guard location:** `src/App.tsx` in the `AppShellLayout` component

---

## Key Code Changes to Revert

### 1. App.tsx - AppShellLayout Component

**BEFORE (Auth-Required):**
```tsx
function AppShellLayout() {
  const { authStatus, loadEntitlements } = usePlanStore();

  useEffect(() => {
    if (authStatus === 'authenticated') {
      loadEntitlements();
    }
  }, [authStatus, loadEntitlements]);

  // Redirect to login if not authenticated
  if (authStatus === 'loading') {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (authStatus !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
```

**AFTER (Guest Mode Enabled):**
```tsx
function AppShellLayout() {
  const { authStatus, loadEntitlements, initializeGuestMode } = usePlanStore();

  useEffect(() => {
    if (authStatus === 'authenticated') {
      loadEntitlements();
    } else if (authStatus === 'anonymous') {
      // Initialize guest mode for anonymous users
      initializeGuestMode();
    }
  }, [authStatus, loadEntitlements, initializeGuestMode]);

  // Don't redirect anonymous users - let them use guest mode
  if (authStatus === 'loading') {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
```

### 2. Welcome Page CTA

**BEFORE:**
```tsx
// "Start the Party" redirected to login
<button
  onClick={() => setHeroTab('party')}
  className="px-8 py-4 rounded-2xl bg-gradient-to-r from-primary to-secondary text-white font-bold text-lg hover:opacity-90 transition-all shadow-xl hover:shadow-2xl"
>
  Start the Party
</button>

// In routing or navigation logic, this would lead to /login
```

**AFTER:**
```tsx
// "Start the Party" goes directly to /app
<button
  onClick={() => navigate('/app?tab=party')}
  className="px-8 py-4 rounded-2xl bg-gradient-to-r from-primary to-secondary text-white font-bold text-lg hover:opacity-90 transition-all shadow-xl hover:shadow-2xl"
>
  Start the Party
</button>
```

### 3. Checkout Flow

**BEFORE:**
```tsx
// src/lib/checkout.ts
export async function startCheckout(plan: 'pro' | 'full_program') {
  const planStore = usePlanStore.getState();
  
  if (!planStore.billingEnabled) {
    throw new Error('Billing is not enabled');
  }

  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });

  if (!response.ok) {
    throw new Error('Failed to create checkout session');
  }

  const { sessionUrl } = await response.json();
  window.location.href = sessionUrl;
}
```

**AFTER:**
```tsx
// src/lib/checkout.ts
export async function startCheckout(
  plan: 'pro' | 'full_program',
  intent?: 'trial' | 'upgrade'
) {
  const planStore = usePlanStore.getState();
  
  // Redirect guests to login with upgrade intent
  if (planStore.isGuestMode) {
    const params = new URLSearchParams({ upgrade: plan });
    window.location.href = `/login?returnTo=${encodeURIComponent(`/app?${params}`)}`;
    return;
  }

  if (!planStore.billingEnabled) {
    throw new Error('Billing is not enabled');
  }

  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, intent }),
  });

  if (!response.ok) {
    throw new Error('Failed to create checkout session');
  }

  const { sessionUrl } = await response.json();
  window.location.href = sessionUrl;
}
```

### 4. UpgradeModal Messaging

**BEFORE:**
```tsx
<h2 className="text-xl font-bold text-foreground mb-1">
  Unlock Pro Features
</h2>
<p className="text-sm text-muted-foreground">
  Pro or Full Program unlocks advanced tools
</p>

// Button text
<button>Start 3-Day Pro Trial</button>
```

**AFTER:**
```tsx
<h2 className="text-xl font-bold text-foreground mb-1">
  {isFullProgramOwner ? 'Full Program unlocked' : needsAuth ? 'Sign in for Free Trial' : 'Start Your Free Trial'}
</h2>
<p className="text-sm text-muted-foreground">
  {isFullProgramOwner
    ? 'Everything is unlocked on your account.'
    : needsAuth
      ? 'Create an account to start your 3-day free Pro trial'
      : 'Get 3 days free access to all Pro features'}
</p>

// Button text
<button>
  {needsAuth ? 'Sign in to Start Free Trial' : 'Start Free Trial'}
</button>
```

---

## PlanStore Changes

### Guest Mode State Added

**New fields added to planStore:**
```typescript
// Guest mode
isGuestMode: boolean;
guestId: string | null;

// New method
initializeGuestMode: () => void;
hasProEntitlement: () => boolean;
```

**Original planStore did NOT have:**
- `isGuestMode` field
- `guestId` field
- `initializeGuestMode()` method
- Guest mode logic in initialization
- LocalStorage guest ID tracking

### Guest Mode Initialization Logic

The `initializeGuestMode()` method should be **removed** to revert:

```typescript
initializeGuestMode: () => {
  const existingGuestId = localStorage.getItem('mejay_guest_id');
  if (existingGuestId) {
    set({ guestId: existingGuestId, isGuestMode: true });
  } else {
    const newGuestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('mejay_guest_id', newGuestId);
    set({ guestId: newGuestId, isGuestMode: true });
  }
},
```

---

## Reversion Steps

To restore the original auth-required flow:

### Step 1: Update App.tsx
Replace the `AppShellLayout` component to redirect anonymous users to `/login`:

```tsx
function AppShellLayout() {
  const { authStatus, loadEntitlements } = usePlanStore();

  useEffect(() => {
    if (authStatus === 'authenticated') {
      loadEntitlements();
    }
  }, [authStatus, loadEntitlements]);

  if (authStatus === 'loading') {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // RESTORE THIS: Redirect to login if not authenticated
  if (authStatus !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
```

### Step 2: Update WelcomePage.tsx
Change the "Start the Party" button to redirect to `/login`:

```tsx
// Instead of navigate('/app?tab=party')
onClick={() => navigate('/login')}
```

### Step 3: Simplify checkout.ts
Remove guest mode redirect logic:

```tsx
export async function startCheckout(
  plan: 'pro' | 'full_program',
  intent?: 'trial' | 'upgrade'
) {
  const planStore = usePlanStore.getState();
  
  // REMOVE guest mode check:
  // if (planStore.isGuestMode) { ... }

  if (!planStore.billingEnabled) {
    throw new Error('Billing is not enabled');
  }

  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, intent }),
  });

  if (!response.ok) {
    throw new Error('Failed to create checkout session');
  }

  const { sessionUrl } = await response.json();
  window.location.href = sessionUrl;
}
```

### Step 4: Update planStore.ts
Remove guest mode fields and logic:

```typescript
// REMOVE these fields:
isGuestMode: false,
guestId: null,

// REMOVE these methods:
initializeGuestMode: () => { ... },

// UPDATE hasProEntitlement if needed to remove guest checks
```

### Step 5: Simplify UpgradeModal.tsx
Remove `needsAuth` checks and guest-specific messaging:

```tsx
const needsAuth = isGuestMode || authStatus === 'anonymous' // REMOVE THIS

// Use simpler messaging:
<h2>Unlock Pro Features</h2>
<p>Pro or Full Program unlocks advanced tools</p>
<button>Start 3-Day Pro Trial</button>
```

### Step 6: Remove auto-checkout in Index.tsx
Remove the auto-checkout logic triggered by URL params:

```tsx
// REMOVE this useEffect:
useEffect(() => {
  const params = new URLSearchParams(location.search);
  const upgradeParam = params.get('upgrade');
  
  if (upgradeParam && authStatus === 'authenticated' && !hasTriggeredCheckout.current) {
    // ... auto-checkout logic
  }
}, [location.search, authStatus]);
```

---

## Benefits of Original Flow

### Pros (Auth-Required):
- ✅ Cleaner user tracking - all users have accounts
- ✅ No guest data management complexity
- ✅ Easier to enforce free tier limits
- ✅ Better analytics - know exactly who is using the app
- ✅ No localStorage guest ID tracking needed

### Cons (Auth-Required):
- ❌ Higher friction to entry
- ❌ Users can't "try before they buy"
- ❌ Requires email/password before seeing app
- ❌ May reduce conversion rates

---

## Benefits of Guest Mode (Current)

### Pros (Guest Mode):
- ✅ Lower friction - instant app access
- ✅ Users can try before creating account
- ✅ Better conversion potential
- ✅ Modern "try it now" UX pattern

### Cons (Guest Mode):
- ❌ More complex state management
- ❌ Guest data in localStorage
- ❌ Need to handle guest → user transition
- ❌ More code paths to test

---

## Testing Checklist for Reversion

When reverting to auth-required:

- [ ] Landing page redirects to `/login` when clicking "Start the Party"
- [ ] Cannot access `/app` routes without authentication
- [ ] Loading state shows while checking auth
- [ ] Anonymous users are redirected to `/login` with proper return URL
- [ ] Checkout works without guest mode checks
- [ ] No guest IDs stored in localStorage
- [ ] UpgradeModal shows correct messaging for unauthenticated users
- [ ] All public routes still work (`/about`, `/pricing`, etc.)
- [ ] Support pages in app mode still require auth

---

## Files Modified for Guest Mode

Reference list of files changed:

1. `src/App.tsx` - Removed auth redirect
2. `src/stores/planStore.ts` - Added guest mode state
3. `src/lib/checkout.ts` - Added guest redirect logic
4. `src/components/UpgradeModal.tsx` - Added guest messaging
5. `src/pages/Index.tsx` - Added auto-checkout after login
6. `src/app/pages/WelcomePage.tsx` - Changed CTA to go to `/app`

---

## Support

If you need to revert these changes, follow the steps above in order. Test thoroughly after each step to ensure the flow works as expected.

For questions, reference this document and the Git history around February 14, 2026.
