import type {LicensePlan, LicenseTokenPayload} from './licenseToken'
import {createLicenseToken, verifyAndDecodeLicenseToken} from './licenseToken'

export type LicenseApiActivationResult = {
  token: string
  plan: LicensePlan
  issuedAt: number
  expiresAt: number
  activatedAt: number
  lastSuccessfulCheckAt: number
}

function assertOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You appear to be offline.')
  }
}

function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase()
}

function inferPlanFromKey(key: string): LicensePlan {
  // Demo rule: keys containing FULL => full_program; otherwise pro.
  return key.includes('FULL') ? 'full_program' : 'pro'
}

function validateKeyFormat(key: string): void {
  // Accept MEJAY-... or MJ-... for now.
  const ok = /^MEJAY-[A-Z0-9-]{6,}$/i.test(key) || /^MJ-[A-Z0-9-]{6,}$/i.test(key)
  if (!ok) throw new Error('Invalid license key format.')
}

export async function activateLicense(keyRaw: string, deviceId: string): Promise<LicenseApiActivationResult> {
  assertOnline()

  const key = normalizeKey(keyRaw)
  validateKeyFormat(key)

  const now = Date.now()
  const plan = inferPlanFromKey(key)

  // Demo expiry: 1 year.
  const expiresAt = now + 365 * 24 * 60 * 60 * 1000
  const payload: LicenseTokenPayload = {
    v: 1,
    deviceId,
    plan,
    issuedAt: now,
    expiresAt,
  }

  const token = await createLicenseToken(payload)
  return {
    token,
    plan,
    issuedAt: now,
    expiresAt,
    activatedAt: now,
    lastSuccessfulCheckAt: now,
  }
}

export async function refreshLicense(token: string, deviceId: string): Promise<LicenseApiActivationResult> {
  assertOnline()

  const decoded = await verifyAndDecodeLicenseToken(token)
  if (decoded.ok === false) throw new Error(decoded.reason)
  if (decoded.payload.deviceId !== deviceId) throw new Error('Token device mismatch')

  const now = Date.now()
  const payload: LicenseTokenPayload = {
    ...decoded.payload,
    issuedAt: now,
  }

  const refreshedToken = await createLicenseToken(payload)
  return {
    token: refreshedToken,
    plan: payload.plan,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    activatedAt: decoded.payload.issuedAt,
    lastSuccessfulCheckAt: now,
  }
}

