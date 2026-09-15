export type IsrcGenerationConfig = {
  prefix: 'QTA3L'
  countryCode: 'QT'
  registrantCode: 'A3L'
}

export function readIsrcGenerationConfig(env: NodeJS.ProcessEnv): IsrcGenerationConfig | null {
  const prefix = env.ISRC_PREFIX?.trim().toUpperCase() || ''
  const countryCode = env.ISRC_COUNTRY_CODE?.trim().toUpperCase() || ''
  const registrantCode = env.ISRC_REGISTRANT_CODE?.trim().toUpperCase() || ''
  if (!prefix && !countryCode && !registrantCode) return null
  if (prefix !== 'QTA3L' || countryCode !== 'QT' || registrantCode !== 'A3L' || prefix !== `${countryCode}${registrantCode}`) {
    throw new Error('ISRC generation requires ISRC_PREFIX=QTA3L, ISRC_COUNTRY_CODE=QT, and ISRC_REGISTRANT_CODE=A3L')
  }
  return {prefix, countryCode, registrantCode}
}

export function normalizeIsrc(value: string): string {
  return value.trim().toUpperCase().replace(/[-\s]/g, '')
}

export function formatIsrc(value: string): string {
  const canonical = normalizeIsrc(value)
  if (!/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(canonical)) return value
  return `${canonical.slice(0, 2)}-${canonical.slice(2, 5)}-${canonical.slice(5, 7)}-${canonical.slice(7)}`
}

export function buildGeneratedIsrc(prefix: 'QTA3L', assignmentYear: number, designation: number): string {
  if (!Number.isInteger(assignmentYear) || assignmentYear < 0 || assignmentYear > 99) throw new Error('Invalid ISRC assignment year')
  if (!Number.isInteger(designation) || designation < 1 || designation > 99999) throw new Error('Invalid ISRC designation')
  return `${prefix}${String(assignmentYear).padStart(2, '0')}${String(designation).padStart(5, '0')}`
}