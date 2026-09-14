import {describe, expect, it} from 'vitest'
import {assetSchema, isrcAssignmentSchema, productSchema, revenueSplitsSchema} from './schemas'

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
