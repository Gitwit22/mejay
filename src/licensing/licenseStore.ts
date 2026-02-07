import {create} from 'zustand'
import {createJSONStorage, persist} from 'zustand/middleware'

import {activateLicense, refreshLicense} from './licenseApi'
import {
  applyApiResultToState,
  evaluateLicense,
  type LicenseDerivedStatus,
  type PersistedLicenseState,
  validateTokenForDevice,
} from './licensePolicy'

const LICENSE_STATE_KEY = 'mejay_license_state'
const DEVICE_ID_KEY = 'mejay_device_id'

function safeLocalStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const noopStorage = {
  getItem: (_name: string) => null,
  setItem: (_name: string, _value: string) => {},
  removeItem: (_name: string) => {},
} as const

function getOrCreateDeviceId(): string {
  const storage = safeLocalStorage()
  if (storage) {
    const existing = storage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
  }

  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `dev-${Math.random().toString(16).slice(2)}-${Date.now()}`

  try {
    storage?.setItem(DEVICE_ID_KEY, id)
  } catch {
    // ignore
  }

  return id
}

type LicenseStoreState = PersistedLicenseState & {
  derivedStatus: LicenseDerivedStatus
  derivedReason: string

  activateWithKey: (key: string) => Promise<void>
  tryRefreshIfOnline: () => Promise<void>
  forceRefresh: () => Promise<void>
  clearLicense: () => void
  recompute: () => Promise<void>
}

const initialPersistedState = (): PersistedLicenseState => ({
  deviceId: getOrCreateDeviceId(),
  token: null,
  plan: null,
  activatedAt: null,
  issuedAt: null,
  expiresAt: null,
  lastSuccessfulCheckAt: null,
  lastAttemptAt: null,
})

export const useLicenseStore = create<LicenseStoreState>()(
  persist(
    (set, get) => ({
      ...initialPersistedState(),
      derivedStatus: 'FREE',
      derivedReason: '',

      recompute: async () => {
        const state = get()

        if (state.token) {
          const localOk = await validateTokenForDevice(state.token, state.deviceId)
          if (localOk.ok === false) {
            set({derivedStatus: 'INVALID', derivedReason: localOk.reason})
            return
          }

          set({
            plan: localOk.payload.plan,
            issuedAt: localOk.payload.issuedAt,
            expiresAt: localOk.payload.expiresAt,
          })
        }

        const derived = evaluateLicense(get(), Date.now())
        set({derivedStatus: derived.status, derivedReason: derived.reason})
      },

      activateWithKey: async (key) => {
        const now = Date.now()
        set({lastAttemptAt: now})
        const {deviceId} = get()
        const res = await activateLicense(key, deviceId)
        set((s) => applyApiResultToState(s, res))
        await get().recompute()
      },

      tryRefreshIfOnline: async () => {
        const {token, deviceId} = get()
        if (!token) return

        if (typeof navigator !== 'undefined' && navigator.onLine === false) return

        const now = Date.now()
        set({lastAttemptAt: now})
        const res = await refreshLicense(token, deviceId)
        set((s) => applyApiResultToState(s, res))
        await get().recompute()
      },

      forceRefresh: async () => {
        const {token, deviceId} = get()
        if (!token) throw new Error('No license to refresh')

        const now = Date.now()
        set({lastAttemptAt: now})
        const res = await refreshLicense(token, deviceId)
        set((s) => applyApiResultToState(s, res))
        await get().recompute()
      },

      clearLicense: () => {
        set((s) => ({
          ...s,
          token: null,
          plan: null,
          activatedAt: null,
          issuedAt: null,
          expiresAt: null,
          lastSuccessfulCheckAt: null,
          lastAttemptAt: null,
          derivedStatus: 'FREE',
          derivedReason: '',
        }))
      },
    }),
    {
      name: LICENSE_STATE_KEY,
      version: 1,
      partialize: (s) => ({
        deviceId: s.deviceId,
        token: s.token,
        plan: s.plan,
        activatedAt: s.activatedAt,
        issuedAt: s.issuedAt,
        expiresAt: s.expiresAt,
        lastSuccessfulCheckAt: s.lastSuccessfulCheckAt,
        lastAttemptAt: s.lastAttemptAt,
      }),
      storage: createJSONStorage(() => safeLocalStorage() ?? (noopStorage as unknown as Storage)),
      onRehydrateStorage: () => (state) => {
        // Recompute derived status after hydration.
        void state?.recompute()
      },
    },
  ),
)
