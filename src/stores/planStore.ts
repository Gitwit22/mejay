import { create } from 'zustand';

export type Plan = 'free' | 'pro' | 'full_program';
export type PlanSource = 'runtime' | 'dev';

export type Feature = 'autoVolume' | 'advancedMixTiming' | 'tempoControl';

const PLAN_FEATURES: Record<Plan, Record<Feature, boolean>> = {
  free: {
    autoVolume: false,
    advancedMixTiming: false,
    tempoControl: false,
  },
  pro: {
    autoVolume: true,
    advancedMixTiming: true,
    tempoControl: true,
  },
  full_program: {
    autoVolume: true,
    advancedMixTiming: true,
    tempoControl: true,
  },
};

interface PlanState {
  plan: Plan;
  planSource: PlanSource;
  /** Bumps whenever entitlements should be considered re-derived across subsystems. */
  entitlementsVersion: number;
  /** Server auth status (cookie session). */
  authStatus: 'unknown' | 'authenticated' | 'anonymous';
  user: {id: string; email: string} | null;
  /** Guest mode: allows using /app without server auth. */
  isGuestMode: boolean;
  guestId: string | null;
  initializeGuestMode: () => void;
  /** Optimistically mark auth state after a successful auth API call. */
  markAuthenticated: (user?: {id?: string; email?: string} | null) => void;
  /** Allows entering /app without a server session (dev/demo only). */
  authBypassEnabled: boolean;
  /** Whether UI is allowed to toggle auth bypass at runtime. */
  canToggleAuthBypass: boolean;
  setAuthBypassEnabled: (enabled: boolean) => void;
  /** When false (dev), bypass billing/checkout and unlock locally. */
  billingEnabled: boolean;
  upgradeModalOpen: boolean;
  /** Stripe customer id used to refresh entitlements from the server (D1). */
  stripeCustomerId: string | null;
  /** Stripe subscription status for Pro gating. */
  subscriptionStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | null;
  /** Dev override (used by DevPlanSwitcher). */
  setDevPlan: (plan: Plan) => void;
  /** Runtime plan updates (should not override dev selection). */
  setRuntimePlan: (plan: Plan) => void;
  setBillingEnabled: (enabled: boolean) => void;
  /** Re-reads persisted billing/plan state and reapplies gating rules. */
  refreshFromStorage: (opts?: {emit?: boolean; reason?: string}) => void;
  /** Server-authoritative refresh (D1). Falls back to refreshFromStorage() when unreachable. */
  refreshFromServer: (opts?: {reason?: string}) => Promise<boolean>;
  /** Single-writer path to apply entitlements payloads. */
  applyEntitlements: (payload: {
    accessType: 'free' | 'pro' | 'full_program'
    hasFullAccess: boolean
    stripeCustomerId?: string
    subscriptionStatus?: string
    source: 'server' | 'stripe' | 'storage'
    reason?: string
  }) => void;
  /** Emits a single entitlements-changed event for subsystems. */
  notifyEntitlementsChanged: (reason?: string) => void;
  clearDevOverride: () => void;
  /** Back-compat alias (treat as dev plan). */
  setPlan: (plan: Plan) => void;
  hasFeature: (feature: Feature) => boolean;
  /** Check if user has active Pro entitlement (active or trialing subscription). */
  hasProEntitlement: () => boolean;
  openUpgradeModal: () => void;
  closeUpgradeModal: () => void;
}

const ACCESS_PLAN_KEY = 'mejay:accessPlan';
const BILLING_ENABLED_KEY = 'mejay:billingEnabled';
const STRIPE_CUSTOMER_ID_KEY = 'mejay:stripeCustomerId';
const AUTH_BYPASS_KEY = 'mejay:authBypassEnabled';
const GUEST_ID_KEY = 'mejay:guestId';

const ENTITLEMENTS_CHANNEL = 'mejay' as const;
const TAB_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(16).slice(2)}-${Date.now()}`;

export const ENTITLEMENTS_CHANGED_EVENT = 'entitlements:changed' as const;

function safeReadLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeRemoveLocalStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

function readInitialBillingEnabled(): boolean {
  const raw = safeReadLocalStorage(BILLING_ENABLED_KEY);
  if (raw === null) return true;
  return raw !== 'false';
}

function isLocalHostRuntime(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const host = window.location.hostname
    return host === '127.0.0.1' || host === 'localhost'
  } catch {
    return false
  }
}

function parseEnvBool(raw: unknown): boolean {
  return raw === '1' || raw === 'true' || raw === true
}

function canToggleAuthBypassRuntime(): boolean {
  // Default: allow toggling in dev. In production, require explicit opt-in.
  if (import.meta.env.DEV) return true
  return parseEnvBool(import.meta.env.VITE_AUTH_BYPASS_TOGGLE)
}

function readInitialAuthBypassEnabled(): boolean {
  // Explicit build-time flags.
  if (parseEnvBool(import.meta.env.VITE_AUTH_BYPASS)) return true
  if (import.meta.env.DEV && parseEnvBool(import.meta.env.VITE_DEV_BYPASS_AUTH)) return true

  // Optional persisted toggle (dev by default; prod only if VITE_AUTH_BYPASS_TOGGLE=1).
  if (!canToggleAuthBypassRuntime()) return false
  const raw = safeReadLocalStorage(AUTH_BYPASS_KEY)
  return raw === 'true'
}

function getBypassUser(): {id: string; email: string} {
  return {id: 'auth-bypass', email: 'bypass@mejay.local'}
}

const INITIAL_AUTH_BYPASS_ENABLED = readInitialAuthBypassEnabled()
const INITIAL_CAN_TOGGLE_AUTH_BYPASS = canToggleAuthBypassRuntime()

function readInitialAccessPlan(): Plan {
  const raw = safeReadLocalStorage(ACCESS_PLAN_KEY);
  if (raw === 'pro' || raw === 'full_program') return raw;
  return 'free';
}

function readInitialStripeCustomerId(): string | null {
  const raw = safeReadLocalStorage(STRIPE_CUSTOMER_ID_KEY)
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed
}

function readInitialGuestId(): string | null {
  return safeReadLocalStorage(GUEST_ID_KEY)
}

function generateGuestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeServerAccessType(raw: unknown, hasFullAccess: boolean): Plan {
  if (!hasFullAccess) return 'free'
  if (raw === 'pro') return 'pro'
  if (raw === 'full_program') return 'full_program'
  return 'free'
}

function dispatchEntitlementsChanged(detail: {
  plan: Plan
  planSource: PlanSource
  billingEnabled: boolean
  entitlementsVersion: number
  reason?: string
}): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(ENTITLEMENTS_CHANGED_EVENT, {detail}))
  } catch {
    // ignore
  }
}

function tryPostBroadcast(message: unknown): void {
  if (typeof window === 'undefined') return
  try {
    if (typeof BroadcastChannel === 'function') {
      const bc = new BroadcastChannel(ENTITLEMENTS_CHANNEL)
      bc.postMessage(message)
      bc.close()
      return
    }
  } catch {
    // ignore
  }

  // Fallback: nudge other tabs via a storage write.
  try {
    localStorage.setItem('mejay:entitlementsPing', String(Date.now()))
  } catch {
    // ignore
  }
}

// Cross-tab listener (single-writer: other tabs only request a refresh; they do not emit directly).
if (typeof window !== 'undefined') {
  try {
    if (typeof BroadcastChannel === 'function') {
      const bc = new BroadcastChannel(ENTITLEMENTS_CHANNEL)
      bc.addEventListener('message', (ev) => {
        const msg = ev.data as any
        if (!msg || msg.type !== 'entitlements_changed') return
        if (msg.sender === TAB_ID) return
        void usePlanStore
          .getState()
          .refreshFromServer({reason: 'broadcast'})
          .catch(() => {
            usePlanStore.getState().refreshFromStorage({reason: 'broadcast:fallback'})
          })
      })
    }
  } catch {
    // ignore
  }

  try {
    window.addEventListener('storage', (e) => {
      if (!e.key) return
      if (
        e.key === ACCESS_PLAN_KEY ||
        e.key === BILLING_ENABLED_KEY ||
        e.key === STRIPE_CUSTOMER_ID_KEY ||
        e.key === 'mejay:entitlementsPing'
      ) {
        void usePlanStore
          .getState()
          .refreshFromServer({reason: 'storage'})
          .catch(() => {
            usePlanStore.getState().refreshFromStorage({reason: 'storage:fallback'})
          })
      }
    })
  } catch {
    // ignore
  }
}

export const usePlanStore = create<PlanState>((set, get) => ({
  plan: readInitialAccessPlan(),
  planSource: 'runtime',
  entitlementsVersion: 0,
  authStatus: INITIAL_AUTH_BYPASS_ENABLED ? 'authenticated' : 'unknown',
  user: INITIAL_AUTH_BYPASS_ENABLED ? getBypassUser() : null,
  isGuestMode: false,
  guestId: readInitialGuestId(),
  authBypassEnabled: INITIAL_AUTH_BYPASS_ENABLED,
  canToggleAuthBypass: INITIAL_CAN_TOGGLE_AUTH_BYPASS,
  billingEnabled: readInitialBillingEnabled(),
  upgradeModalOpen: false,
  stripeCustomerId: readInitialStripeCustomerId(),
  subscriptionStatus: null,

  setAuthBypassEnabled: (enabled) => {
    // In production, only allow runtime toggling if explicitly enabled.
    if (!get().canToggleAuthBypass && enabled !== get().authBypassEnabled) return

    set({authBypassEnabled: enabled})
    if (enabled) {
      set({authStatus: 'authenticated', user: get().user ?? getBypassUser()})
      safeWriteLocalStorage(AUTH_BYPASS_KEY, 'true')
      return
    }

    safeRemoveLocalStorage(AUTH_BYPASS_KEY)
    set({authStatus: 'unknown', user: null})
    // Kick a best-effort refresh so the UI reflects real server status.
    void get()
      .refreshFromServer({reason: 'disableAuthBypass'})
      .catch(() => {
        // ignore
      })
  },

  notifyEntitlementsChanged: (reason) => {
    const nextVersion = get().entitlementsVersion + 1
    set({entitlementsVersion: nextVersion})
    const {plan, planSource, billingEnabled} = get()
    dispatchEntitlementsChanged({plan, planSource, billingEnabled, entitlementsVersion: nextVersion, reason})

    // Cross-tab propagation so upgrades don’t require reload.
    tryPostBroadcast({
      type: 'entitlements_changed',
      sender: TAB_ID,
      entitlementsVersion: nextVersion,
      reason,
    })
  },

  applyEntitlements: (payload) => {
    // Respect dev override and billing-off mode.
    if (!get().billingEnabled) return
    if (get().planSource === 'dev') return

    const nextPlan = normalizeServerAccessType(payload.accessType, payload.hasFullAccess)

    if (payload.stripeCustomerId && payload.stripeCustomerId.trim()) {
      const cid = payload.stripeCustomerId.trim()
      if (get().stripeCustomerId !== cid) {
        set({stripeCustomerId: cid})
        safeWriteLocalStorage(STRIPE_CUSTOMER_ID_KEY, cid)
      }
    }

    // Update subscription status for Pro gating
    const subStatus = payload.subscriptionStatus
    if (typeof subStatus === 'string') {
      const validStatuses = ['active', 'trialing', 'past_due', 'canceled', 'unpaid']
      if (validStatuses.includes(subStatus)) {
        set({subscriptionStatus: subStatus as any})
      }
    }

    const prev = get()
    if (prev.plan === nextPlan && prev.planSource === 'runtime') return

    set({plan: nextPlan, planSource: 'runtime'})
    safeWriteLocalStorage(ACCESS_PLAN_KEY, nextPlan)
    get().notifyEntitlementsChanged(payload.reason ?? `applyEntitlements:${payload.source}`)
  },

  refreshFromStorage: (opts) => {
    const emit = opts?.emit !== false
    const reason = opts?.reason

    // Mimic initialization + setBillingEnabled() rules.
    const billingEnabled = readInitialBillingEnabled()
    if (!billingEnabled && isLocalHostRuntime()) {
      const prev = get()
      if (prev.billingEnabled !== false || prev.plan !== 'full_program' || prev.planSource !== 'dev') {
        set({billingEnabled: false, plan: 'full_program', planSource: 'dev'})
        if (emit) get().notifyEntitlementsChanged(reason ?? 'refreshFromStorage:billingDisabled')
      }
      return
    }

    // Billing enabled => runtime plan (unless dev override still active).
    if (get().planSource === 'dev') return
    const runtimePlan = readInitialAccessPlan()
    const prev = get()
    if (prev.billingEnabled !== true || prev.plan !== runtimePlan || prev.planSource !== 'runtime') {
      set({billingEnabled: true, plan: runtimePlan, planSource: 'runtime'})
      if (emit) get().notifyEntitlementsChanged(reason ?? 'refreshFromStorage:runtime')
    }

    // Also hydrate stripe customer id cache.
    const stripeCustomerId = readInitialStripeCustomerId()
    if (stripeCustomerId && get().stripeCustomerId !== stripeCustomerId) {
      set({stripeCustomerId})
    }
  },

  refreshFromServer: async (opts) => {
    const reason = opts?.reason

    // Auth bypass: treat as logged-in for UI routing purposes.
    // Note: This does NOT create a server session.
    if (get().authBypassEnabled) {
      if (get().authStatus !== 'authenticated') {
        set({authStatus: 'authenticated', user: get().user ?? getBypassUser()})
      }
      return true
    }

    const res = await fetch('/api/account/me', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
      headers: {accept: 'application/json'},
    })

    if (res.status === 401) {
      set({authStatus: 'anonymous', user: null})
      // Guest mode: allow using app without auth
      get().initializeGuestMode()
      return false
    }

    if (!res.ok) throw new Error(`Account fetch failed (${res.status})`)

    const data = (await res.json()) as any
    if (!data?.ok) throw new Error('Account fetch failed: invalid response')

    const ent = data.entitlements as {accessType?: unknown; hasFullAccess?: unknown; subscriptionStatus?: unknown} | undefined
    const hasFullAccess = ent?.hasFullAccess === true
    const accessTypeRaw = ent?.accessType
    const accessType = accessTypeRaw === 'pro' || accessTypeRaw === 'full_program' ? accessTypeRaw : 'free'
    const subscriptionStatus = typeof ent?.subscriptionStatus === 'string' ? ent.subscriptionStatus : undefined

    const user = data.user as {id?: unknown; email?: unknown} | undefined
    if (typeof user?.id === 'string' && typeof user?.email === 'string') {
      set({authStatus: 'authenticated', user: {id: user.id, email: user.email}, isGuestMode: false})
    } else {
      set({authStatus: 'authenticated', user: null, isGuestMode: false})
    }

    // Entitlements are only meaningful when billing is enabled and there is no dev override.
    // Auth status is always hydrated regardless, so refresh doesn't force re-login.
    if (get().billingEnabled && get().planSource !== 'dev') {
      get().applyEntitlements({
        accessType: accessType as 'free' | 'pro' | 'full_program',
        hasFullAccess,
        subscriptionStatus,
        source: 'server',
        reason: reason ?? 'refreshFromServer',
      })
    }

    return true
  },

  markAuthenticated: (user) => {
    const nextUser =
      user && typeof user.email === 'string'
        ? { id: typeof user.id === 'string' ? user.id : (get().user?.id ?? 'unknown'), email: user.email }
        : get().user;
    if (get().authStatus !== 'authenticated' || nextUser !== get().user) {
      set({authStatus: 'authenticated', user: nextUser ?? null})
    }
  },

  setDevPlan: (plan) => {
    set({ plan, planSource: 'dev' })
    get().notifyEntitlementsChanged('setDevPlan')
  },

  setRuntimePlan: (plan) => {
    if (get().planSource === 'dev') return;
    set({ plan, planSource: 'runtime' });
    safeWriteLocalStorage(ACCESS_PLAN_KEY, plan);
    get().notifyEntitlementsChanged('setRuntimePlan')
  },

  setBillingEnabled: (enabled) => {
    // Security: do not allow client-side disabling of billing in production.
    if (!isLocalHostRuntime()) {
      // Still allow re-enabling (harmless) to help users recover if they toggled it in dev.
      if (!enabled) return
    }
    safeWriteLocalStorage(BILLING_ENABLED_KEY, String(enabled));
    set({billingEnabled: enabled});

    // Dev convenience: billing off => unlock locally.
    if (!enabled && isLocalHostRuntime()) {
      set({plan: 'full_program', planSource: 'dev'});
      get().notifyEntitlementsChanged('setBillingEnabled:false')
      return;
    }

    // Billing on => return to runtime plan (from storage or free).
    const runtimePlan = readInitialAccessPlan();
    set({plan: runtimePlan, planSource: 'runtime'});
    get().notifyEntitlementsChanged('setBillingEnabled:true')
  },

  clearDevOverride: () => {
    set({ planSource: 'runtime' })
    get().notifyEntitlementsChanged('clearDevOverride')
  },

  setPlan: (plan) => {
    set({ plan, planSource: 'dev' })
    get().notifyEntitlementsChanged('setPlan')
  },
  
  hasFeature: (feature) => PLAN_FEATURES[get().plan][feature],
  
  hasProEntitlement: () => {
    const state = get()
    // Dev overrides
    if (state.authBypassEnabled) return true
    if (!state.billingEnabled) return true
    if (state.planSource === 'dev' && (state.plan === 'pro' || state.plan === 'full_program')) return true
    
    // Runtime entitlements
    if (state.plan === 'full_program') return true
    if (state.plan === 'pro') {
      // Check subscription status
      const status = state.subscriptionStatus
      return status === 'active' || status === 'trialing'
    }
    return false
  },

  initializeGuestMode: () => {
    const existing = get().guestId
    const guestId = existing || generateGuestId()
    if (!existing) {
      safeWriteLocalStorage(GUEST_ID_KEY, guestId)
    }
    set({ isGuestMode: true, guestId, authStatus: 'anonymous', plan: 'free', planSource: 'runtime' })
  },
  
  openUpgradeModal: () => set({ upgradeModalOpen: true }),
  
  closeUpgradeModal: () => set({ upgradeModalOpen: false }),
}));
