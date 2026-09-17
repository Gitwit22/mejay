import {describe, expect, it} from 'vitest'

import {reportingPeriod, reportingRangeSchema} from './reporting-schemas'

describe('marketplace reporting ranges', () => {
  const now = new Date('2026-09-17T14:30:00.000Z')

  it('defaults to the last 30 calendar days in UTC', () => {
    expect(reportingRangeSchema.parse(undefined)).toBe('30d')
    expect(reportingPeriod('30d', now)).toEqual({
      range: '30d',
      startAt: '2026-08-19T00:00:00.000Z',
      endAt: now.toISOString(),
    })
  })

  it('supports bounded, year-to-date, and all-time periods', () => {
    expect(reportingPeriod('7d', now).startAt).toBe('2026-09-11T00:00:00.000Z')
    expect(reportingPeriod('90d', now).startAt).toBe('2026-06-20T00:00:00.000Z')
    expect(reportingPeriod('ytd', now).startAt).toBe('2026-01-01T00:00:00.000Z')
    expect(reportingPeriod('all', now).startAt).toBeNull()
  })

  it('rejects unsupported ranges', () => {
    expect(reportingRangeSchema.safeParse('weekly').success).toBe(false)
  })
})
