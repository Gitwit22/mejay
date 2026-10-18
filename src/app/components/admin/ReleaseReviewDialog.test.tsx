import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {commandMarketplaceRelease, getReleaseReview, type ReleaseReview} from '@/lib/marketplaceAdminApi'
import {ReleaseReviewDialog} from './ReleaseReviewDialog'

vi.mock('@/lib/marketplaceAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/marketplaceAdminApi')>(),
  getReleaseReview: vi.fn(),
  commandMarketplaceRelease: vi.fn(),
}))

function review(rightsStatus: string): ReleaseReview {
  return {
    role: 'reviewer',
    release: {
      id: 'release-1', title: 'Night Drive', status: 'UNDER_REVIEW', version: 4, rights_status: rightsStatus, third_party_material: 'licensed',
      release_type: 'single', provider_name: 'Blaze Records', primary_artist_name: 'John Blaze', primary_artist_slug: 'john-blaze', artwork_asset_id: null,
      genre: 'House', subgenre: null, version_title: null, label_name: null, upc: null, original_release_date: null,
      copyright_year: 2026, copyright_holder: 'John Blaze', phonographic_copyright_year: 2026, phonographic_copyright_holder: 'John Blaze', distribution_status: 'MEJAY_EXCLUSIVE',
    },
    tracks: [{id: 'track-1', title: 'Getaway', version_title: null, track_number: 1, explicit: false, language_code: 'en', isrc: null, isrc_source: null, audio_ready: true, contributors: [{name: 'Pen Writer', role: 'writer', publisherName: 'Pen Pub'}], featured_artists: []}],
    certifications: [{id: 'cert-1', certification_version: '2026-10-v1', third_party_material: 'licensed', rights_status: rightsStatus, certified_at: '2026-10-08T00:00:00.000Z', accepted_certifications: [{key: 'original_recording', title: 'Original Recording', text: 'No unauthorized samples.'}]}],
    materials: [{id: 'mat-1', material_type: 'leased_beat', licensor_name: 'Beat Co', description: 'Lease of the instrumental', license_type: 'non_exclusive_lease', document_asset_id: 'doc-1', document_file_name: 'lease.pdf'}],
    reviewEvents: [],
    readiness: {hasMinimumPrice: true, stripeReady: true},
    warnings: [`Rights status ${rightsStatus}: clear the rights or request changes before approving`],
  }
}

async function openDialog() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><ReleaseReviewDialog releaseId="release-1" title="Night Drive" /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', {name: 'Review'}))
  await screen.findByText('Rights certification')
}

describe('release review dialog', () => {
  beforeEach(() => {
    vi.mocked(commandMarketplaceRelease).mockResolvedValue({} as never)
  })

  it('locks approval while rights need review and shows the rights documentation', async () => {
    vi.mocked(getReleaseReview).mockResolvedValue(review('RIGHTS_DOCUMENTATION_ATTACHED'))
    await openDialog()
    expect(screen.getByRole('button', {name: 'Approve'})).toBeDisabled()
    expect(screen.getByText(/Approval is locked/)).toBeInTheDocument()
    expect(screen.getByRole('link', {name: /lease\.pdf/})).toHaveAttribute('href', expect.stringContaining('/api/marketplace-admin/assets/doc-1'))
    expect(screen.getByText(/Pen Writer \(writer, Pen Pub\)/)).toBeInTheDocument()
    expect(screen.getByText('Assigned on approval')).toBeInTheDocument()

    // Clearing rights requires a note.
    fireEvent.click(screen.getByRole('button', {name: 'Clear rights'}))
    expect(commandMarketplaceRelease).not.toHaveBeenCalled()
    fireEvent.change(screen.getByPlaceholderText(/Note to the artist/), {target: {value: 'Lease verified'}})
    fireEvent.click(screen.getByRole('button', {name: 'Clear rights'}))
    await waitFor(() => expect(commandMarketplaceRelease).toHaveBeenCalledWith('release-1', {action: 'clear_rights', expectedVersion: 4, note: 'Lease verified'}))
  })

  it('allows approval once rights are cleared and can flag a rights issue', async () => {
    vi.mocked(getReleaseReview).mockResolvedValue(review('RIGHTS_CLEARED'))
    await openDialog()
    expect(screen.getByRole('button', {name: 'Approve'})).toBeEnabled()
    expect(screen.queryByRole('button', {name: 'Clear rights'})).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Note to the artist/), {target: {value: 'Sample in the hook is not cleared'}})
    fireEvent.click(screen.getByRole('button', {name: 'Flag rights issue'}))
    await waitFor(() => expect(commandMarketplaceRelease).toHaveBeenCalledWith('release-1', {action: 'flag_rights', expectedVersion: 4, note: 'Sample in the hook is not cleared'}))
  })
})
