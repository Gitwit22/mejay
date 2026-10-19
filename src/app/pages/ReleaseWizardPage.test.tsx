import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {generateProviderIsrc, getProviderRelease, listProviderArtists, updateProviderRelease, type ProviderReleaseDetail} from '@/lib/providerApi'
import ReleaseWizardPage from './ReleaseWizardPage'

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
