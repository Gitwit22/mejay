import {describe, expect, it} from 'vitest'

import {releaseCommandAllowed, releaseCommandTarget} from './admin-service'

describe('marketplace admin release commands', () => {
  it('maps review decisions to explicit lifecycle states', () => {
    expect(releaseCommandTarget('start_review')).toBe('UNDER_REVIEW')
    expect(releaseCommandTarget('approve')).toBe('APPROVED')
    expect(releaseCommandTarget('request_changes')).toBe('CHANGES_REQUESTED')
    expect(releaseCommandTarget('reject')).toBe('REJECTED')
  })

  it('supports publication, unpublish, and takedown transitions', () => {
    expect(releaseCommandAllowed('publish_now', 'APPROVED')).toBe(true)
    expect(releaseCommandAllowed('publish_due', 'SCHEDULED')).toBe(true)
    expect(releaseCommandAllowed('unpublish', 'LIVE')).toBe(true)
    expect(releaseCommandAllowed('takedown', 'LIVE')).toBe(true)
    expect(releaseCommandAllowed('takedown', 'SCHEDULED')).toBe(true)
    expect(releaseCommandAllowed('publish_now', 'SUBMITTED')).toBe(false)
  })
})