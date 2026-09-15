import {describe, expect, it} from 'vitest'
import {assetSchema, isrcAssignmentSchema, productSchema, revenueSplitsSchema, uploadInitSchema} from './schemas'

describe('marketplace upload validation', () => {
  it('accepts square high-resolution artwork', () => {
    expect(uploadInitSchema.safeParse({
      kind: 'artwork', releaseId: 'release-1', fileName: 'cover.webp', mimeType: 'image/webp',
      byteSize: 10_000_000, width: 3000, height: 3000,
    }).success).toBe(true)
  })

  it('rejects undersized, nonsquare, or oversized artwork', () => {
    expect(uploadInitSchema.safeParse({
      kind: 'artwork', releaseId: 'release-1', fileName: 'cover.jpg', mimeType: 'image/jpeg',
      byteSize: 21 * 1024 * 1024, width: 3000, height: 3001,
    }).success).toBe(false)
  })

  it('allows WAV and FLAC audio up to 500 MB', () => {
    expect(uploadInitSchema.safeParse({
      kind: 'audio', trackId: 'track-1', fileName: 'master.wav', mimeType: 'audio/wav', byteSize: 500 * 1024 * 1024,
    }).success).toBe(true)
    expect(uploadInitSchema.safeParse({
      kind: 'audio', trackId: 'track-1', fileName: 'master.mp3', mimeType: 'audio/mpeg', byteSize: 1_000,
    }).success).toBe(false)
  })
})

describe('marketplace request schemas', () => {
  it('normalizes an ISRC and supplies its source', () => {
    expect(isrcAssignmentSchema.parse({isrc: 'us-abc-26-12345'})).toEqual({
      isrc: 'USABC2612345',
      source: 'provider',
    })
  })

  it('requires exactly one valid product target', () => {
    expect(productSchema.safeParse({name: 'Release download', releaseId: 'release-1'}).success).toBe(true)
    expect(productSchema.safeParse({name: 'Invalid'}).success).toBe(false)
    expect(productSchema.safeParse({name: 'Invalid', releaseId: 'release-1', trackId: 'track-1'}).success).toBe(false)
  })

  it('keeps artwork on releases and audio on tracks', () => {
    const base = {storageKey: 'asset-key', mimeType: 'image/png', byteSize: 100}
    expect(assetSchema.safeParse({...base, kind: 'artwork', releaseId: 'release-1'}).success).toBe(true)
    expect(assetSchema.safeParse({...base, kind: 'artwork', trackId: 'track-1'}).success).toBe(false)
    expect(assetSchema.safeParse({...base, kind: 'audio', trackId: 'track-1'}).success).toBe(true)
  })

  it('requires revenue shares to total exactly 10000 basis points', () => {
    expect(revenueSplitsSchema.safeParse({entries: [
      {payeeName: 'Artist', shareBps: 7000},
      {payeeName: 'Label', shareBps: 3000},
    ]}).success).toBe(true)
    expect(revenueSplitsSchema.safeParse({entries: [{payeeName: 'Artist', shareBps: 9999}]}).success).toBe(false)
  })
})
