import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {checkDiscountCode, startStoreCheckout} from '@/lib/marketplaceCommerceApi'
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
  checkDiscountCode: vi.fn(),
}))

const baseTrack = {version_title: null, disc_number: 1, duration_ms: 180_000, explicit: false, preview_asset_id: null}

function renderAt(path: string) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/app/store/:releaseId" element={<StoreReleasePage />} /></Routes></MemoryRouter></QueryClientProvider>)
}

describe('StoreReleasePage discount codes', () => {
  beforeEach(() => {
    usePlanStore.setState({authStatus: 'authenticated'})
    vi.mocked(startStoreCheckout).mockReset().mockResolvedValue(undefined)
    vi.mocked(checkDiscountCode).mockReset()
    vi.mocked(getStoreRelease).mockResolvedValue({
      release: {
        id: 'release-1', title: 'Boldy', release_type: 'single', genre: 'Hip-Hop', original_release_date: null, published_at: '2026-10-01T00:00:00.000Z',
        artist_id: 'artist-1', artist_name: 'John Blaze', artist_slug: 'john-blaze', artwork_asset_id: null, product_id: 'release-product', amount_minor: 1000, currency: 'USD',
        purchase_available: true, track_count: 1, preview_asset_id: null, version_title: null, subgenre: null, label_name: null,
      },
      tracks: [{...baseTrack, id: 'track-1', title: 'Boldy', track_number: 1, product_id: 'song-product', amount_minor: 400, currency: 'USD'}],
    })
  })

  it('shows the discounted price once a code is applied and checks out every product with it', async () => {
    vi.mocked(checkDiscountCode).mockResolvedValue({code: 'BOLDY20', percentOff: 20, currency: 'USD', listAmountMinor: 1000, discountMinor: 200, amountMinor: 800})
    renderAt('/app/store/release-1')
    fireEvent.click(await screen.findByRole('button', {name: 'Have a discount code?'}))
    fireEvent.change(screen.getByLabelText('Discount code'), {target: {value: 'boldy20'}})
    fireEvent.click(screen.getByRole('button', {name: 'Apply'}))
    await waitFor(() => expect(checkDiscountCode).toHaveBeenCalledWith('release-product', 'boldy20'))
    expect(await screen.findByText('$8.00')).toBeInTheDocument()
    expect(screen.getByText('$10.00')).toHaveClass('line-through')
    expect(screen.getByRole('status')).toHaveTextContent('BOLDY20 applied: 20% off')
    expect(screen.getByText('-20%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Purchase'}))
    await waitFor(() => expect(startStoreCheckout).toHaveBeenCalledWith('release-product', 'BOLDY20'))
    fireEvent.click(screen.getByRole('button', {name: 'Buy song'}))
    await waitFor(() => expect(startStoreCheckout).toHaveBeenCalledWith('song-product', 'BOLDY20'))

    fireEvent.click(screen.getByRole('button', {name: 'Remove'}))
    expect(screen.queryByText('$8.00')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Purchase'}))
    await waitFor(() => expect(startStoreCheckout).toHaveBeenLastCalledWith('release-product'))
  })

  it('explains a code that does not work and keeps the full price', async () => {
    vi.mocked(checkDiscountCode).mockRejectedValue(new Error("That code isn't valid for this music."))
    renderAt('/app/store/release-1')
    fireEvent.click(await screen.findByRole('button', {name: 'Have a discount code?'}))
    fireEvent.change(screen.getByLabelText('Discount code'), {target: {value: 'NOPE'}})
    fireEvent.click(screen.getByRole('button', {name: 'Apply'}))
    expect(await screen.findByRole('alert')).toHaveTextContent("That code isn't valid for this music.")
    expect(screen.getByText('$10.00')).not.toHaveClass('line-through')
    fireEvent.click(screen.getByRole('button', {name: 'Purchase'}))
    await waitFor(() => expect(startStoreCheckout).toHaveBeenCalledWith('release-product'))
  })

  it('applies a code that arrives in a shared link', async () => {
    vi.mocked(checkDiscountCode).mockResolvedValue({code: 'BOLDY20', percentOff: 20, currency: 'USD', listAmountMinor: 1000, discountMinor: 200, amountMinor: 800})
    renderAt('/app/store/release-1?code=BOLDY20')
    expect(await screen.findByText('$8.00')).toBeInTheDocument()
    expect(checkDiscountCode).toHaveBeenCalledTimes(1)
    expect(checkDiscountCode).toHaveBeenCalledWith('release-product', 'BOLDY20')
  })
})
