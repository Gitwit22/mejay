import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {startStoreCheckout} from '@/lib/marketplaceCommerceApi'
import {getStoreRelease} from '@/lib/musicStoreApi'
import {usePlanStore} from '@/stores/planStore'
import {StoreReleasePage} from './MusicStorePage'

vi.mock('@/lib/musicStoreApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/musicStoreApi')>(),
  getStoreRelease: vi.fn(),
}))
vi.mock('@/lib/marketplaceCommerceApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/marketplaceCommerceApi')>(),
  startStoreCheckout: vi.fn(),
}))

const baseTrack = {version_title: null, disc_number: 1, duration_ms: 180_000, explicit: false, preview_asset_id: null}

describe('StoreReleasePage song sales', () => {
  beforeEach(() => {
    usePlanStore.setState({authStatus: 'authenticated'})
    vi.mocked(startStoreCheckout).mockResolvedValue(undefined)
    vi.mocked(getStoreRelease).mockResolvedValue({
      release: {
        id: 'release-1', title: 'Night Drive', release_type: 'ep', genre: 'House', original_release_date: null, published_at: '2026-10-01T00:00:00.000Z',
        artist_id: 'artist-1', artist_name: 'Example Artist', artist_slug: 'example-artist', artwork_asset_id: null, product_id: 'release-product', amount_minor: 999, currency: 'USD',
        purchase_available: true, track_count: 2, preview_asset_id: null, version_title: null, subgenre: null, label_name: null,
      },
      tracks: [
        {...baseTrack, id: 'track-1', title: 'Getaway', track_number: 1, product_id: 'song-product', amount_minor: 349, currency: 'USD'},
        {...baseTrack, id: 'track-2', title: 'Interlude', track_number: 2, product_id: null, amount_minor: null, currency: null},
      ],
    })
  })

  it('offers priced songs on their own and checks out the song product', async () => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/store/release-1']}><Routes><Route path="/app/store/:releaseId" element={<StoreReleasePage />} /></Routes></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText('Getaway')).toBeInTheDocument()
    expect(screen.getByText('$3.49')).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Example Artist'})).toHaveAttribute('href', '/artist/example-artist')
    // Only the priced song gets its own buy button; the unpriced one is sold with the release.
    const buySong = screen.getAllByRole('button', {name: 'Buy song'})
    expect(buySong).toHaveLength(1)
    fireEvent.click(buySong[0])
    await waitFor(() => expect(startStoreCheckout).toHaveBeenCalledWith('song-product'))
  })
})

describe('StoreReleasePage pre-orders and guest checkout', () => {
  beforeEach(() => {
    vi.mocked(startStoreCheckout).mockReset().mockResolvedValue(undefined)
    vi.mocked(getStoreRelease).mockResolvedValue({
      release: {
        id: 'release-2', title: 'Coming Soon', release_type: 'single', genre: 'Soul', original_release_date: null, published_at: null as never,
        artist_id: 'artist-1', artist_name: 'Example Artist', artist_slug: 'example-artist', artwork_asset_id: null, product_id: 'preorder-product', amount_minor: 999, currency: 'USD',
        purchase_available: true, track_count: 1, preview_asset_id: null, version_title: null, subgenre: null, label_name: null,
        availability: 'preorder', release_at: '2026-11-10T13:00:00.000Z', release_timezone: 'America/Detroit',
      },
      tracks: [{...baseTrack, id: 'track-9', title: 'Soon', track_number: 1, product_id: null, amount_minor: null, currency: null}],
    })
  })

  it('labels the pre-order with its timezone, explains the charge, and lets a signed-out fan check out as a guest', async () => {
    usePlanStore.setState({authStatus: 'anonymous'})
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/store/release-2']}><Routes><Route path="/app/store/:releaseId" element={<StoreReleasePage />} /></Routes></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText('Pre-order · releases Nov 10, 2026, 8:00 AM EST')).toBeInTheDocument()
    expect(screen.getByText(/You’ll be charged today\. Downloads become available on release day\.|You'll be charged today\. Downloads become available on release day\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Pre-order'}))
    // No account required: a signed-out fan goes straight to checkout instead of the sign-in page.
    await waitFor(() => expect(startStoreCheckout).toHaveBeenCalledWith('preorder-product'))
  })
})
