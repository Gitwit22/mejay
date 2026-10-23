import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, within} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getMusicDiscovery} from '@/lib/musicDiscoveryApi'
import {getStoriesHome, type StoryCard} from '@/lib/storiesApi'
import {MusicOverviewView} from './MusicOverviewView'

vi.mock('@/lib/musicDiscoveryApi', () => ({getMusicDiscovery: vi.fn()}))
vi.mock('@/lib/storiesApi', async (importOriginal) => ({...await importOriginal<typeof import('@/lib/storiesApi')>(), getStoriesHome: vi.fn()}))

const release = {
  id: 'release-1', title: 'First Light', release_type: 'single' as const, genre: 'House',
  original_release_date: null, published_at: '2026-09-17T00:00:00Z', artist_id: 'artist-1',
  artist_name: 'Nova', artwork_asset_id: null, product_id: 'product-1', amount_minor: 999,
  currency: 'USD', purchase_available: true, track_count: 1, preview_asset_id: 'clip-1',
}
const project = {...release, id: 'release-2', title: 'Long Night', release_type: 'album' as const}

const card = (slug: string, title: string): StoryCard => ({slug, template: 'headliner', title, teaser: `${title} teaser`, category: 'Stories', publishedAt: '2026-10-20T00:00:00Z', featured: false, image: null})

function renderView() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={queryClient}><MemoryRouter><MusicOverviewView /></MemoryRouter></QueryClientProvider>)
}

describe('MusicOverviewView', () => {
  beforeEach(() => {
    vi.mocked(getMusicDiscovery).mockResolvedValue({
      newestReleases: [release, project], newestSingles: [release], newestProjects: [project],
      mostPurchased: [release], mostPreviewed: [release], featuredReleases: [release],
      featuredArtists: [{id: 'artist-1', name: 'Nova', artwork_asset_id: null, release_count: 1}],
    })
    vi.mocked(getStoriesHome).mockReset().mockResolvedValue({featured: null, latest: []})
  })

  it('renders discovery rails and links into Marketplace', async () => {
    renderView()
    expect(await screen.findByRole('heading', {name: 'MEJAY MUSIC'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Admin Picks'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'New Releases'})).toBeInTheDocument()
    expect(screen.queryByRole('heading', {name: 'New This Week'})).not.toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Most Purchased'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Most Previewed'})).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Marketplace'})).toHaveAttribute('href', '/app/store')
    expect(screen.getByRole('link', {name: /Nova 1 release/})).toHaveAttribute('href', '/app/store?artist=artist-1')
  })

  it('shows new releases in one section with type tabs, prices, previews and a link to the full catalog', async () => {
    renderView()
    const section = (await screen.findByRole('heading', {name: 'New Releases'})).closest('section')!
    expect(within(section).getByRole('link', {name: 'View all music'})).toHaveAttribute('href', '/app/store')
    expect(within(section).getByText('Long Night')).toBeInTheDocument()
    expect(within(section).getAllByText(/\$9\.99/).length).toBeGreaterThan(0)
    expect(within(section).getAllByRole('link', {name: /First Light/})[0]).toHaveAttribute('href', '/app/store/release-1')
    expect(within(section).getByRole('button', {name: 'Preview First Light'})).toBeEnabled()
    fireEvent.click(within(section).getByRole('tab', {name: 'Singles'}))
    expect(within(section).queryByText('Long Night')).not.toBeInTheDocument()
    expect(within(section).getByRole('tab', {name: 'Singles'})).toHaveAttribute('aria-selected', 'true')
  })

  it('leads with the featured story, keeps music near the top and lists more stories at the end', async () => {
    vi.mocked(getStoriesHome).mockResolvedValue({
      featured: {...card('lead', 'Detroit has something to say'), featured: true},
      latest: [card('two', 'Second'), card('three', 'Third'), card('four', 'Fourth'), card('five', 'Fifth')],
    })
    renderView()
    const lead = await screen.findByRole('link', {name: /Detroit has something to say/})
    expect(lead).toHaveAttribute('href', '/stories/lead')
    expect(screen.getByRole('link', {name: /Second/})).toHaveAttribute('href', '/stories/two')
    const more = screen.getByRole('heading', {name: 'More Stories'}).closest('section')!
    expect(within(more).getByRole('link', {name: /Fifth/})).toHaveAttribute('href', '/stories/five')
    expect(within(more).getByRole('link', {name: 'All stories'})).toHaveAttribute('href', '/stories')
    const headings = screen.getAllByRole('heading', {level: 2}).map((heading) => heading.textContent)
    expect(headings.indexOf('New Releases')).toBeLessThan(headings.indexOf('Admin Picks'))
    expect(headings.indexOf('More Stories')).toBe(headings.length - 1)
  })

  it('stays music-only without published stories, or when stories fail to load', async () => {
    renderView()
    await screen.findByRole('heading', {name: 'New Releases'})
    expect(screen.queryByRole('heading', {name: 'More Stories'})).not.toBeInTheDocument()
    expect(screen.queryByText(/Read the story/)).not.toBeInTheDocument()
    vi.mocked(getStoriesHome).mockRejectedValue(new Error('down'))
    renderView()
    expect((await screen.findAllByRole('heading', {name: 'New Releases'})).length).toBeGreaterThan(0)
  })
})
