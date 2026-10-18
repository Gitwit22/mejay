import { describe, expect, it } from 'vitest'

import { isSupportedAudioFile } from './audioFormats'

describe('isSupportedAudioFile', () => {
  it('accepts common formats even when the browser reports no or generic MIME types', () => {
    expect(isSupportedAudioFile({ name: 'song.flac', type: '' })).toBe(true)
    expect(isSupportedAudioFile({ name: 'song.ogg', type: 'application/octet-stream' })).toBe(true)
    expect(isSupportedAudioFile({ name: 'song.m4a', type: 'video/mp4' })).toBe(true)
    expect(isSupportedAudioFile({ name: 'voice', type: 'audio/webm' })).toBe(true)
  })

  it('rejects non-audio files', () => {
    expect(isSupportedAudioFile({ name: 'cover.jpg', type: 'image/jpeg' })).toBe(false)
    expect(isSupportedAudioFile({ name: 'notes.txt', type: '' })).toBe(false)
  })
})
