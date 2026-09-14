import {describe, expect, it} from 'vitest'
import {isReleaseMutable, isReleaseTransitionAllowed} from './service'

describe('release state machine', () => {
  it('allows only adjacent provider workflow transitions', () => {
    expect(isReleaseTransitionAllowed('DRAFT', 'METADATA_COMPLETE')).toBe(true)
    expect(isReleaseTransitionAllowed('METADATA_COMPLETE', 'RIGHTS_COMPLETE')).toBe(true)
    expect(isReleaseTransitionAllowed('RIGHTS_COMPLETE', 'ISRC_COMPLETE')).toBe(true)
    expect(isReleaseTransitionAllowed('ISRC_COMPLETE', 'PRICING_COMPLETE')).toBe(true)
    expect(isReleaseTransitionAllowed('PRICING_COMPLETE', 'SUBMITTED')).toBe(true)
    expect(isReleaseTransitionAllowed('DRAFT', 'SUBMITTED')).toBe(false)
    expect(isReleaseTransitionAllowed('SUBMITTED', 'DRAFT')).toBe(false)
  })

  it('supports the approved scheduling branch', () => {
    expect(isReleaseTransitionAllowed('SUBMITTED', 'UNDER_REVIEW')).toBe(true)
    expect(isReleaseTransitionAllowed('UNDER_REVIEW', 'APPROVED')).toBe(true)
    expect(isReleaseTransitionAllowed('APPROVED', 'SCHEDULED')).toBe(true)
    expect(isReleaseTransitionAllowed('APPROVED', 'LIVE')).toBe(true)
    expect(isReleaseTransitionAllowed('SCHEDULED', 'LIVE')).toBe(true)
    expect(isReleaseTransitionAllowed('LIVE', 'APPROVED')).toBe(false)
  })

  it('locks release-owned records at submission', () => {
    expect(isReleaseMutable('DRAFT')).toBe(true)
    expect(isReleaseMutable('PRICING_COMPLETE')).toBe(true)
    expect(isReleaseMutable('SUBMITTED')).toBe(false)
    expect(isReleaseMutable('UNDER_REVIEW')).toBe(false)
    expect(isReleaseMutable('LIVE')).toBe(false)
  })
})
