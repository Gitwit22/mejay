import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {ProviderEarningsReporting, ProviderOverviewReporting, ProviderSalesReporting} from './ProviderReporting'
import {getProviderReporting, type ProviderSalesReport} from '@/lib/providerApi'

vi.mock('@/lib/providerApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providerApi')>(),
  getProviderReporting: vi.fn(),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const report: ProviderSalesReport = {
  period: {range: '30d', startAt: '2026-08-19T00:00:00.000Z', endAt: '2026-09-17T12:00:00.000Z'},
  currency: 'USD',
  summary: {grossSalesMinor: 148260, unitsSold: 917, earningsMinor: 103782, pendingMinor: 21840, paidOutMinor: 81942, refundsMinor: 1200, refundCount: 2, downloadCount: 640},
  topSongs: [{trackId: 'track-1', title: 'Getaway', units: 315, earningsMinor: 40000}],
  salesByRelease: [{releaseId: 'release-1', title: 'Night Drive', artistName: 'Example Artist', units: 315, grossMinor: 50000, earningsMinor: 40000, refundsMinor: 1000, downloads: 240}],
  salesByDay: [{date: '2026-09-17', units: 10, grossMinor: 2000, earningsMinor: 1800, refundsMinor: 0}],
  salesByTerritory: [{countryCode: 'US', units: 315, grossMinor: 50000, earningsMinor: 40000}],
  downloads: [{release_id: 'release-1', release_title: 'Night Drive', track_id: 'track-1', track_title: 'Getaway', download_count: 240}],
  refunds: [{orderId: 'order-1', saleDate: '2026-09-17T10:00:00.000Z', releaseId: 'release-1', releaseTitle: 'Night Drive', amountMinor: 1000, status: 'partially_refunded'}],
  recipientLiabilities: [{name: 'Producer', email: 'producer@example.com', role: 'producer', allocatedMinor: 30000, refundAdjustmentMinor: 2000, owedMinor: 28000}],
}

function renderReporting(view: React.ReactNode) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  return render(<QueryClientProvider client={client}>{view}</QueryClientProvider>)
}

describe('provider reporting views', () => {
  beforeEach(() => vi.mocked(getProviderReporting).mockResolvedValue(report))

  it('shows the required overview metrics and top songs', async () => {
    renderReporting(<ProviderOverviewReporting range="30d" onRangeChange={vi.fn()} />)
    expect(await screen.findByText('$1,482.60')).toBeInTheDocument()
    expect(screen.getByText('917')).toBeInTheDocument()
    expect(screen.getByText('$1,037.82')).toBeInTheDocument()
    expect(screen.getByText('$218.40')).toBeInTheDocument()
    expect(screen.getByText('$819.42')).toBeInTheDocument()
    expect(screen.getByText('Getaway')).toBeInTheDocument()
    expect(screen.getByText('315')).toBeInTheDocument()
  })

  it('renders all sales breakdowns and earnings liabilities', async () => {
    const {unmount} = renderReporting(<ProviderSalesReporting range="30d" onRangeChange={vi.fn()} />)
    expect(await screen.findByText('Sales by Release')).toBeInTheDocument()
    expect(screen.getByText('Sales by Day')).toBeInTheDocument()
    expect(screen.getByText('Sales by Territory')).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Downloads'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {name: 'Refunds'})).toBeInTheDocument()
    unmount()

    renderReporting(<ProviderEarningsReporting range="30d" onRangeChange={vi.fn()} />)
    expect(await screen.findByText('Split recipient liabilities')).toBeInTheDocument()
    expect(screen.getByText('producer@example.com')).toBeInTheDocument()
    expect(screen.getByText('$280.00')).toBeInTheDocument()
  })
})
