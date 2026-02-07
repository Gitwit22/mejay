import type {LicensePlan} from './licenseToken'
import {verifyAndDecodeLicenseToken} from './licenseToken'

export type LicenseDerivedStatus =
  | 'FREE'
  | 'PRO_OK'
  | 'PRO_NEEDS_MANDATORY_CHECK'
  | 'PRO_EXPIRED'
  | 'INVALID'

export type PersistedLicenseState = {
  deviceId: string
  token: string | null
  plan: LicensePlan | null
  activatedAt: number | null
  issuedAt: number | null
  expiresAt: number | null
  lastSuccessfulCheckAt: number | null
  lastAttemptAt: number | null
}

export const MANDATORY_CHECK_MS = 30 * 24 * 60 * 60 * 1000
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000

export function getNextRequiredCheckBy(lastSuccessfulCheckAt: number | null): number | null {
  if (!lastSuccessfulCheckAt) return null
  return lastSuccessfulCheckAt + MANDATORY_CHECK_MS
}

export async function validateTokenForDevice(
  token: string,
  deviceId: string,
  now = Date.now(),
): Promise<{ok: true; payload: {plan: LicensePlan; expiresAt: number; issuedAt: number}} | {ok: false; reason: string}> {
  const decoded = await verifyAndDecodeLicenseToken(token)
  if (!decoded.ok) return decoded

  if (decoded.payload.deviceId !== deviceId) return {ok: false, reason: 'Token is for a different device'}
  if (decoded.payload.expiresAt <= now) return {ok: false, reason: 'License expired'}
  return {
    ok: true,
    payload: {
      plan: decoded.payload.plan,
      expiresAt: decoded.payload.expiresAt,
      issuedAt: decoded.payload.issuedAt,
    },
  }
}

export function evaluateLicense(state: PersistedLicenseState, now = Date.now()): {
  status: LicenseDerivedStatus
  reason: string
} {
  if (!state.token) return {status: 'FREE', reason: ''}

  // Local expiry check (fast path). Token validation is async; store will do deeper checks.
  if (state.expiresAt && state.expiresAt <= now) return {status: 'PRO_EXPIRED', reason: 'License expired'}

  // Mandatory check rules.
  if (state.lastSuccessfulCheckAt) {
    // If clock moved backwards/forwards unexpectedly, require a check.
    if (state.lastSuccessfulCheckAt > now + CLOCK_SKEW_TOLERANCE_MS) {
      return {status: 'PRO_NEEDS_MANDATORY_CHECK', reason: 'Time changed; verification required'}
    }

    const next = state.lastSuccessfulCheckAt + MANDATORY_CHECK_MS
    if (now > next) {
      return {status: 'PRO_NEEDS_MANDATORY_CHECK', reason: 'License check required'}
    }
  }

  return {status: 'PRO_OK', reason: ''}
}

export function applyApiResultToState(
  prev: PersistedLicenseState,
  api: {
    token: string
    plan: LicensePlan
    issuedAt: number
    expiresAt: number
    activatedAt: number
    lastSuccessfulCheckAt: number
  },
): PersistedLicenseState {
  return {
    ...prev,
    token: api.token,
    plan: api.plan,
    issuedAt: api.issuedAt,
    expiresAt: api.expiresAt,
    activatedAt: api.activatedAt,
    lastSuccessfulCheckAt: api.lastSuccessfulCheckAt,
  }
}

