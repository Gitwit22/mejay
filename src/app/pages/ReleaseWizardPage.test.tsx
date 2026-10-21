import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {generateProviderIsrc, getProviderRelease, listProviderArtists, updateProviderRelease, updateProviderTrack, type ProviderReleaseDetail} from '@/lib/providerApi'
import ReleaseWizardPage from './ReleaseWizardPage'

// Radix checkboxes measure themselves; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

vi.mock('@/lib/providerApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providerApi')>(),
  getProviderRelease: vi.fn(),
  listProviderArtists: vi.fn(),
  updateProviderRelease: vi.fn(),
  generateProviderIsrc: vi.fn(),
  updateProviderTrack: vi.fn(),
}))

const track = {id: 'track-1', title: 'Night Drive', version_title: null, disc_number: 1, track_number: 1, duration_ms: 180000, explicit: false, language_code: 'en', primary_artist_name: 'John Blaze', isrc: null}

function detail(overrides: Partial<ProviderReleaseDetail> = {}): ProviderReleaseDetail {
  return {
    release: {
      id: 'release-1', title: 'Night Drive', release_type: 'single', status: 'DRAFT', version: 3, primary_artist_id: 'artist-1', primary_artist_name: 'John Blaze',
      track_count: 1, updated_at: '2026-10-19T00:00:00.000Z', draft_step: 'release-information', version_title: null, label_name: null, catalog_number: null,
      genre: null, subgenre: null, upc: null, original_release_date: null, scheduled_release_at: null, copyright_year: null, copyright_holder: null,
      phonographic_copyright_year: null, phonographic_copyright_holder: null,
    },
    tracks: [track], assets: [], rights: [], product: null, splits: [], reviewEvents: [], prerequisites: [],
    ...overrides,
  } as ProviderReleaseDetail
}

function renderStep(step: string) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/artist/releases/release-1/edit/${step}`]}>
    <Routes><Route path="/app/artist/releases/:releaseId/edit/:step" element={<ReleaseWizardPage />} /></Routes>
  </MemoryRouter></QueryClientProvider>)
}

describe('release wizard: UPC and ISRCs', () => {
  beforeEach(() => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail())
    vi.mocked(listProviderArtists).mockResolvedValue([{id: 'artist-1', name: 'John Blaze'} as never])
    vi.mocked(updateProviderRelease).mockReset().mockResolvedValue({} as never)
    vi.mocked(generateProviderIsrc).mockReset()
  })

  it('takes an existing UPC on the first page, strips spaces and blocks malformed codes', async () => {
    renderStep('release-information')
    const upc = await screen.findByLabelText('UPC (optional)')
    expect(screen.getByText(/Already released\? Enter the UPC\/EAN/)).toBeInTheDocument()
    fireEvent.change(upc, {target: {value: '12345'}})
    expect(screen.getByText('A UPC is 12 to 14 digits (numbers only).')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Save information'})).toBeDisabled()

    fireEvent.change(upc, {target: {value: '0 12345 67890 5'}})
    expect(upc).toHaveValue('012345678905')
    fireEvent.click(screen.getByRole('button', {name: 'Save information'}))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalledWith('release-1', expect.objectContaining({upc: '012345678905'})))
  })

  it('assigns a MeJay ISRC only after all three confirmations', async () => {
    vi.mocked(generateProviderIsrc).mockResolvedValue({isrc: 'QTA3L2600001'})
    renderStep('isrc')
    fireEvent.click(await screen.findByRole('button', {name: 'Assign MeJay ISRC'}))
    const confirm = screen.getByRole('button', {name: 'Assign ISRC'})
    expect(confirm).toBeDisabled()
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(3)
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[1])
    expect(confirm).toBeDisabled()
    fireEvent.click(boxes[2])
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(generateProviderIsrc).toHaveBeenCalledWith('track-1', {controlsRecording: true, neverAssignedIsrc: true, authorizeAssignment: true}))
  })

  it('shows the code instead of assign options once a track has an ISRC', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({tracks: [{...track, isrc: 'QTA3L2600001'}]}))
    renderStep('isrc')
    expect(await screen.findByText('QT-A3L-26-00001')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Assign MeJay ISRC'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Register existing ISRC'})).not.toBeInTheDocument()
  })
})

describe('release wizard: release date and pre-orders', () => {
  beforeEach(() => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail())
    vi.mocked(listProviderArtists).mockResolvedValue([{id: 'artist-1', name: 'John Blaze'} as never])
    vi.mocked(updateProviderRelease).mockReset().mockResolvedValue({} as never)
  })

  it('explains the 7-day rule, stores the chosen time in UTC with its timezone, and keeps the original date separate', async () => {
    const year = new Date().getUTCFullYear() + 1
    // Saved as 9:00 AM in Detroit (EST, UTC-5) on Jan 15 next year.
    vi.mocked(getProviderRelease).mockResolvedValue(detail({release: {...detail().release, requested_release_at: `${year}-01-15T14:00:00.000Z`, release_timezone: 'America/Detroit'}}))
    renderStep('release-information')
    expect(await screen.findByText(/Choose a release date at least 7 days from today to allow time for review and release preparation\./)).toBeInTheDocument()
    expect(screen.getByLabelText('Original release date (optional)')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: new RegExp(`Release date \\w+, January 15, ${year}`)})).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`Releases Jan 15, ${year}, 9:00 AM EST`))).toBeInTheDocument()
    expect(screen.getByText('Releases go live within a few minutes after the scheduled time.')).toBeInTheDocument()
    // Same wall time, new zone: Tokyo 9:00 AM is midnight UTC.
    fireEvent.change(screen.getByLabelText('Timezone'), {target: {value: 'Asia/Tokyo'}})
    fireEvent.click(screen.getByRole('checkbox', {name: /Enable pre-orders/}))
    fireEvent.click(screen.getByRole('button', {name: 'Save information'}))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalledWith('release-1', expect.objectContaining({
      requestedReleaseAt: `${year}-01-15T00:00:00.000Z`, releaseTimezone: 'Asia/Tokyo', preordersEnabled: true, originalReleaseDate: null,
    })))
  })

  it('warns when the saved date is less than 7 days away, and blocks past dates', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({release: {...detail().release, requested_release_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), release_timezone: 'UTC'}}))
    renderStep('release-information')
    expect(await screen.findByText('This is less than 7 days away. Pick a later date before you submit for review.')).toBeInTheDocument()
  })

  it('blocks saving a date that has already passed', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({release: {...detail().release, requested_release_at: '2020-01-01T12:00:00.000Z', release_timezone: 'UTC'}}))
    renderStep('release-information')
    expect(await screen.findByText('Choose a release date and time in the future.')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Save information'})).toBeDisabled()
  })

  it('shows the chosen date on the review step and flags one that is too close', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({release: {...detail().release, requested_release_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), release_timezone: 'America/Detroit', preorders_enabled: true}}))
    renderStep('review')
    expect(await screen.findByText(/pre-orders on/)).toBeInTheDocument()
    expect(screen.getByText(/Your release date is less than 7 days away/)).toBeInTheDocument()
  })
})

describe('release wizard: song previews', () => {
  beforeEach(() => {
    vi.mocked(listProviderArtists).mockResolvedValue([{id: 'artist-1', name: 'John Blaze'} as never])
    vi.mocked(updateProviderRelease).mockReset().mockResolvedValue({} as never)
    vi.mocked(updateProviderTrack).mockReset().mockResolvedValue({} as never)
  })

  it('lets the artist allow previews before release and saves the choice', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail())
    renderStep('release-information')
    expect(await screen.findByText(/Fans hear a 10-second clip that fades in and out/)).toBeInTheDocument()
    expect(screen.getByLabelText('After release only')).toBeChecked()
    fireEvent.click(screen.getByLabelText('Before release too (during pre-orders)'))
    expect(screen.getByText(/Turn on pre-orders above to use this/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Save information'}))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalledWith('release-1', expect.objectContaining({previewTiming: 'before_release'})))
  })

  it('takes a preview start in minutes:seconds, shows the clip status, and blocks a start too close to the end', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({tracks: [{...track, preview_start_ms: null, preview_status: 'processing'}]}))
    renderStep('track-metadata')
    const input = await screen.findByLabelText('Preview starts at')
    expect(screen.getByText('Preview being prepared')).toBeInTheDocument()
    fireEvent.change(input, {target: {value: '2:55'}})
    expect(screen.getByText('Start at least 10 seconds before the end of the song.')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Save track metadata'})).toBeDisabled()
    fireEvent.change(input, {target: {value: 'abc'}})
    expect(screen.getByText(/Use minutes:seconds/)).toBeInTheDocument()
    fireEvent.change(input, {target: {value: '1:05'}})
    fireEvent.click(screen.getByRole('button', {name: 'Save track metadata'}))
    await waitFor(() => expect(updateProviderTrack).toHaveBeenCalledWith('track-1', expect.objectContaining({previewStartMs: 65_000})))
    fireEvent.change(input, {target: {value: ''}})
    fireEvent.click(screen.getByRole('button', {name: 'Save track metadata'}))
    await waitFor(() => expect(updateProviderTrack).toHaveBeenLastCalledWith('track-1', expect.objectContaining({previewStartMs: null})))
  })
})
