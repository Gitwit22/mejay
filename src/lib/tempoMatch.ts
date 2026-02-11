export type TempoInterpretation = 'normal' | 'half' | 'double'

export type TempoMatchZone = 'green' | 'yellow' | 'orange' | 'red'

// Used to make cap-edge comparisons deterministic.
// Percent values are user-facing; treat them as precise to 0.0001%.
export const TEMPO_CAP_ROUND_DECIMALS = 4
export const TEMPO_CAP_EPS_PCT = 1e-6

export const DEFAULT_MAX_TEMPO_PERCENT = 8

/**
 * Resolves a max-tempo setting into **percent units**.
 *
 * Supports legacy/accidental ratio-like values (e.g. 0.08 meaning 8%).
 */
export function resolveMaxTempoPercent(raw?: number, fallbackPct: number = DEFAULT_MAX_TEMPO_PERCENT): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallbackPct
  if (n > 0 && n <= 1) return n * 100
  return n
}

export function normalizeTempoPct(value: number): number {
  const v = Number.isFinite(value) ? value : Infinity
  const factor = Math.pow(10, TEMPO_CAP_ROUND_DECIMALS)
  return Math.round(v * factor) / factor
}

export function isOverTempoCap(requiredPct: number, capPct: number): boolean {
  const required = normalizeTempoPct(requiredPct)
  const cap = normalizeTempoPct(capPct)
  return (required - cap) > TEMPO_CAP_EPS_PCT
}

export type TempoCapVariant = 'disabled' | 'over_cap' | 'near_cap' | 'under_cap'

/**
 * Shared cap logic for UI + transition planning.
 * All values are percent units (cap is normalized from settings).
 */
export function getTempoCapDecision(args: {
  tempoControlEnabled: boolean
  tempoMode: 'auto' | 'locked' | 'original'
  requiredShiftPct: number
  rawMaxTempoPercent?: number
  nearCapFraction?: number
}): {
  capPctUsed: number
  overCap: boolean
  willTempoMatch: boolean
  nearCap: boolean
  variant: TempoCapVariant
} {
  const capPctUsed = Math.max(0, Math.min(100, resolveMaxTempoPercent(args.rawMaxTempoPercent, DEFAULT_MAX_TEMPO_PERCENT)))
  const nearCapFraction = Number.isFinite(args.nearCapFraction) ? (args.nearCapFraction as number) : 0.8

  if (!args.tempoControlEnabled) {
    return {
      capPctUsed,
      overCap: false,
      willTempoMatch: false,
      nearCap: false,
      variant: 'disabled',
    }
  }

  // In Party Queue UI, only Auto mode is subject to the safety cap.
  if (args.tempoMode !== 'auto') {
    return {
      capPctUsed,
      overCap: false,
      willTempoMatch: true,
      nearCap: false,
      variant: 'under_cap',
    }
  }

  const overCap = isOverTempoCap(args.requiredShiftPct, capPctUsed)
  const willTempoMatch = !overCap
  const nearCap = willTempoMatch && capPctUsed > 0 && args.requiredShiftPct >= capPctUsed * nearCapFraction

  return {
    capPctUsed,
    overCap,
    willTempoMatch,
    nearCap,
    variant: overCap ? 'over_cap' : (nearCap ? 'near_cap' : 'under_cap'),
  }
}

const DEFAULT_MIN_BPM = 40
const DEFAULT_MAX_BPM = 400

const getCandidates = (baseBpm: number): Array<{ bpm: number; interpretation: TempoInterpretation }> => {
  const base = Number.isFinite(baseBpm) && baseBpm > 0 ? baseBpm : 0
  if (!base) return []

  const candidates: Array<{ bpm: number; interpretation: TempoInterpretation }> = [
    { bpm: base, interpretation: 'normal' },
    { bpm: base * 0.5, interpretation: 'half' },
    { bpm: base * 2, interpretation: 'double' },
  ]

  return candidates.filter((c) =>
    Number.isFinite(c.bpm) && c.bpm > 0 && c.bpm >= DEFAULT_MIN_BPM && c.bpm <= DEFAULT_MAX_BPM
  )
}

export function computeTempoShiftInfo(baseBpm: number, targetBpm: number): {
  requiredShiftPct: number
  idealRatio: number
  interpretation: TempoInterpretation
  interpretedBaseBpm: number
} {
  const base = Number.isFinite(baseBpm) && baseBpm > 0 ? baseBpm : 0
  const target = Number.isFinite(targetBpm) && targetBpm > 0 ? targetBpm : 0
  if (!base || !target) {
    return {
      requiredShiftPct: Infinity,
      idealRatio: 1,
      interpretation: 'normal',
      interpretedBaseBpm: base || 0,
    }
  }

  const candidates = getCandidates(base)
  if (candidates.length === 0) {
    const idealRatio = target / base
    return {
      requiredShiftPct: Math.abs(idealRatio - 1) * 100,
      idealRatio,
      interpretation: 'normal',
      interpretedBaseBpm: base,
    }
  }

  let best = {
    requiredShiftPct: Infinity,
    idealRatio: 1,
    interpretation: 'normal' as TempoInterpretation,
    interpretedBaseBpm: base,
  }

  for (const c of candidates) {
    const idealRatio = target / c.bpm
    const pct = Math.abs(idealRatio - 1) * 100
    if (pct < best.requiredShiftPct) {
      best = {
        requiredShiftPct: pct,
        idealRatio,
        interpretation: c.interpretation,
        interpretedBaseBpm: c.bpm,
      }
    }
  }

  return best
}

export function computeRequiredTempoShiftPercent(baseBpm: number, targetBpm: number): number {
  return computeTempoShiftInfo(baseBpm, targetBpm).requiredShiftPct
}

export function computeTempoMatchZone(shiftPct: number): TempoMatchZone {
  const pct = Number.isFinite(shiftPct) ? Math.max(0, shiftPct) : Infinity
  if (pct <= 6) return 'green'
  if (pct <= 10) return 'yellow'
  if (pct <= 15) return 'orange'
  return 'red'
}

export function getTempoZoneClasses(zone: TempoMatchZone): string {
  switch (zone) {
    case 'green':
      return 'bg-emerald-500/80 ring-emerald-500/30'
    case 'yellow':
      return 'bg-yellow-500/80 ring-yellow-500/30'
    case 'orange':
      return 'bg-orange-500/80 ring-orange-500/30'
    case 'red':
    default:
      return 'bg-rose-500/80 ring-rose-500/30'
  }
}
