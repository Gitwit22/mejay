import {describe, expect, it} from 'vitest'

import {lowPassFilter} from './bpmDetector'

function naiveLowPass(data: Float32Array, sampleRate: number, startSample: number, endSample: number): Float32Array {
  const windowSize = Math.floor(sampleRate / 100)
  const length = endSample - startSample
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    const start = Math.max(0, i - windowSize)
    const end = Math.min(length - 1, i + windowSize)
    for (let j = start; j <= end; j++) sum += Math.abs(data[startSample + j])
    out[i] = sum / (end - start + 1)
  }
  return out
}

describe('lowPassFilter', () => {
  it('matches the reference moving average', () => {
    const sampleRate = 2000
    const data = new Float32Array(5000)
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / 7) * (i % 13 === 0 ? 1 : 0.3)
    const fast = lowPassFilter(data, sampleRate, 500, 4500)
    const slow = naiveLowPass(data, sampleRate, 500, 4500)
    expect(fast.length).toBe(slow.length)
    for (let i = 0; i < fast.length; i++) expect(fast[i]).toBeCloseTo(slow[i], 5)
  })

  it('handles empty ranges', () => {
    expect(lowPassFilter(new Float32Array(10), 1000, 5, 5).length).toBe(0)
  })
})
