import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getArtistPagePreview, type ArtistPageVisibility} from '@/lib/musicStoreApi'
import {usePlanStore} from '@/stores/planStore'
import ArtistPagePreview from './ArtistPagePreview'

vi.mock('@/lib/musicStoreApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/musicStoreApi')>(),
  getArtistPagePreview: vi.fn(),
}))

const hidden: ArtistPageVisibility = {public: false, suspended: false, payoutsReady: false, hasLiveRelease: false}

function renderPreview() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/artist-preview/artist-1']}><Routes><Route path="/artist-preview/:artistId" element={<ArtistPagePreview />} /></Routes></MemoryRouter></QueryClientProvider>)
}

function mockPreview(visibility: ArtistPageVisibility) {
  vi.mocked(getArtistPagePreview).mockResolvedValue({
    artist: {
      id: 'artist-1', name: 'John Blaze', slug: 'john-blaze-2', tagline: 'Detroit house', bio: null, location: null, genres: [], links: {},
      spotify_artist_id: null, apple_music_artist_id: null, profile_photo_asset_id: 'photo-1', banner_asset_id: null, verified: false,
    },
    releases: [],
    visibility,
  })
}

describe('artist page preview', () => {
  beforeEach(() => {
    usePlanStore.setState({authStatus: 'authenticated'})
    vi.mocked(getArtistPagePreview).mockReset()
  })

  it('shows the owner their page before it is public, with owner-only images and a way back', async () => {
    mockPreview(hidden)
    renderPreview()
    expect(await screen.findByRole('heading', {level: 1, name: /John Blaze/})).toBeInTheDocument()
    expect(getArtistPagePreview).toHaveBeenCalledWith('artist-1')
    expect(screen.getByRole('status')).toHaveTextContent(/Only you can see this preview. Connect Stripe payouts/)
    expect(screen.getByRole('link', {name: /Back to MeJay/})).toHaveAttribute('href', '/app/artist')
    expect(screen.queryByRole('link', {name: /Open public page/})).not.toBeInTheDocument()
    // Profile imagery comes from the owner-only preview route, not the public store route.
    expect(screen.getByRole('img', {name: 'John Blaze'})).toHaveAttribute('src', expect.stringContaining('/api/marketplace/artists/artist-1/page-preview/images/photo-1'))
  })

  it('links to the public page once it is public', async () => {
    mockPreview({...hidden, public: true, payoutsReady: true})
    renderPreview()
    expect(await screen.findByRole('status')).toHaveTextContent('Your page is public.')
    expect(screen.getByRole('link', {name: /Open public page/})).toHaveAttribute('href', '/artist/john-blaze-2')
  })

  it('asks signed-out visitors to sign in instead of loading the preview', async () => {
    usePlanStore.setState({authStatus: 'anonymous'})
    renderPreview()
    expect(await screen.findByRole('link', {name: /Sign in to MeJay/})).toHaveAttribute('href', '/login')
    expect(getArtistPagePreview).not.toHaveBeenCalled()
  })
})
