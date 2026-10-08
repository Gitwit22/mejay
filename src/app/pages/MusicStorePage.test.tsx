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
        artist_id: 'artist-1', artist_name: 'Example Artist', artwork_asset_id: null, product_id: 'release-product', amount_minor: 999, currency: 'USD',
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
    // Only the priced song gets its own buy button; the unpriced one is sold with the release.
    const buySong = screen.getAllByRole('button', {name: 'Buy song'})
    expect(buySong).toHaveLength(1)
    fireEvent.click(buySong[0])
    await waitFor(() => expect(startStoreCheckout).toHaveBeenCalledWith('song-product'))
  })
})
