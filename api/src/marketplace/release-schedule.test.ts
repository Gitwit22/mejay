import {describe, expect, it} from 'vitest'
import {formatReleaseTime, isFutureRelease, isValidTimeZone, MIN_RELEASE_LEAD_MS, RELEASE_LEAD_MESSAGE, requestedReleaseProblem} from './release-schedule'
import {resolveDraftSchedule} from './service'
import {releaseDraftSchema} from './schemas'

const now = Date.parse('2026-10-21T12:00:00Z')

describe('release date rules', () => {
  it('accepts exactly 7 days and rejects anything shorter, measured from submission', () => {
    expect(requestedReleaseProblem(new Date(now + MIN_RELEASE_LEAD_MS).toISOString(), now)).toBeNull()
    expect(requestedReleaseProblem(new Date(now + MIN_RELEASE_LEAD_MS - 1).toISOString(), now)).toBe(RELEASE_LEAD_MESSAGE)
    expect(requestedReleaseProblem(null, now)).toBeNull()
  })

  it('compares instants, so the same moment written in different offsets is treated identically', () => {
    const boundaryUtc = new Date(now + MIN_RELEASE_LEAD_MS).toISOString()
    // 12:00Z is 08:00 in Detroit (EDT, -04:00) on Oct 28 2026.
    expect(new Date('2026-10-28T08:00:00-04:00').toISOString()).toBe(boundaryUtc)
    expect(requestedReleaseProblem('2026-10-28T08:00:00-04:00', now)).toBeNull()
    expect(requestedReleaseProblem('2026-10-28T07:59:59-04:00', now)).toBe(RELEASE_LEAD_MESSAGE)
  })

  it('formats the release time in its own timezone, including DST changes', () => {
    expect(formatReleaseTime('2026-10-28T12:00:00Z', 'America/Detroit')).toBe('Oct 28, 2026, 8:00 AM EDT')
    expect(formatReleaseTime('2026-11-10T13:00:00Z', 'America/Detroit')).toBe('Nov 10, 2026, 8:00 AM EST')
    expect(formatReleaseTime('2026-11-10T13:00:00Z', 'Asia/Tokyo')).toMatch(/^Nov 10, 2026, 10:00 PM GMT\+9$/)
    expect(formatReleaseTime('2026-11-10T13:00:00Z', 'Not/AZone')).toBe('Nov 10, 2026, 1:00 PM UTC')
  })

  it('validates IANA timezones and future dates', () => {
    expect(isValidTimeZone('America/Detroit')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isFutureRelease('2026-10-21T12:00:01Z', now)).toBe(true)
    expect(isFutureRelease('2026-10-21T12:00:00Z', now)).toBe(false)
    expect(releaseDraftSchema.shape.releaseTimezone.safeParse('Mars/Olympus').success).toBe(false)
  })
})

describe('draft release-date fields', () => {
  const stored = {requested_release_at: '2026-12-01T05:00:00.000Z', release_timezone: 'America/Detroit', preorders_enabled: true}

  it('keeps stored values when a step save omits them, and clears them on null', () => {
    expect(resolveDraftSchedule(stored, {}, now)).toEqual({requestedReleaseAt: '2026-12-01T05:00:00.000Z', releaseTimezone: 'America/Detroit', preordersEnabled: true})
    expect(resolveDraftSchedule(stored, {requestedReleaseAt: null, preordersEnabled: false}, now)).toEqual({requestedReleaseAt: null, releaseTimezone: null, preordersEnabled: false})
  })

  it('stores UTC, defaults the timezone, and refuses past dates or pre-orders without a date', () => {
    expect(resolveDraftSchedule({}, {requestedReleaseAt: '2026-12-01T00:00:00-05:00'}, now)).toEqual({requestedReleaseAt: '2026-12-01T05:00:00.000Z', releaseTimezone: 'UTC', preordersEnabled: false})
    expect(() => resolveDraftSchedule({}, {requestedReleaseAt: '2026-10-01T00:00:00Z'}, now)).toThrow(expect.objectContaining({code: 'release_date_in_past'}))
    expect(() => resolveDraftSchedule({}, {preordersEnabled: true}, now)).toThrow(expect.objectContaining({code: 'preorders_need_release_date'}))
    // An unchanged date that has since passed does not block unrelated edits; submission re-checks it.
    expect(resolveDraftSchedule(stored, {}, Date.parse('2027-01-01T00:00:00Z')).requestedReleaseAt).toBe(stored.requested_release_at)
  })
})
