/**
 * What the artist may do with a release in its current review status. The API enforces the same
 * rules; this keeps the wizard honest about them.
 * - editable: drafting, or MeJay asked for changes
 * - withdrawable: submitted and waiting; "Edit" takes it back to draft
 * - in_review: a reviewer has opened it; nothing can change until the review ends
 * - approved: accepted (approved, scheduled or live); changes go through a change request
 * - closed: rejected or taken down
 */
export type ReleaseEditState = 'editable' | 'withdrawable' | 'in_review' | 'approved' | 'closed'

const EDITABLE = new Set(['DRAFT', 'METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE', 'PRICING_COMPLETE', 'CHANGES_REQUESTED'])

export function releaseEditState(status: string): ReleaseEditState {
  if (EDITABLE.has(status)) return 'editable'
  if (status === 'SUBMITTED') return 'withdrawable'
  if (status === 'UNDER_REVIEW') return 'in_review'
  if (status === 'APPROVED' || status === 'SCHEDULED' || status === 'LIVE') return 'approved'
  return 'closed'
}
