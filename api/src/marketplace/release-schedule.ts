/**
 * Release-date rules shared by the draft API, submission and admin review.
 *
 * Artists choose a public release time when drafting. When they submit for review it must be at
 * least seven days away, which leaves time for review and release preparation. Releases without a
 * requested time (every release created before this rule) are unaffected.
 */
export const MIN_RELEASE_LEAD_DAYS = 7
export const MIN_RELEASE_LEAD_MS = MIN_RELEASE_LEAD_DAYS * 24 * 60 * 60 * 1000

export const RELEASE_LEAD_MESSAGE = 'Choose a release date at least 7 days from today to allow time for review and release preparation.'

/** True when `value` is an IANA timezone this runtime can format, e.g. "America/Detroit". */
export function isValidTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: value})
    return true
  } catch {
    return false
  }
}

function toTime(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

/** The submission-time problem with a requested release time, or null when it is acceptable. */
export function requestedReleaseProblem(requestedAt: string | Date | null | undefined, now = Date.now()): string | null {
  const time = toTime(requestedAt)
  if (time === null) return null
  return time - now >= MIN_RELEASE_LEAD_MS ? null : RELEASE_LEAD_MESSAGE
}

/** Whether a requested release time is still ahead of `now` (approval schedules it only then). */
export function isFutureRelease(requestedAt: string | Date | null | undefined, now = Date.now()): boolean {
  const time = toTime(requestedAt)
  return time !== null && time > now
}

/** "Mar 3, 2027, 12:00 AM EST" in the release's own timezone; used in emails and checkout copy. */
export function formatReleaseTime(value: string | Date, timeZone: string | null | undefined): string {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC'
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short',
  }).format(value instanceof Date ? value : new Date(value))
}
