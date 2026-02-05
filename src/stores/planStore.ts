import { create } from 'zustand';

export type Plan = 'free' | 'plus';

export type Feature = 'autoVolume' | 'advancedMixTiming' | 'tempoControl';

const PLAN_FEATURES: Record<Plan, Record<Feature, boolean>> = {
  free: {
    autoVolume: false,
    advancedMixTiming: false,
    tempoControl: false,
  },
  plus: {
    autoVolume: true,
    advancedMixTiming: true,
    tempoControl: true,
  },
};

interface PlanState {
  plan: Plan;
  upgradeModalOpen: boolean;
  setPlan: (plan: Plan) => void;
  hasFeature: (feature: Feature) => boolean;
  openUpgradeModal: () => void;
  closeUpgradeModal: () => void;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  plan: 'free',
  upgradeModalOpen: false,
  
  setPlan: (plan) => set({ plan }),
  
  hasFeature: (feature) => PLAN_FEATURES[get().plan][feature],
  
  openUpgradeModal: () => set({ upgradeModalOpen: true }),
  
  closeUpgradeModal: () => set({ upgradeModalOpen: false }),
}));
