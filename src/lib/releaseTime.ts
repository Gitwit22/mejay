/**
 * Release-time helpers for the browser. The API stores UTC instants plus an IANA timezone for
 * display; these convert between that and the wall-clock time an artist types in a timezone.
 */
export const MIN_RELEASE_LEAD_DAYS = 7
export const RELEASE_LEAD_MESSAGE = 'Choose a release date at least 7 days from today to allow time for review and release preparation.'
export const SCHEDULER_NOTE = 'Releases go live within a few minutes after the scheduled time.'

const FALLBACK_TIMEZONES = ['UTC', 'America/New_York', 'America/Detroit', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Lagos', 'Asia/Tokyo', 'Australia/Sydney']

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function listTimeZones(): string[] {
  const supported = (Intl as unknown as {supportedValuesOf?: (key: string) => string[]}).supportedValuesOf
  try {
    const zones = supported ? supported('timeZone') : FALLBACK_TIMEZONES
    return zones.includes('UTC') ? zones : ['UTC', ...zones]
  } catch {
    return FALLBACK_TIMEZONES
  }
}

function zonedParts(instant: number, timeZone: string): {year: number; month: number; day: number; hour: number; minute: number; second: number} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant))
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return {year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second')}
}

/** Offset (ms) of `timeZone` from UTC at `instant`. */
function offsetAt(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000
}

/**
 * "2026-11-10T08:00" typed in `timeZone` → UTC ISO string. Handles DST: the offset is re-read at the
 * resulting instant. A wall time skipped by a spring-forward gap resolves to the later valid time.
 */
export function zonedLocalToUtcIso(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!match) return null
  const [, year, month, day, hour, minute] = match.map(Number)
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  let instant = wall - offsetAt(wall, timeZone)
  instant = wall - offsetAt(instant, timeZone)
  return new Date(instant).toISOString()
}

/** UTC ISO → "YYYY-MM-DDTHH:mm" in `timeZone`, for a datetime-local input. */
export function utcToZonedLocal(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return ''
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return ''
  const p = zonedParts(time, timeZone)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** "Mar 3, 2027, 12:00 AM EST": the same wording the API uses in emails and checkout. */
export function formatReleaseTime(iso: string | null | undefined, timeZone: string | null | undefined): string {
  if (!iso) return 'release day'
  let zone = timeZone || 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: zone})
  } catch {
    zone = 'UTC'
  }
  return new Intl.DateTimeFormat('en-US', {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short'}).format(new Date(iso))
}

/** Label used on cards, release pages, checkout and confirmations. */
export function preorderLabel(iso: string | null | undefined, timeZone: string | null | undefined): string {
  return `Pre-order · releases ${formatReleaseTime(iso, timeZone)}`
}

export function meetsReleaseLead(iso: string | null | undefined, now = Date.now()): boolean {
  if (!iso) return true
  return new Date(iso).getTime() - now >= MIN_RELEASE_LEAD_DAYS * 24 * 60 * 60 * 1000
}

export const PREORDER_CHARGE_NOTICE = "You'll be charged today. Downloads become available on release day."
export const ACCOUNT_INVITE = 'Want your music saved in one place? Create a free account to keep your purchases in your library.'

/** True for an approved, scheduled store release that is open for pre-order. */
export function isPreorder(release: {availability?: string | null}): boolean {
  return release.availability === 'preorder'
}
