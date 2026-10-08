import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {startStoreCheckout} from '@/lib/marketplaceCommerceApi'
import {getPublicArtist} from '@/lib/musicStoreApi'
import {usePlanStore} from '@/stores/planStore'
import ArtistPage from './ArtistPage'

vi.mock('@/lib/musicStoreApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/musicStoreApi')>(),
  getPublicArtist: vi.fn(),
}))
vi.mock('@/lib/marketplaceCommerceApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/marketplaceCommerceApi')>(),
  startStoreCheckout: vi.fn(),
}))

const release = (id: string, title: string) => ({
  id, title, release_type: 'single' as const, genre: 'House', original_release_date: '2026-09-01', published_at: '2026-09-01T00:00:00.000Z',
  artist_id: 'artist-1', artist_name: 'John Blaze', artist_slug: 'john-blaze', artwork_asset_id: null, product_id: `${id}-product`,
  amount_minor: 349, currency: 'USD', purchase_available: true, track_count: 1, preview_asset_id: null,
})

function renderPage() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/artist/john-blaze']}><Routes><Route path="/artist/:slug" element={<ArtistPage />} /></Routes></MemoryRouter></QueryClientProvider>)
}

describe('public artist page', () => {
  beforeEach(() => {
    usePlanStore.setState({authStatus: 'authenticated'})
    vi.mocked(startStoreCheckout).mockResolvedValue(undefined)
  })

  it('shows the artist profile, links, latest release and more releases with working purchase', async () => {
    vi.mocked(getPublicArtist).mockResolvedValue({
      artist: {
        id: 'artist-1', name: 'John Blaze', slug: 'john-blaze', tagline: 'Detroit house', bio: 'Full biography text', location: 'Detroit, MI',
        genres: ['House', 'Techno'], links: {instagram: 'https://instagram.com/johnblaze'}, spotify_artist_id: '1234567890123456789012',
        apple_music_artist_id: null, profile_photo_asset_id: null, banner_asset_id: null, verified: true,
      },
      releases: [release('release-new', 'Night Drive'), release('release-old', 'Early Days')],
    })
    renderPage()
    expect(await screen.findByRole('heading', {level: 1, name: /John Blaze/})).toBeInTheDocument()
    expect(screen.getByLabelText('Verified MeJay artist')).toBeInTheDocument()
    expect(screen.getByText('Detroit house')).toBeInTheDocument()
    expect(screen.getByText('Detroit, MI')).toBeInTheDocument()
    expect(screen.getByText('Full biography text')).toBeInTheDocument()
    expect(screen.getByRole('link', {name: /Instagram/})).toHaveAttribute('href', 'https://instagram.com/johnblaze')
    expect(screen.getByRole('link', {name: /Spotify/})).toHaveAttribute('href', 'https://open.spotify.com/artist/1234567890123456789012')
    expect(screen.getByText('Latest release')).toBeInTheDocument()
    expect(screen.getByText('More from John Blaze')).toBeInTheDocument()
    expect(screen.getByText('Early Days')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Purchase'}))
    await waitFor(() => expect(startStoreCheckout).toHaveBeenCalledWith('release-new-product'))
  })

  it('shows a not-available message for unknown or non-public artists', async () => {
    vi.mocked(getPublicArtist).mockRejectedValue(new Error('Artist was not found'))
    renderPage()
    expect(await screen.findByText('This artist page is not available.')).toBeInTheDocument()
  })
})
