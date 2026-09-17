import {z} from 'zod'

export const reportingRangeSchema = z.enum(['7d', '30d', '90d', 'ytd', 'all']).default('30d')

export type ReportingRange = z.infer<typeof reportingRangeSchema>

export type ReportingPeriod = {
  range: ReportingRange
  startAt: string | null
  endAt: string
}

export function reportingPeriod(range: ReportingRange, now = new Date()): ReportingPeriod {
  if (Number.isNaN(now.getTime())) throw new Error('A valid reporting timestamp is required')
  const endAt = now.toISOString()
  if (range === 'all') return {range, startAt: null, endAt}

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (range === 'ytd') start.setUTCMonth(0, 1)
  else start.setUTCDate(start.getUTCDate() - (Number.parseInt(range, 10) - 1))

  return {range, startAt: start.toISOString(), endAt}
}
