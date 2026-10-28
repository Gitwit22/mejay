import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {exchangeGuestAccess, getGuestOrderStatus, recoverGuestAccess} from '@/lib/marketplaceCommerceApi'
import {usePlanStore} from '@/stores/planStore'
import {GuestDownloadPage, PurchaseCompletePage} from './GuestPurchasePages'

vi.mock('@/lib/marketplaceCommerceApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/marketplaceCommerceApi')>(),
  exchangeGuestAccess: vi.fn(),
  getGuestOrderStatus: vi.fn(),
  recoverGuestAccess: vi.fn(),
}))

const token = 'A'.repeat(43)
const purchase = {itemTitle: 'Night Drive', artistName: 'John Blaze', releaseTitle: 'Night Drive', deliveryStatus: 'available' as const, releaseAt: null, releaseTimezone: null}

function renderAt(element: React.ReactNode, path = '/download') {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{element}</MemoryRouter></QueryClientProvider>)
}

describe('guest download page', () => {
  beforeEach(() => {
    usePlanStore.setState({authStatus: 'anonymous'})
    window.location.hash = `#token=${token}`
    vi.mocked(exchangeGuestAccess).mockReset()
    vi.mocked(recoverGuestAccess).mockReset()
  })
  afterEach(() => {
    window.location.hash = ''
  })

  it('does nothing until the buyer presses Download, then lists resumable downloads', async () => {
    vi.mocked(exchangeGuestAccess).mockResolvedValue({
      state: 'available', purchase, accessToken: 'B'.repeat(43), expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
      files: [{id: 'file-1', title: 'Night Drive', trackNumber: 1, discNumber: 1, fileName: '01 - Night Drive.wav', mimeType: 'audio/wav', byteSize: 2_000_000}],
    })
    renderAt(<GuestDownloadPage />)
    const button = await screen.findByRole('button', {name: 'Download your music'})
    // A link scanner or a plain page view never exchanges the token.
    expect(exchangeGuestAccess).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() => expect(exchangeGuestAccess).toHaveBeenCalledWith(token))
    const link = await screen.findByRole('link', {name: /Download/})
    expect(link.getAttribute('href')).toContain('/api/store/guest-downloads/files/file-1?access=')
    expect(screen.getByText(/Interrupted\? Press Download again/)).toBeInTheDocument()
    expect(screen.getByText(/Create a free account to keep your purchases in your library/)).toBeInTheDocument()
  })

  it('shows a held pre-order with its release date and no downloads', async () => {
    vi.mocked(exchangeGuestAccess).mockResolvedValue({state: 'held', purchase: {...purchase, deliveryStatus: 'held', releaseAt: '2026-11-10T13:00:00.000Z', releaseTimezone: 'America/Detroit'}})
    renderAt(<GuestDownloadPage />)
    fireEvent.click(await screen.findByRole('button', {name: 'Download your music'}))
    expect(await screen.findByText('Pre-order · releases Nov 10, 2026, 8:00 AM EST')).toBeInTheDocument()
    expect(screen.queryByRole('link', {name: /^Download$/})).not.toBeInTheDocument()
  })

  it('offers a new link when the old one expired, without revealing whether the email has purchases', async () => {
    vi.mocked(exchangeGuestAccess).mockImplementationOnce(async () => { throw new Error('This download link has expired. Request a new one with your purchase email.') })
    vi.mocked(recoverGuestAccess).mockResolvedValue({message: 'If that email has MeJay purchases, new download links are on the way.'})
    renderAt(<GuestDownloadPage />)
    fireEvent.click(await screen.findByRole('button', {name: 'Download your music'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('expired')
    fireEvent.change(screen.getByLabelText(/Lost your link/), {target: {value: 'fan@example.test'}})
    fireEvent.click(screen.getByRole('button', {name: 'Email me new links'}))
    await waitFor(() => expect(recoverGuestAccess).toHaveBeenCalledWith('fan@example.test'))
    expect(await screen.findByText('If that email has MeJay purchases, new download links are on the way.')).toBeInTheDocument()
    expect(screen.getByText(/Check your spam or junk folder/)).toBeInTheDocument()
  })
})

describe('guest purchase complete page', () => {
  it('confirms a paid pre-order with the charge notice and release date, and keeps the account optional', async () => {
    usePlanStore.setState({authStatus: 'anonymous'})
    vi.mocked(getGuestOrderStatus).mockResolvedValue({
      status: 'paid', paid: true, purchaseType: 'preorder', deliveryStatus: 'held', releaseAt: '2026-11-10T13:00:00.000Z', releaseTimezone: 'America/Detroit',
      itemTitle: 'Night Drive', artistName: 'John Blaze', maskedEmail: 'f•••@example.test',
    })
    renderAt(<PurchaseCompletePage />, '/purchase/complete?session_id=cs_test_123456789')
    expect(await screen.findByText('Pre-order confirmed')).toBeInTheDocument()
    expect(screen.getByText('Pre-order · releases Nov 10, 2026, 8:00 AM EST')).toBeInTheDocument()
    expect(screen.getByText("You'll be charged today. Downloads become available on release day.")).toBeInTheDocument()
    expect(screen.getByText(/to f•••@example\.test on release day/)).toBeInTheDocument()
    expect(screen.getByText(/may be in your spam or junk folder/)).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Create a free account'})).toHaveAttribute('href', expect.stringContaining('/login?intent=signup'))
    expect(getGuestOrderStatus).toHaveBeenCalledWith('cs_test_123456789')
  })
})
