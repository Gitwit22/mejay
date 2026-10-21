import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {generateProviderIsrc, getProviderRelease, listProviderArtists, updateProviderRelease, type ProviderReleaseDetail} from '@/lib/providerApi'
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
    renderStep('release-information')
    expect(await screen.findByText(/Choose a release date at least 7 days from today to allow time for review and release preparation\./)).toBeInTheDocument()
    expect(screen.getByLabelText('Original release date (optional)')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('On a date I choose'))
    const year = new Date().getUTCFullYear() + 1
    fireEvent.change(screen.getByLabelText('Release date and time'), {target: {value: `${year}-01-15T09:00`}})
    fireEvent.change(screen.getByLabelText('Timezone'), {target: {value: 'America/Detroit'}})
    expect(screen.getByText(new RegExp(`Releases Jan 15, ${year}, 9:00 AM EST`))).toBeInTheDocument()
    expect(screen.getByText('Releases go live within a few minutes after the scheduled time.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', {name: /Enable pre-orders/}))
    fireEvent.click(screen.getByRole('button', {name: 'Save information'}))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalledWith('release-1', expect.objectContaining({
      requestedReleaseAt: `${year}-01-15T14:00:00.000Z`, releaseTimezone: 'America/Detroit', preordersEnabled: true, originalReleaseDate: null,
    })))
  })

  it('warns before submission when the date is less than 7 days away, and blocks past dates', async () => {
    renderStep('release-information')
    fireEvent.click(await screen.findByLabelText('On a date I choose'))
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    const local = `${soon.getUTCFullYear()}-${String(soon.getUTCMonth() + 1).padStart(2, '0')}-${String(soon.getUTCDate()).padStart(2, '0')}T12:00`
    fireEvent.change(screen.getByLabelText('Timezone'), {target: {value: 'UTC'}})
    fireEvent.change(screen.getByLabelText('Release date and time'), {target: {value: local}})
    expect(screen.getByText('This is less than 7 days away. Pick a later date before you submit for review.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Release date and time'), {target: {value: '2020-01-01T12:00'}})
    expect(screen.getByText('Choose a release date and time in the future.')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Save information'})).toBeDisabled()
  })

  it('shows the chosen date on the review step and flags one that is too close', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({release: {...detail().release, requested_release_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), release_timezone: 'America/Detroit', preorders_enabled: true}}))
    renderStep('review')
    expect(await screen.findByText(/pre-orders on/)).toBeInTheDocument()
    expect(screen.getByText(/Your release date is less than 7 days away/)).toBeInTheDocument()
  })
})
