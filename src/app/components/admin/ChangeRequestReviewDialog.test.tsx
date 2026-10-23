import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {commandChangeRequest, getChangeRequestReview, type ChangeRequestReview} from '@/lib/marketplaceAdminApi'
import {ChangeRequestReviewDialog} from './ChangeRequestReviewDialog'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

vi.mock('@/lib/marketplaceAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/marketplaceAdminApi')>(),
  getChangeRequestReview: vi.fn(),
  commandChangeRequest: vi.fn(),
}))

function review(overrides: Partial<ChangeRequestReview> = {}): ChangeRequestReview {
  return {
    role: 'reviewer',
    release: {id: 'release-1', title: 'Night Drive', status: 'LIVE', version: 9, scheduled_release_at: null, release_timezone: null},
    request: {
      id: 'cr-1', release_id: 'release-1', status: 'in_review', changes: {release: {}, tracks: []}, artwork_asset_id: null,
      audio_replacements: [{trackId: 'track-1', assetId: 'asset-new'}], same_recording_required: true, same_recording_confirmed: false,
      review_note: null, submitted_at: '2026-10-20T00:00:00.000Z', reviewed_at: null,
      diff: [
        {key: 'release.genre', label: 'Genre', kind: 'value', before: 'House', after: 'Deep House'},
        {key: 'track.track-1.audio', label: 'Audio', trackId: 'track-1', trackTitle: 'Night Drive', kind: 'asset', before: 'asset-old', after: 'asset-new'},
      ],
    },
    sameRecordingRequired: true,
    stale: [],
    ...overrides,
  }
}

async function openDialog() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><ChangeRequestReviewDialog changeRequestId="cr-1" title="Night Drive" /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', {name: 'Review'}))
  await screen.findByText('Deep House')
}

describe('change request review dialog', () => {
  beforeEach(() => {
    vi.mocked(getChangeRequestReview).mockReset().mockResolvedValue(review())
    vi.mocked(commandChangeRequest).mockReset().mockResolvedValue({} as never)
  })

  it('shows old → new values with both audio files, and approves only after the same-song confirmation', async () => {
    await openDialog()
    expect(screen.getByText('House')).toBeInTheDocument()
    expect(screen.getByLabelText('Current audio')).toHaveAttribute('src', expect.stringContaining('/api/marketplace-admin/assets/asset-old'))
    expect(screen.getByLabelText('New audio')).toHaveAttribute('src', expect.stringContaining('/api/marketplace-admin/assets/asset-new'))
    const approve = screen.getByRole('button', {name: 'Approve and apply'})
    expect(approve).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(approve).toBeEnabled()
    fireEvent.click(approve)
    await waitFor(() => expect(commandChangeRequest).toHaveBeenCalledWith('cr-1', {action: 'approve', confirmSameRecording: true}))
  })

  it('requires a reason to reject', async () => {
    await openDialog()
    const reject = screen.getByRole('button', {name: 'Reject'})
    expect(reject).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reason (sent to the artist)'), {target: {value: 'Different song.'}})
    fireEvent.click(reject)
    await waitFor(() => expect(commandChangeRequest).toHaveBeenCalledWith('cr-1', {action: 'reject', note: 'Different song.'}))
  })

  it('blocks approval when the release changed after submission', async () => {
    vi.mocked(getChangeRequestReview).mockResolvedValue(review({stale: ['release.genre'], sameRecordingRequired: false}))
    await openDialog()
    expect(screen.getByText(/The release changed after this request was submitted/)).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Approve and apply'})).toBeDisabled()
  })

  it('lets a reviewer start the review of a waiting request', async () => {
    vi.mocked(getChangeRequestReview).mockResolvedValue(review({request: {...review().request, status: 'submitted'}}))
    await openDialog()
    fireEvent.click(screen.getByRole('button', {name: /Start review/}))
    await waitFor(() => expect(commandChangeRequest).toHaveBeenCalledWith('cr-1', {action: 'start_review'}))
  })
})
