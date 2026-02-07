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
  /** When false (dev), bypass billing/checkout and unlock locally. */
  billingEnabled: boolean;
  upgradeModalOpen: boolean;
  /** Dev override (used by DevPlanSwitcher). */
  setDevPlan: (plan: Plan) => void;
  /** Runtime plan updates (should not override dev selection). */
  setRuntimePlan: (plan: Plan) => void;
  setBillingEnabled: (enabled: boolean) => void;
  clearDevOverride: () => void;
  /** Back-compat alias (treat as dev plan). */
  setPlan: (plan: Plan) => void;
  hasFeature: (feature: Feature) => boolean;
  openUpgradeModal: () => void;
  closeUpgradeModal: () => void;
}

const ACCESS_PLAN_KEY = 'mejay:accessPlan';
const BILLING_ENABLED_KEY = 'mejay:billingEnabled';

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

function readInitialBillingEnabled(): boolean {
  const raw = safeReadLocalStorage(BILLING_ENABLED_KEY);
  if (raw === null) return true;
  return raw !== 'false';
}

function readInitialAccessPlan(): Plan {
  const raw = safeReadLocalStorage(ACCESS_PLAN_KEY);
  if (raw === 'pro' || raw === 'full_program') return raw;
  return 'free';
}

export const usePlanStore = create<PlanState>((set, get) => ({
  plan: readInitialAccessPlan(),
  planSource: 'runtime',
  billingEnabled: readInitialBillingEnabled(),
  upgradeModalOpen: false,

  setDevPlan: (plan) => set({ plan, planSource: 'dev' }),

  setRuntimePlan: (plan) => {
    if (get().planSource === 'dev') return;
    set({ plan, planSource: 'runtime' });
    safeWriteLocalStorage(ACCESS_PLAN_KEY, plan);
  },

  setBillingEnabled: (enabled) => {
    safeWriteLocalStorage(BILLING_ENABLED_KEY, String(enabled));
    set({billingEnabled: enabled});

    // Dev convenience: billing off => unlock locally.
    if (!enabled) {
      set({plan: 'full_program', planSource: 'dev'});
      return;
    }

    // Billing on => return to runtime plan (from storage or free).
    const runtimePlan = readInitialAccessPlan();
    set({plan: runtimePlan, planSource: 'runtime'});
  },

  clearDevOverride: () => set({ planSource: 'runtime' }),

  setPlan: (plan) => set({ plan, planSource: 'dev' }),
  
  hasFeature: (feature) => PLAN_FEATURES[get().plan][feature],
  
  openUpgradeModal: () => set({ upgradeModalOpen: true }),
  
  closeUpgradeModal: () => set({ upgradeModalOpen: false }),
}));
