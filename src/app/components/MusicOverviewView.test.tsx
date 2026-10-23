import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, within} from '@testing-library/react'
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getMusicDiscovery} from '@/lib/musicDiscoveryApi'
import {listStoreReleases, type StoreRelease} from '@/lib/musicStoreApi'
import {BROWSE_PAGE_SIZE} from './BrowseAllMusic'
import LegacyStoreRedirect from './LegacyStoreRedirect'
import {MusicOverviewView} from './MusicOverviewView'

vi.mock('@/lib/musicDiscoveryApi', () => ({getMusicDiscovery: vi.fn()}))
vi.mock('@/lib/musicStoreApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/musicStoreApi')>(),
  listStoreReleases: vi.fn(),
}))

const release: StoreRelease = {
  id: 'release-1', title: 'First Light', release_type: 'single', genre: 'House',
  original_release_date: null, published_at: '2026-09-17T00:00:00Z', artist_id: 'artist-1',
  artist_name: 'Nova', artwork_asset_id: null, product_id: 'product-1', amount_minor: 999,
  currency: 'USD', purchase_available: true, track_count: 1, preview_asset_id: null,
}

function catalogRelease(index: number, overrides: Partial<StoreRelease> = {}): StoreRelease {
  return {...release, id: `catalog-${index}`, title: `Catalog Track ${index}`, product_id: `product-${index}`, ...overrides}
}

function renderDiscover(path = '/app?tab=music') {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}><MusicOverviewView /></MemoryRouter></QueryClientProvider>)
}

function browseSection() {
  return screen.getByRole('heading', {name: 'Browse All Music'}).closest('section') as HTMLElement
}

describe('MusicOverviewView', () => {
  beforeEach(() => {
    vi.mocked(getMusicDiscovery).mockResolvedValue({
      newestReleases: [release], newestSingles: [release], newestProjects: [],
      mostPurchased: [release], mostPreviewed: [release], featuredReleases: [release],
      featuredArtists: [{id: 'artist-1', name: 'Nova', slug: 'nova', artwork_asset_id: null, release_count: 1}],
    })
    vi.mocked(listStoreReleases).mockResolvedValue([release])
  })

  it('renders discovery rails and links to Purchased Music and artist pages', async () => {
    renderDiscover()

    expect(await screen.findByRole('heading', {name: 'MEJAY MUSIC'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Admin Picks'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'New This Week'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Most Purchased'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Most Previewed'})).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Purchased Music'})).toHaveAttribute('href', '/app/purchased')
    expect(screen.queryByRole('link', {name: 'Marketplace'})).not.toBeInTheDocument()
    expect(screen.getByRole('link', {name: /Nova 1 release/})).toHaveAttribute('href', '/artist/nova')
  })

  it('falls back to the catalog artist filter when a featured artist has no slug', async () => {
    vi.mocked(getMusicDiscovery).mockResolvedValue({
      newestReleases: [release], newestSingles: [], newestProjects: [], mostPurchased: [], mostPreviewed: [], featuredReleases: [],
      featuredArtists: [{id: 'artist-1', name: 'Nova', artwork_asset_id: null, release_count: 1}],
    })
    renderDiscover()

    expect(await screen.findByRole('link', {name: /Nova 1 release/})).toHaveAttribute('href', '/app?tab=music&artist=artist-1')
  })

  it('makes every live release reachable through search, genre, and pagination', async () => {
    const catalog = Array.from({length: BROWSE_PAGE_SIZE + 5}, (_, index) => catalogRelease(index))
    catalog.push(catalogRelease(999, {title: 'Deep Cut', genre: 'Techno', artist_id: 'artist-2', artist_name: 'Echo'}))
    vi.mocked(listStoreReleases).mockResolvedValue(catalog)
    renderDiscover()

    expect(await screen.findByRole('heading', {name: 'Browse All Music'})).toBeInTheDocument()
    const section = browseSection()
    expect(await within(section).findByText('Page 1 of 2')).toBeInTheDocument()
    expect(within(section).queryByText('Deep Cut')).not.toBeInTheDocument()

    fireEvent.click(within(section).getByRole('button', {name: 'Next'}))
    expect(within(section).getByText('Deep Cut')).toBeInTheDocument()
    expect(within(section).getByText('Page 2 of 2')).toBeInTheDocument()

    fireEvent.change(within(section).getByRole('textbox', {name: 'Search all music'}), {target: {value: 'deep'}})
    expect(within(section).getByText('Deep Cut')).toBeInTheDocument()
    expect(within(section).queryByText('Catalog Track 0')).not.toBeInTheDocument()
    expect(within(section).queryByText(/Page \d of/)).not.toBeInTheDocument()

    fireEvent.change(within(section).getByRole('textbox', {name: 'Search all music'}), {target: {value: ''}})
    fireEvent.click(within(section).getByRole('button', {name: 'Techno'}))
    expect(within(section).getByText('Deep Cut')).toBeInTheDocument()
    expect(within(section).queryByText('Catalog Track 0')).not.toBeInTheDocument()
  })

  it('links catalog releases to their release page for checkout', async () => {
    renderDiscover()
    expect(await screen.findByRole('heading', {name: 'Browse All Music'})).toBeInTheDocument()
    const section = browseSection()
    const links = await within(section).findAllByRole('link', {name: 'First Light'})
    expect(links[0]).toHaveAttribute('href', '/app/store/release-1')
  })

  it('applies the artist filter from the URL and lets the user clear it', async () => {
    vi.mocked(listStoreReleases).mockResolvedValue([
      release,
      catalogRelease(2, {title: 'Deep Cut', artist_id: 'artist-2', artist_name: 'Echo'}),
    ])
    renderDiscover('/app?tab=music&artist=artist-2')

    expect(await screen.findByRole('heading', {name: 'Browse All Music'})).toBeInTheDocument()
    const section = browseSection()
    expect(await within(section).findByText('Deep Cut')).toBeInTheDocument()
    expect(within(section).queryByText('First Light')).not.toBeInTheDocument()

    fireEvent.click(within(section).getByRole('button', {name: /Echo/}))
    expect(within(section).getByText('First Light')).toBeInTheDocument()
  })
})

describe('LegacyStoreRedirect', () => {
  function LocationProbe() {
    const location = useLocation()
    return <p data-testid="location">{location.pathname}{location.search}</p>
  }

  it.each([
    ['/app/store', '/app?tab=music'],
    ['/app/store?artist=artist-1', '/app?artist=artist-1&tab=music'],
  ])('redirects %s to Discover', (from, expected) => {
    render(<MemoryRouter initialEntries={[from]}><Routes><Route path="/app/store" element={<LegacyStoreRedirect />} /><Route path="/app" element={<LocationProbe />} /></Routes></MemoryRouter>)
    expect(screen.getByTestId('location')).toHaveTextContent(expected)
  })
})
