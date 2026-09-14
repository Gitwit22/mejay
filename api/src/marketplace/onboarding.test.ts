import {describe, expect, it} from 'vitest'

import {parseAccountIntent} from './onboarding'

describe('marketplace onboarding helpers', () => {
  it('defaults unknown intent to consumer', () => {
    expect(parseAccountIntent('provider')).toBe('provider')
    expect(parseAccountIntent('consumer')).toBe('consumer')
    expect(parseAccountIntent('other')).toBe('consumer')
  })
})
