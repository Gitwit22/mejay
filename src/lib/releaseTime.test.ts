import {describe, expect, it} from 'vitest'
import {formatReleaseTime, meetsReleaseLead, preorderLabel, utcToZonedLocal, zonedLocalToUtcIso} from './releaseTime'

describe('release time conversion', () => {
  it('converts a wall time in the chosen timezone to UTC across DST', () => {
    expect(zonedLocalToUtcIso('2026-10-28T08:00', 'America/Detroit')).toBe('2026-10-28T12:00:00.000Z')
    expect(zonedLocalToUtcIso('2026-11-10T08:00', 'America/Detroit')).toBe('2026-11-10T13:00:00.000Z')
    expect(zonedLocalToUtcIso('2026-11-10T22:00', 'Asia/Tokyo')).toBe('2026-11-10T13:00:00.000Z')
    expect(zonedLocalToUtcIso('2027-01-01T00:00', 'UTC')).toBe('2027-01-01T00:00:00.000Z')
    expect(zonedLocalToUtcIso('not a date', 'UTC')).toBeNull()
  })

  it('round-trips UTC back to the wall time shown in the input', () => {
    expect(utcToZonedLocal('2026-11-10T13:00:00.000Z', 'America/Detroit')).toBe('2026-11-10T08:00')
    expect(utcToZonedLocal('2026-11-10T13:00:00.000Z', 'Asia/Tokyo')).toBe('2026-11-10T22:00')
    expect(utcToZonedLocal(null, 'UTC')).toBe('')
  })

  it('labels pre-orders with the timezone and checks the 7-day lead', () => {
    expect(formatReleaseTime('2026-11-10T13:00:00.000Z', 'America/Detroit')).toBe('Nov 10, 2026, 8:00 AM EST')
    expect(preorderLabel('2026-10-28T12:00:00.000Z', 'America/Detroit')).toBe('Pre-order · releases Oct 28, 2026, 8:00 AM EDT')
    const now = Date.parse('2026-10-21T12:00:00Z')
    expect(meetsReleaseLead('2026-10-28T12:00:00.000Z', now)).toBe(true)
    expect(meetsReleaseLead('2026-10-28T11:59:59.000Z', now)).toBe(false)
    expect(meetsReleaseLead(null, now)).toBe(true)
  })
})
