import { describe, expect, it } from 'vitest'
import { detectTrueEndTimeFromChannelData, detectTrueStartTimeFromChannelData } from './trueEndTime'

describe('trueEndTime', () => {
  it('returns duration when no trailing silence is found', () => {
    const sampleRate = 10
    const samples = new Float32Array(100).fill(0.01)
    const duration = samples.length / sampleRate

    const trueEnd = detectTrueEndTimeFromChannelData(samples, sampleRate, duration, {
      silenceThresholdDb: -55,
      minSilenceMs: 700,
      minCutBeforeEndSec: 1.5,
    })

    expect(trueEnd).toBeCloseTo(duration, 6)
  })

  it('detects sustained trailing silence and returns silence start time', () => {
    const sampleRate = 10
    const samples = new Float32Array(100).fill(0.01)
    // last 2 seconds are silence
    for (let i = 80; i < 100; i++) samples[i] = 0

    const duration = samples.length / sampleRate
    const trueEnd = detectTrueEndTimeFromChannelData(samples, sampleRate, duration, {
      silenceThresholdDb: -55,
      minSilenceMs: 700, // 7 samples
      minCutBeforeEndSec: 1.5,
    })

    expect(trueEnd).toBeCloseTo(8, 6)
  })

  it('ignores silence shorter than minSilenceMs', () => {
    const sampleRate = 10
    const samples = new Float32Array(100).fill(0.01)
    // last 0.5s are silence (5 samples)
    for (let i = 95; i < 100; i++) samples[i] = 0

    const duration = samples.length / sampleRate
    const trueEnd = detectTrueEndTimeFromChannelData(samples, sampleRate, duration, {
      silenceThresholdDb: -55,
      minSilenceMs: 700,
      minCutBeforeEndSec: 1.5,
    })

    expect(trueEnd).toBeCloseTo(duration, 6)
  })

  it('never cuts inside the last minCutBeforeEndSec', () => {
    const sampleRate = 10
    const samples = new Float32Array(100).fill(0.01)
    // last 0.2s are silence (2 samples) -> should detect with a small minSilence
    for (let i = 98; i < 100; i++) samples[i] = 0

    const duration = samples.length / sampleRate
    const trueEnd = detectTrueEndTimeFromChannelData(samples, sampleRate, duration, {
      silenceThresholdDb: -55,
      minSilenceMs: 100, // 1 sample
      minCutBeforeEndSec: 1.5,
    })

    expect(trueEnd).toBeCloseTo(duration - 1.5, 6)
  })
})

describe('trueStartTime', () => {
  it('returns 0 when no leading silence is found', () => {
    const sampleRate = 10
    const samples = new Float32Array(100).fill(0.01)
    const duration = samples.length / sampleRate

    const trueStart = detectTrueStartTimeFromChannelData(samples, sampleRate, duration, {
      silenceThresholdDb: -55,
      minSilenceMs: 700,
      minCutAfterStartSec: 0.5,
    })

    expect(trueStart).toBe(0)
  })

  it('detects sustained leading silence and returns silence end time', () => {
    const sampleRate = 10
    const samples = new Float32Array(100).fill(0.01)
    // first 2 seconds are silence
    for (let i = 0; i < 20; i++) samples[i] = 0

    const duration = samples.length / sampleRate
    const trueStart = detectTrueStartTimeFromChannelData(samples, sampleRate, duration, {
      silenceThresholdDb: -55,
      minSilenceMs: 700, // 7 samples
      minCutAfterStartSec: 0.5,
    })

    expect(trueStart).toBeCloseTo(2, 6)
  })

  it('ignores silence shorter than minSilenceMs', () => {
    const sampleRate = 10
    const samples = new Float32Array(100).fill(0.01)
    // first 0.5s are silence (5 samples) — shorter than 700ms threshold
    for (let i = 0; i < 5; i++) samples[i] = 0

    const duration = samples.length / sampleRate
    const trueStart = detectTrueStartTimeFromChannelData(samples, sampleRate, duration, {
      silenceThresholdDb: -55,
      minSilenceMs: 700,
      minCutAfterStartSec: 0.5,
    })

    expect(trueStart).toBe(0)
  })

  it('treats short silence within minCutAfterStartSec as codec padding', () => {
    const sampleRate = 10
    const samples = new Float32Array(100).fill(0.01)
    // first 0.2s are silence (2 samples) -> within the 0.5s safety margin
    for (let i = 0; i < 2; i++) samples[i] = 0

    const duration = samples.length / sampleRate
    const trueStart = detectTrueStartTimeFromChannelData(samples, sampleRate, duration, {
      silenceThresholdDb: -55,
      minSilenceMs: 100, // 1 sample
      minCutAfterStartSec: 0.5,
    })

    // Silence is within the safety margin (0.2s < 0.5s), so treat as codec padding
    expect(trueStart).toBe(0)
  })
})
