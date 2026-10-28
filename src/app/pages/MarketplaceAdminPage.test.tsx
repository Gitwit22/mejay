import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {downloadMarketplaceFinanceCsv, getIndustryReporting, getIsrcRegistry, getIsrcRegistryRecord, getIsrcSequence, getMarketplaceAdminOverview, getMarketplaceFinance, getMarketplaceFinanceOrder, type FinanceOrderDetail} from '@/lib/marketplaceAdminApi'
import MarketplaceAdminPage from './MarketplaceAdminPage'

vi.mock('@/lib/marketplaceAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/marketplaceAdminApi')>(),
  getMarketplaceAdminOverview: vi.fn(),
  getIndustryReporting: vi.fn(),
  getIsrcRegistry: vi.fn(),
  getIsrcRegistryRecord: vi.fn(),
  getIsrcSequence: vi.fn(),
  getMarketplaceFinance: vi.fn(),
  getMarketplaceFinanceOrder: vi.fn(),
  downloadMarketplaceFinanceCsv: vi.fn(),
}))

describe('MarketplaceAdminPage industry reporting', () => {
  beforeEach(() => {
    vi.mocked(getMarketplaceAdminOverview).mockResolvedValue({
      role: 'admin', counts: {}, pending: [], catalog: [], providers: [], artists: [], isrcs: [], rights: [], pricing: [], splits: [], takedowns: [],
      discovery: {featuredReleases: [], featuredArtists: [], eligibleReleases: [], eligibleArtists: []},
    })
    vi.mocked(getIndustryReporting).mockResolvedValue({
      role: 'admin',
      reportDate: '2026-09-17',
      counts: {todaySales: 137, ready: 131, metadataErrors: 6, submitted: 131, rejected: 0},
      events: [{
        id: 'event-1', eventType: 'sale', isrc: 'QTA3L2600001', upc: '123456789012', artistName: 'Example Artist',
        releaseTitle: 'Night Drive', trackTitle: 'Getaway', transactionId: 'pi_trace_1234567890', ledgerTransactionId: 'ledger_trace_1234567890',
        priceMinor: 100, quantity: 1, territory: 'US', occurredAt: '2026-09-17T10:00:00.000Z', validationStatus: 'ready', validationErrors: [], batchId: null,
      }],
      batches: [{id: 'batch-1', report_date: '2026-09-17', status: 'submitted', event_count: 131, export_format: 'csv', submitted_at: '2026-09-17T12:00:00.000Z', resolved_at: null, rejection_reason: null, created_at: '2026-09-17T11:00:00.000Z'}],
    })
    vi.mocked(getIsrcSequence).mockResolvedValue({prefix: 'QTA3L', assignmentYear: 26, nextNumber: 2, previewIsrc: 'QT-A3L-26-00002'})
    vi.mocked(getIsrcRegistry).mockResolvedValue([{
      id: 'registry-1',
      isrc: 'QTA3L2600001',
      track: 'Getaway',
      artist: 'Example Artist',
      provider: 'Example Provider',
      type: 'MEJAY_ASSIGNED',
      assigned: '2026-09-22T10:00:00.000Z',
      status: 'ASSIGNED',
      year: 26,
    }])
    vi.mocked(getIsrcRegistryRecord).mockResolvedValue({
      id: 'registry-1',
      isrc: 'QTA3L2600001',
      trackId: 'track-1',
      track: 'Getaway',
      artistId: 'artist-1',
      artist: 'Example Artist',
      providerId: 'provider-1',
      provider: 'Example Provider',
      rightsOwnerId: 'provider-1',
      rightsOwnerName: 'Example Provider',
      prefix: 'QTA3L',
      countryCode: 'QT',
      registrantCode: 'A3L',
      assignmentYear: 26,
      designationCode: '00001',
      assignmentType: 'MEJAY_ASSIGNED',
      status: 'ASSIGNED',
      assignedAt: '2026-09-22T10:00:00.000Z',
      assignedByUserId: 'user-1',
      rightsCertificationId: 'cert-1',
      createdAt: '2026-09-22T10:00:00.000Z',
      updatedAt: '2026-09-22T10:00:00.000Z',
    })
  })

  it('links back to the main MEJay app', async () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={queryClient}><MemoryRouter><MarketplaceAdminPage /></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByRole('link', {name: 'Back to MEJay'})).toHaveAttribute('href', '/app')
  })

  it('shows daily readiness and transaction-to-ledger traceability', async () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={queryClient}><MemoryRouter><MarketplaceAdminPage /></MemoryRouter></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', {name: 'Reporting'}))

    expect(await screen.findByRole('heading', {name: 'Reporting'})).toBeInTheDocument()
    expect(screen.getByText("Today's Sales")).toBeInTheDocument()
    expect(screen.getByText('Ready').parentElement).toHaveTextContent('Ready131')
    expect(screen.getByText('Submitted').parentElement).toHaveTextContent('Submitted131')
    expect(screen.getByText('137')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('Getaway')).toBeInTheDocument()
    expect(screen.getByText('QTA3L2600001')).toBeInTheDocument()
    expect(screen.getByText('123456789012')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: /Create daily export/})).toBeInTheDocument()
    expect(screen.getByRole('button', {name: /Accept/})).toBeInTheDocument()
  })

  it('shows the ISRC registry columns and actions', async () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={queryClient}><MemoryRouter><MarketplaceAdminPage /></MemoryRouter></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', {name: 'ISRC Registry'}))

    expect(await screen.findByRole('heading', {name: 'ISRC Registry'})).toBeInTheDocument()
    expect(await screen.findByText('QT-A3L-26-00002')).toBeInTheDocument()
    expect(await screen.findByText('Getaway')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'View Record'})).toBeInTheDocument()
    expect(screen.getByRole('button', {name: /Copy ISRC/})).toBeInTheDocument()
    expect(screen.getByRole('button', {name: /Export CSV/})).toBeInTheDocument()
  })

  it('loads and renders the ISRC detail dialog', async () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={queryClient}><MemoryRouter><MarketplaceAdminPage /></MemoryRouter></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', {name: 'ISRC Registry'}))
    fireEvent.click(await screen.findByRole('button', {name: 'View Record'}))

    expect(await screen.findByText('cert-1')).toBeInTheDocument()
    expect(screen.getByText('00001')).toBeInTheDocument()
    expect(screen.getAllByText('Example Provider').length).toBeGreaterThan(0)
  })

  it('shows read-only finance totals and filters by artist account', async () => {
    vi.mocked(getMarketplaceAdminOverview).mockResolvedValue({
      role: 'admin', counts: {}, pending: [], catalog: [{id: 'release-1', title: 'Night Drive'}], providers: [{id: 'provider-1', display_name: 'Example Provider'}],
      artists: [], isrcs: [], rights: [], pricing: [], splits: [], takedowns: [],
      discovery: {featuredReleases: [], featuredArtists: [], eligibleReleases: [], eligibleArtists: []},
    })
    vi.mocked(getMarketplaceFinance).mockResolvedValue({
      currency: 'USD',
      totals: {
        orders: 2, grossSalesMinor: 1998, stripeFeesMinor: 118, ordersWithUnknownStripeFee: 0, platformCommissionMinor: 200,
        processingFeesRecoveredMinor: 118, artistAllocationMinor: 1680, artistEarningsAfterAdjustmentsMinor: 1259, refundsMinor: 500, refundedOrders: 1,
        netPlatformRevenueMinor: 121, disputes: {open: 1, won: 0, lost: 0, openAmountMinor: 999, lostAmountMinor: 0}, failedPayments: 3,
        pendingTransfers: {count: 1, amountMinor: 840}, failedTransfers: {count: 0, amountMinor: 0},
      },
      byProvider: [
        {providerId: 'provider-1', providerName: 'Example Provider', orders: 2, grossMinor: 1998, platformCommissionMinor: 200, artistAllocationMinor: 1680, artistEarningsMinor: 1259, refundsMinor: 500, pendingPayoutMinor: 419, paidOutMinor: 840},
      ],
      transactions: [{orderId: 'order-1', paidAt: '2026-10-01T12:00:00.000Z', providerId: 'provider-1', providerName: 'Example Provider', releaseTitle: 'Night Drive', artistName: 'Example Artist', grossMinor: 999, platformCommissionMinor: 100, stripeFeeMinor: 59, artistAllocationMinor: 840, refundedMinor: 0, paymentStatus: 'paid', transferStatus: 'transferred', disputeStatus: 'none', livemode: false}],
    })
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={queryClient}><MemoryRouter><MarketplaceAdminPage /></MemoryRouter></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', {name: 'Finance'}))
    expect(await screen.findByText('Gross Marketplace Sales')).toBeInTheDocument()
    for (const label of ['Stripe Fees', 'Artist Allocations', 'MEJay Commission', 'MEJay Net Revenue', 'Failed Payments', 'Pending Transfers']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // Once in the totals and once in the artist's row of Sales by artist.
    expect(screen.getAllByText('$19.98')).toHaveLength(2)
    expect(screen.getByText('$1.21')).toBeInTheDocument()
    expect(screen.getByText('1 open · 0 lost')).toBeInTheDocument()
    expect(getMarketplaceFinance).toHaveBeenLastCalledWith({})
    fireEvent.change(screen.getByLabelText('Artist account'), {target: {value: 'provider-1'}})
    expect(getMarketplaceFinance).toHaveBeenLastCalledWith({providerId: 'provider-1'})
  })

  function renderFinance() {
    vi.mocked(getMarketplaceAdminOverview).mockResolvedValue({
      role: 'admin', counts: {}, pending: [], catalog: [], providers: [{id: 'provider-1', display_name: 'John Blaze'}],
      artists: [], isrcs: [], rights: [], pricing: [], splits: [], takedowns: [],
      discovery: {featuredReleases: [], featuredArtists: [], eligibleReleases: [], eligibleArtists: []},
    })
    vi.mocked(getMarketplaceFinance).mockResolvedValue({
      currency: 'USD',
      totals: {
        orders: 1, grossSalesMinor: 300, stripeFeesMinor: 0, ordersWithUnknownStripeFee: 1, platformCommissionMinor: 30,
        processingFeesRecoveredMinor: 39, artistAllocationMinor: 231, artistEarningsAfterAdjustmentsMinor: 231, refundsMinor: 0, refundedOrders: 0,
        netPlatformRevenueMinor: 69, disputes: {open: 0, won: 0, lost: 0, openAmountMinor: 0, lostAmountMinor: 0}, failedPayments: 0,
        pendingTransfers: {count: 1, amountMinor: 231}, failedTransfers: {count: 0, amountMinor: 0},
      },
      byProvider: [{providerId: 'provider-1', providerName: 'John Blaze', orders: 1, grossMinor: 300, platformCommissionMinor: 30, artistAllocationMinor: 231, artistEarningsMinor: 231, refundsMinor: 0, pendingPayoutMinor: 231, paidOutMinor: 0}],
      transactions: [{orderId: 'order-mia', paidAt: '2026-10-28T11:03:15.000Z', providerId: 'provider-1', providerName: 'John Blaze', releaseTitle: 'MIA', artistName: 'John Blaze', grossMinor: 300, platformCommissionMinor: 30, stripeFeeMinor: null, artistAllocationMinor: 231, refundedMinor: 0, paymentStatus: 'paid', transferStatus: 'pending', disputeStatus: 'none', livemode: true}],
    })
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={queryClient}><MemoryRouter><MarketplaceAdminPage /></MemoryRouter></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', {name: 'Finance'}))
  }

  it('shows sales by artist and filters the page to an artist from the table', async () => {
    renderFinance()
    expect(await screen.findByRole('heading', {name: 'Sales by artist'})).toBeInTheDocument()
    const artist = screen.getByRole('button', {name: 'John Blaze'})
    expect(screen.getAllByText('$2.31').length).toBeGreaterThan(0)
    fireEvent.click(artist)
    await waitFor(() => expect(getMarketplaceFinance).toHaveBeenLastCalledWith({providerId: 'provider-1'}))
    fireEvent.click(await screen.findByRole('button', {name: 'John Blaze (showing only)'}))
    await waitFor(() => expect(getMarketplaceFinance).toHaveBeenLastCalledWith({providerId: undefined}))
  })

  it('exports the filtered orders as CSV', async () => {
    vi.mocked(downloadMarketplaceFinanceCsv).mockResolvedValue()
    renderFinance()
    fireEvent.click(await screen.findByRole('button', {name: 'Export CSV'}))
    await waitFor(() => expect(downloadMarketplaceFinanceCsv).toHaveBeenCalledWith({}))
  })

  it('opens an order with the buyer, money split, delivery, emails and Stripe links', async () => {
    const detail: FinanceOrderDetail = {
      order: {
        id: 'order-mia', created_at: '2026-10-28T10:53:03.000Z', paid_at: '2026-10-28T11:03:15.000Z', purchase_type: 'preorder',
        buyer_user_id: 'user-1', buyer_email: null, buyer_account_email: 'fan@example.test', buyer_country_code: 'US', guest_checkout: false,
        provider_profile_id: 'provider-1', provider_name: 'John Blaze', currency: 'USD',
        gross_amount_minor: 300, platform_fee_minor: 69, provider_proceeds_minor: 231, platform_fee_bps: 1000,
        platform_commission_minor: 30, processing_fees_recovered_minor: 39, artist_earnings_minor: 231,
        stripe_fee_minor: null, refunded_amount_minor: 0, transfer_reversed_minor: 0,
        payment_status: 'paid', transfer_status: 'pending', dispute_status: 'none', livemode: true,
        stripe_checkout_session_id: 'cs_live_1', stripe_payment_intent_id: 'pi_live_1', stripe_charge_id: 'ch_live_1',
        stripe_transfer_id: null, stripe_transfer_reversal_id: null, stripe_destination_account_id: 'acct_1',
      },
      items: [{id: 'item-1', product_name: 'MIA', release_id: 'release-1', release_title: 'MIA', artist_name: 'John Blaze', song_title: null, unit_amount_minor: 300, currency: 'USD'}],
      splits: [{track_title: 'MIA', payee_name: 'John Blaze', payee_role: 'rights_holder', share_bps: 10000, amount_minor: 231}],
      entitlements: [{id: 'ent-1', status: 'active', delivery_status: 'held', delivery_available_at: null, granted_at: '2026-10-28T11:03:15.000Z', file_count: 1, download_count: 0, last_downloaded_at: null}],
      ledger: [{id: 'led-1', transaction_type: 'sale', stripe_reference_id: 'ch_live_1', occurred_at: '2026-10-28T11:03:15.000Z', entries: [{account: 'stripe_clearing', debitMinor: 300, creditMinor: 0}, {account: 'platform_revenue', debitMinor: 0, creditMinor: 69}, {account: 'provider_payable', debitMinor: 0, creditMinor: 231}]}],
      emails: [{kind: 'purchase_confirmation', status: 'sent', attempts: 1, sent_at: '2026-10-28T11:03:20.000Z', created_at: '2026-10-28T11:03:15.000Z'}],
    }
    vi.mocked(getMarketplaceFinanceOrder).mockResolvedValue(detail)
    renderFinance()
    fireEvent.click(await screen.findByRole('row', {name: 'Open order order-mia'}))
    const dialog = await screen.findByRole('dialog')
    expect(getMarketplaceFinanceOrder).toHaveBeenCalledWith('order-mia')
    expect(await within(dialog).findByText('fan@example.test')).toBeInTheDocument()
    expect(within(dialog).getByText('Pre-order')).toBeInTheDocument()
    expect(within(dialog).getByText('MeJay commission (10%)')).toBeInTheDocument()
    expect(within(dialog).getByText('Not yet reported by Stripe')).toBeInTheDocument()
    expect(within(dialog).getByText('Held until release day (pre-order)')).toBeInTheDocument()
    expect(within(dialog).getByText(/1 file · downloaded 0 times/)).toBeInTheDocument()
    expect(within(dialog).getByText('Not sent yet')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('link', {name: /Open in Stripe/})[0]).toHaveAttribute('href', 'https://dashboard.stripe.com/payments/pi_live_1')
    expect(within(dialog).getByText(/^sent · /)).toBeInTheDocument()
  })

  it('points staff at provider applications that are holding draft releases out of the pending queue', async () => {
    vi.mocked(getMarketplaceAdminOverview).mockResolvedValue({
      role: 'admin', counts: {}, pending: [], catalog: [], artists: [], isrcs: [], rights: [], pricing: [], splits: [], takedowns: [],
      providers: [
        {id: 'provider-1', display_name: 'Awaiting Artist', status: 'pending_review', release_count: 1},
        {id: 'provider-2', display_name: 'Empty Applicant', status: 'pending_review', release_count: 0},
        {id: 'provider-3', display_name: 'Approved Artist', status: 'approved', release_count: 3},
      ],
      discovery: {featuredReleases: [], featuredArtists: [], eligibleReleases: [], eligibleArtists: []},
    })
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={queryClient}><MemoryRouter><MarketplaceAdminPage /></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByText(/1 artist account is awaiting approval with draft releases/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Review providers'}))
    expect(await screen.findByRole('heading', {name: 'Providers'})).toBeInTheDocument()
    expect(screen.getByText('Awaiting Artist')).toBeInTheDocument()
  })

  it('shows no approval notice when every account with releases is approved', async () => {
    vi.mocked(getMarketplaceAdminOverview).mockResolvedValue({
      role: 'admin', counts: {}, pending: [], catalog: [], artists: [], isrcs: [], rights: [], pricing: [], splits: [], takedowns: [],
      providers: [{id: 'provider-3', display_name: 'Approved Artist', status: 'approved', release_count: 3}],
      discovery: {featuredReleases: [], featuredArtists: [], eligibleReleases: [], eligibleArtists: []},
    })
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={queryClient}><MemoryRouter><MarketplaceAdminPage /></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByRole('heading', {name: 'Pending Releases'})).toBeInTheDocument()
    expect(screen.queryByText(/awaiting approval with draft releases/)).not.toBeInTheDocument()
  })
})
