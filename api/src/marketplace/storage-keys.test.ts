import {describe, expect, it} from 'vitest'
import {isMarketplaceStorageKey, MARKETPLACE_STORAGE_PREFIX} from './storage-keys'

describe('marketplace storage keys', () => {
  it('writes artist uploads under the mejay-artist/ folder', () => {
    expect(MARKETPLACE_STORAGE_PREFIX).toBe('mejay-artist/')
  })

  it('accepts new and legacy marketplace keys and nothing else in the bucket', () => {
    expect(isMarketplaceStorageKey('mejay-artist/provider-1/artwork/release-1/asset.png')).toBe(true)
    expect(isMarketplaceStorageKey('marketplace/provider-1/audio/track-1/asset.wav')).toBe(true)
    expect(isMarketplaceStorageKey('MOCK FULL PROGRAM.zip')).toBe(false)
    expect(isMarketplaceStorageKey('mejay-artistx/provider-1/a.png')).toBe(false)
    expect(isMarketplaceStorageKey('other/mejay-artist/a.png')).toBe(false)
  })
})
