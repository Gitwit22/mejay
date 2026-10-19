import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {startStoreCheckout} from '@/lib/marketplaceCommerceApi'
import {getPublicArtist} from '@/lib/musicStoreApi'
import {usePlanStore} from '@/stores/planStore'
import {accentForeground, artistAccent} from '@/lib/artistTheme'
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
    expect(screen.getByText('Featured release')).toBeInTheDocument()
    expect(screen.getByText('More from John Blaze')).toBeInTheDocument()
    expect(screen.getByText('Early Days')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Purchase'}))
    await waitFor(() => expect(startStoreCheckout).toHaveBeenCalledWith('release-new-product'))
    // Signed-in visitors get a way back into the app.
    expect(screen.getByRole('link', {name: /Back to MeJay/})).toHaveAttribute('href', '/app')
  })

  it('builds the release-website layout from the artist page fields', async () => {
    vi.mocked(getPublicArtist).mockResolvedValue({
      artist: {
        id: 'artist-1', name: 'John Blaze', slug: 'john-blaze', tagline: null, bio: 'Grew up on the east side.', location: 'Detroit, MI',
        genres: ['House'], links: {booking: 'mailto:booking@johnblaze.test'}, spotify_artist_id: null, apple_music_artist_id: null,
        profile_photo_asset_id: null, banner_asset_id: 'city-1', cutout_asset_id: 'cutout-1', story_photo_asset_id: 'story-1',
        featured_release_id: 'release-old', accent_color: '#ff3366', highlight_quote: 'Detroit made.', verified: false,
        gallery: [{asset_id: 'photo-1', caption: 'Live at Movement', position: 0}],
      },
      releases: [release('release-new', 'Night Drive'), release('release-old', 'Early Days')],
    })
    renderPage()
    expect(await screen.findByRole('heading', {level: 1, name: /John Blaze/})).toBeInTheDocument()
    // Cutout in front of the artist's own city background; no default skyline.
    expect(screen.getAllByRole('img', {name: 'John Blaze'})[0]).toHaveAttribute('src', expect.stringContaining('/api/store/assets/cutout-1'))
    expect(screen.queryByTestId('default-skyline')).not.toBeInTheDocument()
    // The chosen featured release leads; the rest fill the catalog.
    const featured = screen.getByRole('region', {name: 'Featured release'})
    expect(featured).toHaveTextContent('Early Days')
    expect(screen.getByRole('region', {name: 'More from John Blaze'})).toHaveTextContent('Night Drive')
    expect(screen.getByText('“Detroit made.”')).toBeInTheDocument()
    expect(screen.getByRole('link', {name: /Booking & contact/})).toHaveAttribute('href', 'mailto:booking@johnblaze.test')
    expect(screen.getByRole('button', {name: 'Play Latest'})).toBeDisabled()

    fireEvent.click(screen.getByRole('button', {name: 'Live at Movement'}))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Live at Movement')
  })

  it('falls back to the Detroit skyline and profile photo, and hides empty sections', async () => {
    vi.mocked(getPublicArtist).mockResolvedValue({
      artist: {
        id: 'artist-1', name: 'John Blaze', slug: 'john-blaze', tagline: null, bio: null, location: null, genres: [], links: {},
        spotify_artist_id: null, apple_music_artist_id: null, profile_photo_asset_id: 'photo-9', banner_asset_id: null, verified: false,
      },
      releases: [release('release-new', 'Night Drive')],
    })
    renderPage()
    expect(await screen.findByTestId('default-skyline')).toBeInTheDocument()
    expect(screen.getByRole('img', {name: 'John Blaze'})).toHaveAttribute('src', expect.stringContaining('/api/store/assets/photo-9'))
    expect(screen.queryByRole('region', {name: /More from/})).not.toBeInTheDocument()
    expect(screen.queryByRole('region', {name: 'Photos'})).not.toBeInTheDocument()
    expect(screen.queryByRole('region', {name: /About/})).not.toBeInTheDocument()
    expect(screen.queryByRole('region', {name: /Follow/})).not.toBeInTheDocument()
  })

  it('keeps accent buttons readable and rejects malformed colours', () => {
    expect(artistAccent('#FF3366')).toBe('#ff3366')
    expect(artistAccent('red; background:url(x)')).toBe('#10b981')
    expect(artistAccent(null)).toBe('#10b981')
    expect(accentForeground('#ffffff')).toBe('#0a0a0b')
    expect(accentForeground('#facc15')).toBe('#0a0a0b')
    expect(accentForeground('#1e3a8a')).toBe('#ffffff')
  })

  it('shows signed-out visitors (link in bio) the page with no Back to MeJay bar', async () => {
    usePlanStore.setState({authStatus: 'anonymous'})
    vi.mocked(getPublicArtist).mockResolvedValue({
      artist: {
        id: 'artist-1', name: 'John Blaze', slug: 'john-blaze', tagline: null, bio: null, location: null, genres: [], links: {},
        spotify_artist_id: null, apple_music_artist_id: null, profile_photo_asset_id: null, banner_asset_id: null, verified: false,
      },
      releases: [],
    })
    renderPage()
    expect(await screen.findByRole('heading', {level: 1, name: /John Blaze/})).toBeInTheDocument()
    expect(screen.queryByRole('link', {name: /Back to MeJay/})).not.toBeInTheDocument()
  })

  it('shows a not-available message for unknown or non-public artists', async () => {
    vi.mocked(getPublicArtist).mockRejectedValue(new Error('Artist was not found'))
    renderPage()
    expect(await screen.findByText('This artist page is not available.')).toBeInTheDocument()
  })
})
