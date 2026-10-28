import {describe, expect, it} from 'vitest'

import {trackDraftSchema} from './schemas'
import {resolvePreviewLength, resolvePreviewStart} from './service'

const track = {title: 'Night Drive', primaryArtistId: 'artist-1', discNumber: 1, trackNumber: 1, explicit: false, instrumental: false}

describe('artist-chosen preview length', () => {
  it('accepts whole seconds from 5 to 30', () => {
    for (const previewLengthMs of [5_000, 15_000, 30_000]) expect(trackDraftSchema.safeParse({...track, previewLengthMs}).success).toBe(true)
    for (const previewLengthMs of [4_000, 31_000, 15_500, null]) expect(trackDraftSchema.safeParse({...track, previewLengthMs}).success).toBe(false)
    // Omitted keeps the stored length.
    expect(trackDraftSchema.parse(track)).not.toHaveProperty('previewLengthMs')
  })

  it('keeps the stored length when omitted', () => {
    expect(resolvePreviewLength({preview_length_ms: 15_000}, {})).toBe(15_000)
    expect(resolvePreviewLength({preview_length_ms: 15_000}, {previewLengthMs: 30_000})).toBe(30_000)
  })

  it('requires the start to leave room for the whole chosen length', () => {
    const before = {duration_ms: 200_000, preview_start_ms: 180_000, preview_length_ms: 10_000}
    expect(resolvePreviewStart(before, {previewStartMs: 185_000, previewLengthMs: 15_000})).toBe(185_000)
    expect(() => resolvePreviewStart(before, {previewStartMs: 186_000, previewLengthMs: 15_000}))
      .toThrow(expect.objectContaining({code: 'preview_start_too_late', message: expect.stringMatching(/play 15 seconds\. The latest start for this song is 3:05/)}))
    // Lengthening alone re-checks the start already saved.
    expect(() => resolvePreviewStart(before, {previewLengthMs: 30_000})).toThrow(expect.objectContaining({code: 'preview_start_too_late'}))
    expect(resolvePreviewStart(before, {})).toBe(180_000)
    expect(resolvePreviewStart(before, {previewStartMs: null, previewLengthMs: 30_000})).toBeNull()
  })
})
