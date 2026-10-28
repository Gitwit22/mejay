import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {
  getProviderRelease, getReleaseChangeRequest, listProviderArtists, saveReleaseChangeRequest, submitReleaseChangeRequest, withdrawReleaseChangeRequest,
  type ProviderReleaseDetail, type ReleaseChangeRequest,
} from '@/lib/providerApi'
import ReleaseChangeRequestPage from './ReleaseChangeRequestPage'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

vi.mock('@/lib/providerApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providerApi')>(),
  getProviderRelease: vi.fn(),
  getReleaseChangeRequest: vi.fn(),
  listProviderArtists: vi.fn(),
  saveReleaseChangeRequest: vi.fn(),
  submitReleaseChangeRequest: vi.fn(),
  withdrawReleaseChangeRequest: vi.fn(),
}))

const track = {id: 'track-1', title: 'Night Drive', version_title: null, disc_number: 1, track_number: 1, duration_ms: 180000, explicit: false, language_code: 'en', primary_artist_name: 'John Blaze', isrc: 'QTA3L2600001', genre: 'House', contributors: [{name: 'Pen Writer', role: 'writer', publisherName: null}], featured_artist_ids: [], preview_start_ms: null}

function detail(status = 'LIVE'): ProviderReleaseDetail {
  return {
    release: {
      id: 'release-1', title: 'Night Drive', release_type: 'single', status, version: 9, primary_artist_id: 'artist-1', primary_artist_name: 'John Blaze',
      track_count: 1, updated_at: '2026-10-19T00:00:00.000Z', draft_step: 'review', version_title: null, label_name: null, catalog_number: null,
      genre: 'House', subgenre: null, upc: null, original_release_date: null, scheduled_release_at: null, copyright_year: 2026, copyright_holder: 'John Blaze',
      phonographic_copyright_year: 2026, phonographic_copyright_holder: 'John Blaze', additional_artists: [],
    },
    tracks: [track], assets: [], rights: [], product: null, splits: [], reviewEvents: [], prerequisites: [],
  } as ProviderReleaseDetail
}

function request(overrides: Partial<ReleaseChangeRequest> = {}): ReleaseChangeRequest {
  return {
    id: 'cr-1', release_id: 'release-1', status: 'draft', changes: {release: {}, tracks: []}, artwork_asset_id: null, audio_replacements: [],
    same_recording_required: false, same_recording_confirmed: false, review_note: null, submitted_at: null, reviewed_at: null, diff: [], ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/artist/releases/release-1/changes']}>
    <Routes><Route path="/app/artist/releases/:releaseId/changes" element={<ReleaseChangeRequestPage />} /></Routes>
  </MemoryRouter></QueryClientProvider>)
}

describe('request changes to an approved release', () => {
  beforeEach(() => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail())
    vi.mocked(listProviderArtists).mockResolvedValue([{id: 'artist-1', name: 'John Blaze'} as never])
    vi.mocked(getReleaseChangeRequest).mockReset().mockResolvedValue({request: null, sameRecordingRequired: true})
    vi.mocked(saveReleaseChangeRequest).mockReset().mockResolvedValue(request())
    vi.mocked(submitReleaseChangeRequest).mockReset().mockResolvedValue(request({status: 'submitted'}))
    vi.mocked(withdrawReleaseChangeRequest).mockReset().mockResolvedValue(request({status: 'withdrawn'}))
  })

  it('prefills current values, hides the release date once live, explains the same-song rule and submits the edits', async () => {
    renderPage()
    const title = await screen.findByLabelText('Release title')
    expect(title).toHaveValue('Night Drive')
    expect(screen.queryByText('Release date', {selector: 'h2'})).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Before release too (during pre-orders)')).not.toBeInTheDocument()
    expect(screen.getByText(/MeJay must confirm a replacement is the same song/)).toBeInTheDocument()
    fireEvent.change(title, {target: {value: 'Night Drive (Deluxe)'}})
    fireEvent.change(screen.getByLabelText('Genre', {selector: '#cr-track-genre-track-1'}), {target: {value: 'Deep House'}})
    fireEvent.click(screen.getByRole('button', {name: 'Submit changes for review'}))
    await waitFor(() => expect(submitReleaseChangeRequest).toHaveBeenCalledWith('release-1'))
    const [releaseId, input] = vi.mocked(saveReleaseChangeRequest).mock.calls[0]
    expect(releaseId).toBe('release-1')
    expect(input.release).toMatchObject({title: 'Night Drive (Deluxe)', genre: 'House', additionalArtists: []})
    expect(input.release).not.toHaveProperty('requestedReleaseAt')
    expect(input.tracks).toEqual([expect.objectContaining({trackId: 'track-1', genre: 'Deep House', credits: {featuredArtistIds: [], contributors: [{name: 'Pen Writer', role: 'writer', publisherName: null}]}})])
    expect(input.audioReplacements).toEqual([])
  })

  it('lets a scheduled release ask for previews before release, and hides the option once live', async () => {
    const scheduled = detail('SCHEDULED')
    scheduled.release.preorders_enabled = true
    scheduled.release.preview_timing = 'after_release'
    vi.mocked(getProviderRelease).mockResolvedValue(scheduled)
    renderPage()
    const before = await screen.findByLabelText('Before release too (during pre-orders)')
    expect(screen.getByLabelText('After release only')).toBeChecked()
    fireEvent.click(before)
    expect(screen.queryByText(/pre-orders are off for this release/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Save draft'}))
    await waitFor(() => expect(saveReleaseChangeRequest).toHaveBeenCalled())
    expect(vi.mocked(saveReleaseChangeRequest).mock.calls[0][1].release).toMatchObject({previewTiming: 'before_release'})
  })

  it('sends a new preview length and shows preview changes as times', async () => {
    renderPage()
    const length = await screen.findByLabelText('Preview length')
    expect(length).toHaveValue('10')
    fireEvent.change(length, {target: {value: '25'}})
    expect(screen.getByText('Previews play 25 seconds from the start you choose (minutes:seconds).')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Save draft'}))
    await waitFor(() => expect(saveReleaseChangeRequest).toHaveBeenCalled())
    expect(vi.mocked(saveReleaseChangeRequest).mock.calls[0][1].tracks).toEqual([expect.objectContaining({trackId: 'track-1', previewLengthMs: 25_000, previewStartMs: null})])
  })

  it('lists preview length and start changes in seconds and minutes', async () => {
    const diff = [
      {key: 'track.track-1.previewLengthMs', label: 'Preview length', trackId: 'track-1', trackTitle: 'Night Drive', kind: 'value' as const, before: 15_000, after: 25_000},
      {key: 'track.track-1.previewStartMs', label: 'Preview start', trackId: 'track-1', trackTitle: 'Night Drive', kind: 'value' as const, before: null, after: 65_000},
    ]
    vi.mocked(getReleaseChangeRequest).mockResolvedValue({request: request({status: 'submitted', diff}), sameRecordingRequired: false})
    renderPage()
    expect(await screen.findByText('15 seconds')).toBeInTheDocument()
    expect(screen.getByText('25 seconds')).toBeInTheDocument()
    expect(screen.getByText('Automatic')).toBeInTheDocument()
    expect(screen.getByText('1:05')).toBeInTheDocument()
  })

  it('warns that previews before release need pre-orders', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail('SCHEDULED'))
    renderPage()
    fireEvent.click(await screen.findByLabelText('Before release too (during pre-orders)'))
    expect(screen.getByText(/pre-orders are off for this release/)).toBeInTheDocument()
  })

  it('shows submitted changes with a withdraw option, and locks them once MeJay starts reviewing', async () => {
    const diff = [{key: 'release.title', label: 'Title', kind: 'value' as const, before: 'Night Drive', after: 'Night Drive (Deluxe)'}]
    vi.mocked(getReleaseChangeRequest).mockResolvedValue({request: request({status: 'submitted', diff}), sameRecordingRequired: false})
    renderPage()
    expect(await screen.findByText('Waiting for MeJay review')).toBeInTheDocument()
    expect(screen.getByText('Night Drive (Deluxe)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Release title')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Withdraw changes'}))
    await waitFor(() => expect(withdrawReleaseChangeRequest).toHaveBeenCalledWith('release-1'))
  })

  it('offers nothing to change while in review', async () => {
    vi.mocked(getReleaseChangeRequest).mockResolvedValue({request: request({status: 'in_review'}), sameRecordingRequired: false})
    renderPage()
    expect(await screen.findByText('MeJay is reviewing your changes')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Withdraw changes'})).not.toBeInTheDocument()
  })

  it('shows why the last request was rejected and lets the artist start over', async () => {
    vi.mocked(getReleaseChangeRequest).mockResolvedValue({request: request({status: 'rejected', review_note: 'Different song.'}), sameRecordingRequired: true})
    renderPage()
    expect(await screen.findByText('Different song.')).toBeInTheDocument()
    expect(screen.getByLabelText('Release title')).toBeEnabled()
  })

  it('sends releases that are not approved yet back to the wizard', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail('DRAFT'))
    renderPage()
    expect(await screen.findByText(/Change requests are for approved releases/)).toBeInTheDocument()
  })
})
