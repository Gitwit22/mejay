import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, within} from '@testing-library/react'
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getMusicDiscovery} from '@/lib/musicDiscoveryApi'
import {listStoreReleases, type StoreRelease} from '@/lib/musicStoreApi'
import {BROWSE_PAGE_SIZE} from './BrowseAllMusic'
import LegacyStoreRedirect from './LegacyStoreRedirect'
import {MusicOverviewView} from './MusicOverviewView'
import {getStoriesHome, type StoryCard} from '@/lib/storiesApi'

vi.mock('@/lib/musicDiscoveryApi', () => ({getMusicDiscovery: vi.fn()}))
vi.mock('@/lib/storiesApi', async (importOriginal) => ({...await importOriginal<typeof import('@/lib/storiesApi')>(), getStoriesHome: vi.fn()}))
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
    vi.mocked(getStoriesHome).mockReset().mockResolvedValue({featured: null, latest: []})
  })

  it('renders discovery rails and links to Purchased Music and artist pages', async () => {
    renderDiscover()

    expect(await screen.findByRole('heading', {name: 'MEJAY MUSIC'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Admin Picks'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'New Releases'})).toBeInTheDocument()
    expect(screen.queryByRole('heading', {name: 'New This Week'})).not.toBeInTheDocument()
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

describe('Discover new releases and stories', () => {
  const project: StoreRelease = {...release, id: 'release-2', title: 'Long Night', release_type: 'album', preview_asset_id: 'clip-2'}
  const card = (slug: string, title: string): StoryCard => ({slug, template: 'headliner', title, teaser: `${title} teaser`, category: 'Stories', publishedAt: '2026-10-20T00:00:00Z', featured: false, image: null})

  beforeEach(() => {
    vi.mocked(getMusicDiscovery).mockResolvedValue({
      newestReleases: [release, project], newestSingles: [release], newestProjects: [project],
      mostPurchased: [], mostPreviewed: [], featuredReleases: [release], featuredArtists: [],
    })
    vi.mocked(listStoreReleases).mockResolvedValue([release])
    vi.mocked(getStoriesHome).mockReset().mockResolvedValue({featured: null, latest: []})
  })

  it('shows new releases in one compact section with type tabs, prices, previews and a jump to the full catalog', async () => {
    renderDiscover()
    const section = (await screen.findByRole('heading', {name: 'New Releases'})).closest('section')!
    expect(within(section).getByText('Long Night')).toBeInTheDocument()
    expect(within(section).getAllByText(/\$9\.99/).length).toBeGreaterThan(0)
    expect(within(section).getAllByRole('link', {name: /First Light/})[0]).toHaveAttribute('href', '/app/store/release-1')
    expect(within(section).getByRole('button', {name: 'Preview Long Night'})).toBeEnabled()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    fireEvent.click(within(section).getByRole('button', {name: 'View all music'}))
    expect(scrollIntoView).toHaveBeenCalled()
    fireEvent.click(within(section).getByRole('tab', {name: 'Singles'}))
    expect(within(section).queryByText('Long Night')).not.toBeInTheDocument()
  })

  it('leads with the featured story, keeps music near the top and lists more stories before the full catalog', async () => {
    vi.mocked(getStoriesHome).mockResolvedValue({
      featured: {...card('lead', 'Detroit has something to say'), featured: true},
      latest: [card('two', 'Second'), card('three', 'Third'), card('four', 'Fourth'), card('five', 'Fifth')],
    })
    renderDiscover()
    expect(await screen.findByRole('link', {name: /Detroit has something to say/})).toHaveAttribute('href', '/stories/lead')
    expect(screen.getByRole('link', {name: /Second/})).toHaveAttribute('href', '/stories/two')
    const more = screen.getByRole('heading', {name: 'More Stories'}).closest('section')!
    expect(within(more).getByRole('link', {name: /Fifth/})).toHaveAttribute('href', '/stories/five')
    expect(within(more).getByRole('link', {name: 'All stories'})).toHaveAttribute('href', '/stories')
    const headings = screen.getAllByRole('heading', {level: 2}).map((heading) => heading.textContent)
    expect(headings.indexOf('New Releases')).toBeLessThan(headings.indexOf('Admin Picks'))
    expect(headings.indexOf('More Stories')).toBeLessThan(headings.indexOf('Browse All Music'))
  })

  it('stays music-only without published stories, or when stories fail to load', async () => {
    renderDiscover()
    await screen.findByRole('heading', {name: 'New Releases'})
    expect(screen.queryByRole('heading', {name: 'More Stories'})).not.toBeInTheDocument()
    expect(screen.queryByText(/Read the story/)).not.toBeInTheDocument()
    vi.mocked(getStoriesHome).mockRejectedValue(new Error('down'))
    renderDiscover()
    expect((await screen.findAllByRole('heading', {name: 'New Releases'})).length).toBeGreaterThan(0)
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
