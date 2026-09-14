import {describe, expect, it} from 'vitest'

import {getProviderEntryPath, getProviderStatusLabel, parseAccountIntent, parseProviderStatus} from './marketplace'

describe('marketplace helpers', () => {
  it('parses account intent safely', () => {
    expect(parseAccountIntent('provider')).toBe('provider')
    expect(parseAccountIntent('consumer')).toBe('consumer')
    expect(parseAccountIntent('anything-else')).toBe('consumer')
  })

  it('parses provider statuses safely', () => {
    expect(parseProviderStatus('approved')).toBe('approved')
    expect(parseProviderStatus('pending_review')).toBe('pending_review')
    expect(parseProviderStatus('unknown')).toBeNull()
  })

  it('chooses the right provider entry path', () => {
    expect(getProviderEntryPath(null)).toBe('/app/artist/onboarding')
    expect(getProviderEntryPath({id: 'p1', status: 'approved', role: 'owner'})).toBe('/app/artist')
    expect(getProviderEntryPath({id: 'p1', status: 'pending_review', role: 'owner'})).toBe('/app/artist/onboarding')
  })

  it('formats provider status labels', () => {
    expect(getProviderStatusLabel('needs_changes')).toBe('Needs changes')
    expect(getProviderStatusLabel(null)).toBe('Not started')
  })
})
