import {describe, expect, it} from 'vitest'
import {automaticPreviewStartMs, clampPreviewStartMs, formatPreviewStart, formatReleaseTime, latestPreviewStartMs, meetsReleaseLead, parsePreviewStart, preorderLabel, utcToZonedLocal, zonedLocalToUtcIso} from './releaseTime'

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

describe('preview start input', () => {
  it('parses minutes:seconds or plain seconds, blank as automatic, and rejects anything else', () => {
    expect(parsePreviewStart('1:05')).toBe(65_000)
    expect(parsePreviewStart('0:00')).toBe(0)
    expect(parsePreviewStart('90')).toBe(90_000)
    expect(parsePreviewStart('  ')).toBeNull()
    expect(parsePreviewStart('1:75')).toBeUndefined()
    expect(parsePreviewStart('soon')).toBeUndefined()
    expect(formatPreviewStart(65_000)).toBe('1:05')
    expect(formatPreviewStart(null)).toBe('')
  })
})

describe('preview window placement', () => {
  it('starts automatic previews 0:30 in on songs of 1:30 or more, like the converter', () => {
    expect(automaticPreviewStartMs(90_000)).toBe(30_000)
    expect(automaticPreviewStartMs(89_999)).toBe(0)
  })

  it('keeps the whole window inside the song, on whole seconds', () => {
    expect(latestPreviewStartMs(200_500, 15_000)).toBe(185_000)
    expect(latestPreviewStartMs(8_000, 15_000)).toBe(0)
    expect(clampPreviewStartMs(64_400, 200_000, 15_000)).toBe(64_000)
    expect(clampPreviewStartMs(64_600, 200_000, 15_000)).toBe(65_000)
    expect(clampPreviewStartMs(-3_000, 200_000, 15_000)).toBe(0)
    expect(clampPreviewStartMs(199_000, 200_000, 15_000)).toBe(185_000)
  })
})
