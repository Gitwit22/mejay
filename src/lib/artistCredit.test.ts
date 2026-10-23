import {describe, expect, it} from 'vitest'
import {formatArtistCredit, titleHasFeature} from './artistCredit'

describe('artist credit (frontend mirror)', () => {
  it('matches the API format', () => {
    expect(formatArtistCredit('John Blaze', [{role: 'primary', name: 'Kay'}, {role: 'featured', name: 'Boldy James'}])).toBe('John Blaze & Kay feat. Boldy James')
    expect(formatArtistCredit('A', [{role: 'featured', name: 'B'}, {role: 'featured', name: 'C'}, {role: 'featured', name: 'D'}])).toBe('A feat. B, C & D')
  })

  it('spots feature credits typed into a title', () => {
    expect(titleHasFeature('MIA ft Boldy James')).toBe(true)
    expect(titleHasFeature('MIA (feat. Boldy James)')).toBe(true)
    expect(titleHasFeature('Featuring Love')).toBe(false)
    expect(titleHasFeature('Left Turn')).toBe(false)
  })
})
