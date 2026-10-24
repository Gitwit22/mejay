import {describe, expect, it} from 'vitest'

import {tidyQuote} from './storyQuote'

describe('tidyQuote', () => {
  it('leaves a plain quote alone', () => {
    expect(tidyQuote('Keep going.', 'Kairo')).toEqual({text: 'Keep going.', attribution: 'Kairo'})
  })
  it('takes the name from a trailing dash line when no attribution was entered', () => {
    expect(tidyQuote('"Keep going."\n— Kairo', null)).toEqual({text: 'Keep going.', attribution: 'Kairo'})
  })
  it('drops a same-line "— Name" that repeats the attribution', () => {
    expect(tidyQuote('“Keep going.” — Kairo', 'Kairo')).toEqual({text: 'Keep going.', attribution: 'Kairo'})
  })
  it('keeps dashes that are part of the quote', () => {
    expect(tidyQuote('Work hard - then work harder', 'Coach')).toEqual({text: 'Work hard - then work harder', attribution: 'Coach'})
  })
})
