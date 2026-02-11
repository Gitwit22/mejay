import { describe, expect, it } from 'vitest'
import { computeRequiredTempoShiftPercent, computeTempoMatchZone, computeTempoShiftInfo, getTempoCapDecision } from './tempoMatch'

describe('tempoMatch', () => {
  it('treats half/double tempo as valid interpretation', () => {
    // 65 BPM track can be interpreted as 130 BPM in double-time.
    const info = computeTempoShiftInfo(65, 130)
    expect(info.requiredShiftPct).toBeLessThan(0.001)
    expect(info.interpretation).toBe('double')

    // 140 BPM target vs 70 BPM can be half-time.
    const pct = computeRequiredTempoShiftPercent(70, 140)
    expect(pct).toBeLessThan(0.001)
  })

  it('classifies match zones by required percent shift', () => {
    expect(computeTempoMatchZone(0)).toBe('green')
    expect(computeTempoMatchZone(6)).toBe('green')
    expect(computeTempoMatchZone(7)).toBe('yellow')
    expect(computeTempoMatchZone(10)).toBe('yellow')
    expect(computeTempoMatchZone(12)).toBe('orange')
    expect(computeTempoMatchZone(15)).toBe('orange')
    expect(computeTempoMatchZone(16)).toBe('red')
  })

  it('cap decisions: exact cap allowed; epsilon over is over_cap', () => {
    const atCap = getTempoCapDecision({
      tempoControlEnabled: true,
      tempoMode: 'auto',
      requiredShiftPct: 8,
      rawMaxTempoPercent: 8,
    })
    expect(atCap.overCap).toBe(false)
    expect(atCap.willTempoMatch).toBe(true)
    expect(atCap.variant).not.toBe('over_cap')

    const over = getTempoCapDecision({
      tempoControlEnabled: true,
      tempoMode: 'auto',
      requiredShiftPct: 8.0001,
      rawMaxTempoPercent: 8,
    })
    expect(over.overCap).toBe(true)
    expect(over.willTempoMatch).toBe(false)
    expect(over.variant).toBe('over_cap')
  })

  it('cap decisions: tempoControl disabled => disabled variant', () => {
    const disabled = getTempoCapDecision({
      tempoControlEnabled: false,
      tempoMode: 'auto',
      requiredShiftPct: 5,
      rawMaxTempoPercent: 8,
    })
    expect(disabled.variant).toBe('disabled')
  })
})
