import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {describe, expect, it, vi} from 'vitest'

import {getMusicDiscovery} from '@/lib/musicDiscoveryApi'
import {MusicOverviewView} from './MusicOverviewView'

vi.mock('@/lib/musicDiscoveryApi', () => ({getMusicDiscovery: vi.fn()}))

const release = {
  id: 'release-1', title: 'First Light', release_type: 'single' as const, genre: 'House',
  original_release_date: null, published_at: '2026-09-17T00:00:00Z', artist_id: 'artist-1',
  artist_name: 'Nova', artwork_asset_id: null, product_id: 'product-1', amount_minor: 999,
  currency: 'USD', purchase_available: true, track_count: 1, preview_asset_id: null,
}

describe('MusicOverviewView', () => {
  it('renders discovery rails and links into Marketplace', async () => {
    vi.mocked(getMusicDiscovery).mockResolvedValue({
      newestReleases: [release], newestSingles: [release], newestProjects: [],
      mostPurchased: [release], mostPreviewed: [release], featuredReleases: [release],
      featuredArtists: [{id: 'artist-1', name: 'Nova', artwork_asset_id: null, release_count: 1}],
    })
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={queryClient}><MemoryRouter><MusicOverviewView /></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByRole('heading', {name: 'MEJAY MUSIC'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Admin Picks'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'New This Week'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Most Purchased'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Most Previewed'})).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Marketplace'})).toHaveAttribute('href', '/app/store')
    expect(screen.getByRole('link', {name: /Nova 1 release/})).toHaveAttribute('href', '/app/store?artist=artist-1')
  })
})
