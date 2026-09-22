import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getIndustryReporting, getIsrcRegistry, getIsrcSequence, getMarketplaceAdminOverview} from '@/lib/marketplaceAdminApi'
import MarketplaceAdminPage from './MarketplaceAdminPage'

vi.mock('@/lib/marketplaceAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/marketplaceAdminApi')>(),
  getMarketplaceAdminOverview: vi.fn(),
  getIndustryReporting: vi.fn(),
  getIsrcRegistry: vi.fn(),
  getIsrcSequence: vi.fn(),
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
})