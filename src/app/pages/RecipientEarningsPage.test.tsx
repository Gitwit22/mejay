import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getRecipientEarnings, type RecipientEarningsReport} from '@/lib/providerApi'
import {usePlanStore} from '@/stores/planStore'
import RecipientEarningsPage from './RecipientEarningsPage'

vi.mock('@/lib/providerApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providerApi')>(),
  getRecipientEarnings: vi.fn(),
}))

const report: RecipientEarningsReport = {
  period: {range: 'ytd', startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-09-17T12:00:00.000Z'},
  currency: 'USD',
  recipientEmail: 'producer@example.com',
  summary: {allocatedMinor: 30000, refundAdjustmentMinor: 2000, owedMinor: 28000},
  rows: [{
    allocationId: 'allocation-1',
    orderId: 'order-1',
    saleDate: '2026-09-17T10:00:00.000Z',
    releaseId: 'release-1',
    releaseTitle: 'Night Drive',
    trackId: 'track-1',
    trackTitle: 'Getaway',
    role: 'producer',
    allocatedMinor: 30000,
    refundAdjustmentMinor: 2000,
    owedMinor: 28000,
  }],
}

function renderPage(entry = '/app/earnings') {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}><RecipientEarningsPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RecipientEarningsPage', () => {
  beforeEach(() => {
    vi.mocked(getRecipientEarnings).mockReset()
    usePlanStore.setState({authStatus: 'anonymous', user: null})
  })

  it('requires a signed-in MEJay account and preserves the return URL', () => {
    renderPage('/app/earnings?range=ytd')

    expect(screen.getByRole('heading', {name: 'Sign in to Earnings'})).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Sign in'})).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fapp%2Fearnings%3Frange%3Dytd',
    )
    expect(getRecipientEarnings).not.toHaveBeenCalled()
  })

  it('shows only the authenticated recipient statement and reconciled amounts', async () => {
    usePlanStore.setState({
      authStatus: 'authenticated',
      user: {id: 'recipient-1', email: 'producer@example.com', accountIntent: 'consumer'},
    })
    vi.mocked(getRecipientEarnings).mockResolvedValue(report)

    renderPage('/app/earnings?range=ytd')

    expect(await screen.findByText('producer@example.com')).toBeInTheDocument()
    expect(getRecipientEarnings).toHaveBeenCalledWith('ytd')
    expect(screen.getAllByText('$300.00')).toHaveLength(2)
    expect(screen.getAllByText('$20.00')).toHaveLength(2)
    expect(screen.getAllByText('$280.00')).toHaveLength(2)
    expect(screen.getByText('Getaway')).toBeInTheDocument()
    expect(screen.getByText('Night Drive')).toBeInTheDocument()
    expect(screen.getByText(/transfers marketplace proceeds to the provider's Stripe account/i)).toBeInTheDocument()
  })

  it('renders a clear empty state for an email with no matching allocations', async () => {
    usePlanStore.setState({authStatus: 'authenticated'})
    vi.mocked(getRecipientEarnings).mockResolvedValue({...report, summary: {allocatedMinor: 0, refundAdjustmentMinor: 0, owedMinor: 0}, rows: []})

    renderPage()

    expect(await screen.findByText('No split earnings found')).toBeInTheDocument()
    expect(screen.getByText('No allocations in this period match producer@example.com.')).toBeInTheDocument()
    expect(getRecipientEarnings).toHaveBeenCalledWith('30d')
  })
})