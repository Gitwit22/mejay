import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {createProviderPricing, generateProviderIsrc, getMarketplacePricingPolicy, getProviderRelease, getReleaseCertification, listProviderArtists, replaceProviderSplits, replaceTrackCredits, updateProviderRelease, updateProviderTrack, withdrawProviderRelease, type ProviderReleaseDetail, type ReleaseCertificationState} from '@/lib/providerApi'
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
  withdrawProviderRelease: vi.fn(),
  getReleaseCertification: vi.fn(),
  replaceTrackCredits: vi.fn(),
  createProviderPricing: vi.fn(),
  getMarketplacePricingPolicy: vi.fn(),
  replaceProviderSplits: vi.fn(),
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

/** A complete certification response, like the API's; any step that reaches Rights Certification can render it. */
function certification(overrides: Partial<ReleaseCertificationState> = {}): ReleaseCertificationState {
  return {
    version: 'v', policy: 'MeJay accepts original music.', statements: [], requiredKeys: [], tracksWithoutIsrc: 0, rightsStatus: 'NOT_CERTIFIED',
    thirdPartyMaterial: null, draft: null, materials: [], problems: ['rights certification'], history: [], ...overrides,
  }
}

// Each test starts from a complete certification response, so one test's override never leaks into the next.
beforeEach(() => {
  vi.mocked(getReleaseCertification).mockReset().mockResolvedValue(certification())
})

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
    expect(await screen.findByText(/Fans hear a short clip that fades in and out/)).toBeInTheDocument()
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

  it('picks the preview section on the real song, keeping the start field and save in step', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({tracks: [{...track, preview_start_ms: 60_000, preview_length_ms: 15_000, listen_asset_id: 'mp3-1'}]}))
    renderStep('track-metadata')
    const section = await screen.findByRole('slider', {name: 'Preview section of Night Drive'})
    expect(document.querySelector('audio')).toHaveAttribute('src', expect.stringContaining('/api/marketplace/assets/mp3-1/audio'))
    fireEvent.keyDown(section, {key: 'ArrowRight', shiftKey: true})
    expect(screen.getByLabelText('Preview starts at')).toHaveValue('1:05')
    expect(section).toHaveAttribute('aria-valuetext', 'Preview 1:05 to 1:20')
    // Typing still works and moves the section.
    fireEvent.change(screen.getByLabelText('Preview starts at'), {target: {value: '2:00'}})
    expect(section).toHaveAttribute('aria-valuetext', 'Preview 2:00 to 2:15')
    fireEvent.click(screen.getByRole('button', {name: 'Save track metadata'}))
    await waitFor(() => expect(updateProviderTrack).toHaveBeenCalledWith('track-1', expect.objectContaining({previewStartMs: 120_000, previewLengthMs: 15_000})))
  })

  it('shows no picker until the song is uploaded', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({tracks: [{...track, listen_asset_id: null}]}))
    renderStep('track-metadata')
    await screen.findByLabelText('Preview starts at')
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('lets the artist choose 5 to 30 seconds of preview, checking the start against that length', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({tracks: [{...track, preview_start_ms: 160_000, preview_length_ms: 15_000}]}))
    renderStep('track-metadata')
    const length = await screen.findByLabelText('Preview length')
    expect(length).toHaveValue('15')
    expect([...(length as HTMLSelectElement).options].map((option) => option.value)).toEqual(Array.from({length: 26}, (_, index) => String(index + 5)))
    expect(screen.getByText(/Fans hear 15 seconds from this point/)).toBeInTheDocument()
    fireEvent.change(length, {target: {value: '30'}})
    expect(screen.getByText('Start at least 30 seconds before the end of the song.')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Save track metadata'})).toBeDisabled()
    fireEvent.change(length, {target: {value: '20'}})
    fireEvent.click(screen.getByRole('button', {name: 'Save track metadata'}))
    await waitFor(() => expect(updateProviderTrack).toHaveBeenCalledWith('track-1', expect.objectContaining({previewStartMs: 160_000, previewLengthMs: 20_000})))
  })
})

describe('release wizard: additional artists', () => {
  beforeEach(() => {
    vi.mocked(listProviderArtists).mockResolvedValue([{id: 'artist-1', name: 'John Blaze'}, {id: 'artist-2', name: 'Kay'}] as never)
    vi.mocked(updateProviderRelease).mockReset().mockResolvedValue({} as never)
  })

  it('adds a featured guest not on MeJay and another primary artist, previews the credit and saves both', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({release: {...detail().release, title: 'MIA ft Boldy James'}}))
    renderStep('release-information')
    expect(await screen.findByText(/Add featured artists under Additional artists instead of in the title/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Release title'), {target: {value: 'MIA'}})
    expect(screen.queryByText(/instead of in the title/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Add featured artist'}))
    // An empty name blocks saving until it is filled or removed.
    expect(screen.getByRole('button', {name: 'Save information'})).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Artist 1 name'), {target: {value: 'Boldy James'}})

    fireEvent.click(screen.getByRole('button', {name: 'Add primary artist'}))
    await waitFor(() => expect(screen.getByLabelText('Artist 2')).toHaveTextContent('Kay'))
    fireEvent.change(screen.getByLabelText('Artist 2'), {target: {value: 'artist-2'}})
    expect(screen.getByText('John Blaze & Kay feat. Boldy James')).toBeInTheDocument()
    // The lead artist is never offered again.
    expect(screen.getByLabelText('Artist 2')).not.toHaveTextContent('John Blaze')

    fireEvent.click(screen.getByRole('button', {name: 'Save information'}))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalledWith('release-1', expect.objectContaining({
      title: 'MIA',
      additionalArtists: [{role: 'featured', artistId: null, name: 'Boldy James'}, {role: 'primary', artistId: 'artist-2', name: 'Kay'}],
    })))
  })

  it('loads saved credits, switches a role and removes one', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({release: {...detail().release, additional_artists: [
      {role: 'featured', artist_id: null, name: 'Boldy James'}, {role: 'featured', artist_id: 'artist-2', name: 'Kay'},
    ]}}))
    renderStep('release-information')
    expect(await screen.findByText('John Blaze feat. Boldy James & Kay')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('radio', {name: 'Primary'})[1])
    expect(screen.getByText('John Blaze & Kay feat. Boldy James')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Remove artist 1'}))
    expect(screen.getByText('John Blaze & Kay')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Save information'}))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalledWith('release-1', expect.objectContaining({
      additionalArtists: [{role: 'primary', artistId: 'artist-2', name: 'Kay'}],
    })))
  })
})

describe('release wizard: locked while in review', () => {
  beforeEach(() => {
    vi.mocked(listProviderArtists).mockResolvedValue([{id: 'artist-1', name: 'John Blaze'} as never])
    vi.mocked(updateProviderRelease).mockReset()
    vi.mocked(withdrawProviderRelease).mockReset().mockResolvedValue({} as never)
  })

  const locked = (status: string) => vi.mocked(getProviderRelease).mockResolvedValue(detail({release: {...detail().release, status}}))

  it('locks every field of a submitted release and unlocks it only through Edit → confirm', async () => {
    locked('SUBMITTED')
    renderStep('release-information')
    expect(await screen.findByText('Waiting for MeJay review')).toBeInTheDocument()
    expect(screen.getByLabelText('Release title')).toBeDisabled()
    expect(screen.getByLabelText('UPC (optional)')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', {name: 'Edit'}))
    expect(await screen.findByText(/takes your release out of the review queue/)).toBeInTheDocument()
    expect(withdrawProviderRelease).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {name: 'Unlock and edit'}))
    await waitFor(() => expect(withdrawProviderRelease).toHaveBeenCalledWith('release-1', 3))
    expect(updateProviderRelease).not.toHaveBeenCalled()
  })

  it('offers no way to edit while MeJay is reviewing', async () => {
    locked('UNDER_REVIEW')
    renderStep('track-metadata')
    expect(await screen.findByText('MeJay is reviewing this release')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Edit'})).not.toBeInTheDocument()
    for (const input of screen.getAllByDisplayValue('Night Drive')) expect(input).toBeDisabled()
    expect(screen.getByRole('button', {name: 'Save track metadata'})).toBeDisabled()
  })

  it('sends approved releases to a change request instead of editing in place', async () => {
    locked('LIVE')
    renderStep('release-information')
    expect(await screen.findByText('Approved: changes need MeJay approval')).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Request changes'})).toHaveAttribute('href', '/app/artist/releases/release-1/changes')
    expect(screen.getByLabelText('Release title')).toBeDisabled()
  })

  it('reminds the artist to confirm the certification again after an edit', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail())
    vi.mocked(getReleaseCertification).mockResolvedValue(certification({
      history: [{id: 'cert-1', certification_version: 'v', third_party_material: 'none', rights_status: 'CERTIFIED_ORIGINAL', certified_at: '2026-10-22T00:00:00.000Z'}],
      previous: {version: 'v', thirdPartyMaterial: 'none', accepted: [], certifiedAt: '2026-10-22T00:00:00.000Z'},
    }))
    renderStep('release-information')
    expect(await screen.findByText('Confirm the rights certification again before you resubmit.')).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Go to certification'})).toHaveAttribute('href', '/app/artist/releases/release-1/edit/certification')
  })
})

describe('release wizard: remaining submission requirements', () => {
  beforeEach(() => {
    vi.mocked(listProviderArtists).mockResolvedValue([{id: 'artist-1', name: 'John Blaze'} as never])
  })

  it('lists what is left under the disabled Submit button, linking to the step that fixes it', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({prerequisites: ['active release product priced at least $0.99 USD', 'completed Stripe payout setup']}))
    renderStep('review')
    const submit = await screen.findByRole('button', {name: 'Submit to MEJay Review'})
    expect(submit).toBeDisabled()
    const remaining = screen.getByRole('region', {name: 'Remaining requirements'})
    // The list sits below the button so it is where the artist looks when Submit is greyed out.
    expect(submit.compareDocumentPosition(remaining) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(remaining).toHaveTextContent('active release product priced at least $0.99 USD')
    expect(screen.getByRole('link', {name: 'Go to Pricing'})).toHaveAttribute('href', '/app/artist/releases/release-1/edit/pricing')
    // Stripe setup happens outside the wizard, so it is listed without a misleading step link.
    expect(remaining).toHaveTextContent('completed Stripe payout setup')
    expect(screen.getAllByRole('link', {name: /^Go to /})).toHaveLength(1)
  })

  it('shows the ready message and no requirements list once everything is complete', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({prerequisites: []}))
    renderStep('review')
    expect(await screen.findByText('All submission requirements are complete')).toBeInTheDocument()
    expect(screen.queryByRole('region', {name: 'Remaining requirements'})).not.toBeInTheDocument()
  })
})

describe('release wizard: Save and continue saves what is on screen', () => {
  beforeEach(() => {
    vi.mocked(listProviderArtists).mockResolvedValue([{id: 'artist-1', name: 'John Blaze'} as never])
    vi.mocked(getProviderRelease).mockReset().mockResolvedValue(detail())
    vi.mocked(updateProviderRelease).mockReset().mockResolvedValue({} as never)
    vi.mocked(updateProviderTrack).mockReset().mockResolvedValue({} as never)
    vi.mocked(replaceTrackCredits).mockReset().mockResolvedValue({} as never)
    vi.mocked(createProviderPricing).mockReset().mockResolvedValue({} as never)
    vi.mocked(replaceProviderSplits).mockReset().mockResolvedValue({} as never)
    vi.mocked(getMarketplacePricingPolicy).mockResolvedValue({minimumPriceMinor: 99, platformFeeBps: 1000} as never)
  })

  it('saves typed songwriter credits before moving on (they used to be dropped)', async () => {
    renderStep('credits')
    fireEvent.click(await screen.findByRole('button', {name: 'Add contributor'}))
    fireEvent.change(screen.getByLabelText('Contributor name'), {target: {value: 'James Clay Jones'}})
    fireEvent.click(screen.getByRole('button', {name: /Save and continue/}))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalledWith('release-1', expect.objectContaining({draftStep: 'isrc'})))
    expect(replaceTrackCredits).toHaveBeenCalledWith('track-1', {featuredArtistIds: [], contributors: [{name: 'James Clay Jones', role: 'writer', publisherName: null}]})
    expect(vi.mocked(replaceTrackCredits).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(updateProviderRelease).mock.invocationCallOrder[0])
  })

  it('does not re-save credits that are already saved', async () => {
    vi.mocked(getProviderRelease).mockResolvedValue(detail({tracks: [{...track, contributors: [{name: 'John Steele', role: 'writer', publisherName: null}], featured_artist_ids: []}] as never}))
    renderStep('credits')
    fireEvent.click(await screen.findByRole('button', {name: /Save and continue/}))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalled())
    expect(replaceTrackCredits).not.toHaveBeenCalled()
  })

  it('stays on the step and explains why when the unsaved edit cannot be saved', async () => {
    vi.mocked(replaceTrackCredits).mockRejectedValue(new Error('Credits could not be saved'))
    renderStep('credits')
    fireEvent.click(await screen.findByRole('button', {name: 'Add contributor'}))
    fireEvent.change(screen.getByLabelText('Contributor name'), {target: {value: 'James Clay Jones'}})
    fireEvent.click(screen.getByRole('button', {name: /Save and continue/}))
    expect((await screen.findAllByText('Credits could not be saved')).length).toBeGreaterThan(0)
    expect(updateProviderRelease).not.toHaveBeenCalled()
  })

  it('saves the pre-filled minimum price instead of leaving the release unpriced', async () => {
    renderStep('pricing')
    await waitFor(() => expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(0.99))
    fireEvent.click(screen.getByRole('button', {name: /Save and continue/}))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalledWith('release-1', expect.objectContaining({draftStep: 'splits'})))
    expect(createProviderPricing).toHaveBeenCalledWith('release-1', 'Night Drive', 99)
  })

  it('refuses to continue past a price below the minimum', async () => {
    renderStep('pricing')
    await waitFor(() => expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(0.99))
    fireEvent.change(screen.getAllByRole('spinbutton')[0], {target: {value: '0.50'}})
    fireEvent.click(screen.getByRole('button', {name: /Save and continue/}))
    expect(await screen.findByText('The price for the release must be at least $0.99 USD.')).toBeInTheDocument()
    expect(createProviderPricing).not.toHaveBeenCalled()
    expect(updateProviderRelease).not.toHaveBeenCalled()
  })

  it('saves edited track metadata', async () => {
    renderStep('track-metadata')
    const title = await screen.findByDisplayValue('Night Drive')
    fireEvent.change(title, {target: {value: 'Night Drive (Remix)'}})
    fireEvent.click(screen.getByRole('button', {name: /Save and continue/}))
    await waitFor(() => expect(updateProviderTrack).toHaveBeenCalledWith('track-1', expect.objectContaining({title: 'Night Drive (Remix)'})))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalled())
  })

  it('saves the split payee shown on the Splits step', async () => {
    renderStep('splits')
    await screen.findByDisplayValue('John Blaze')
    fireEvent.click(screen.getByRole('button', {name: /Save and continue/}))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalled())
    expect(replaceProviderSplits).toHaveBeenCalledWith('track-1', [{payeeName: 'John Blaze', role: 'rights_holder', shareBps: 10000}])
  })

  it('saves edited release information and advances from the newly saved version', async () => {
    let version = 3
    vi.mocked(getProviderRelease).mockImplementation(async () => detail({release: {...detail().release, version}}))
    vi.mocked(updateProviderRelease).mockImplementation(async () => {version += 1; return {} as never})
    renderStep('release-information')
    fireEvent.change(await screen.findByLabelText('Release title'), {target: {value: 'MIA'}})
    fireEvent.click(screen.getByRole('button', {name: /Save and continue/}))
    await waitFor(() => expect(updateProviderRelease).toHaveBeenCalledTimes(2))
    expect(updateProviderRelease).toHaveBeenNthCalledWith(1, 'release-1', expect.objectContaining({title: 'MIA', expectedVersion: 3, draftStep: 'release-information'}))
    expect(updateProviderRelease).toHaveBeenNthCalledWith(2, 'release-1', expect.objectContaining({expectedVersion: 4, draftStep: 'artwork'}))
  })
})
