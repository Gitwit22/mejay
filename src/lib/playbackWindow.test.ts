import { describe, expect, it } from 'vitest'

import { autoAdvanceCutoffSec, effectiveStartTimeSec } from './playbackWindow'

describe('playback window', () => {
  const settings = { nextSongStartOffset: 15, endEarlySeconds: 5 }

  it('keeps normal tracks on the user offsets', () => {
    const track = { duration: 200 }
    expect(effectiveStartTimeSec(track, settings)).toBe(15)
    expect(autoAdvanceCutoffSec(track, settings)).toBe(195)
  })

  it('leaves short tracks a playable window instead of skipping them instantly', () => {
    const track = { duration: 12 }
    const start = effectiveStartTimeSec(track, settings)
    const cutoff = autoAdvanceCutoffSec(track, settings)
    expect(start).toBe(6)
    expect(cutoff).toBe(9)
    expect(cutoff).toBeGreaterThan(start)
  })

  it('always skips detected leading silence', () => {
    expect(effectiveStartTimeSec({ duration: 200, trueStartTime: 20 }, settings)).toBe(20)
  })
})
