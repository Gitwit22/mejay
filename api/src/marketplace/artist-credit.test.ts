import {describe, expect, it} from 'vitest'
import {formatArtistCredit, joinArtistNames, parseCredits} from './artist-credit'

describe('artist credit line', () => {
  it('joins primaries with "&" and lists features after "feat."', () => {
    expect(formatArtistCredit('John Blaze')).toBe('John Blaze')
    expect(formatArtistCredit('John Blaze', [{role: 'featured', name: 'Boldy James'}])).toBe('John Blaze feat. Boldy James')
    expect(formatArtistCredit('John Blaze', [{role: 'primary', name: 'Kay'}, {role: 'featured', name: 'Boldy James'}, {role: 'featured', name: 'Tee'}]))
      .toBe('John Blaze & Kay feat. Boldy James & Tee')
    expect(formatArtistCredit('A', [{role: 'primary', name: 'B'}, {role: 'primary', name: 'C'}])).toBe('A, B & C')
  })

  it('drops blanks, extra spaces and repeats', () => {
    expect(joinArtistNames([' John  Blaze ', '', null, 'john blaze', 'Kay'])).toBe('John Blaze & Kay')
    expect(formatArtistCredit('John Blaze', [{role: 'featured', name: 'John Blaze'}])).toBe('John Blaze')
    expect(formatArtistCredit(null, [{role: 'featured', name: 'Guest'}])).toBe('feat. Guest')
  })

  it('parses stored credits defensively', () => {
    expect(parseCredits('[{"role":"featured","name":"G"},{"role":"bad","name":"x"},null]')).toEqual([{role: 'featured', name: 'G'}])
    expect(parseCredits(null)).toEqual([])
  })
})
