// Deprecated: legacy license system removed in favor of Stripe checkout.
// Kept as a stub to avoid stale editor diagnostics after folder deletion.
import {create} from 'zustand'

type LicenseState = {
  derivedStatus: 'free'
  derivedReason: string
  lastSuccessfulCheckAt: number | null
  expiresAt: number | null
  recompute: () => void
}

export const useLicenseStore = create<LicenseState>(() => ({
  derivedStatus: 'free',
  derivedReason: '',
  lastSuccessfulCheckAt: null,
  expiresAt: null,
  recompute: () => {},
}))
