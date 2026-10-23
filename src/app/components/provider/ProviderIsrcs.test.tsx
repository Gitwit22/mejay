import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, within} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {listProviderIsrcs} from '@/lib/providerApi'
import {ProviderIsrcs} from './ProviderIsrcs'

vi.mock('@/lib/providerApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providerApi')>(),
  listProviderIsrcs: vi.fn(),
}))

function renderIsrcs() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><ProviderIsrcs /></QueryClientProvider>)
}

describe('provider ISRCs tab', () => {
  beforeEach(() => vi.mocked(listProviderIsrcs).mockReset())

  it('lists the account\'s codes with source and status, and offers a CSV download', async () => {
    vi.mocked(listProviderIsrcs).mockResolvedValue([
      {id: 'r1', isrc: 'QT-A3L-26-00001', track_title: 'Night Drive', artist_name: 'John Blaze', release_id: 'rel-1', release_title: 'Night Drive EP', assignment_type: 'MEJAY_ASSIGNED', status: 'ASSIGNED', assigned_at: '2026-10-19T12:00:00.000Z'},
      {id: 'r2', isrc: 'US-ABC-24-00007', track_title: 'Old Song', artist_name: 'John Blaze', release_id: null, release_title: null, assignment_type: 'EXTERNAL', status: 'REGISTERED', assigned_at: null},
    ])
    renderIsrcs()
    const table = await screen.findByRole('table')
    expect(within(table).getByText('QT-A3L-26-00001')).toBeInTheDocument()
    expect(within(table).getByText('Issued by MeJay')).toBeInTheDocument()
    expect(within(table).getByText('Your existing code')).toBeInTheDocument()
    expect(within(table).getByText('Registered')).toBeInTheDocument()
    expect(within(table).getByText('Night Drive EP')).toBeInTheDocument()
    expect(screen.getByRole('link', {name: /Download CSV/})).toHaveAttribute('href', expect.stringContaining('/api/marketplace/isrcs/export'))
    // The phone layout carries the same codes.
    expect(within(screen.getByRole('list', {name: 'ISRCs'})).getByText('US-ABC-24-00007')).toBeInTheDocument()
  })

  it('explains how codes are issued when there are none yet', async () => {
    vi.mocked(listProviderIsrcs).mockResolvedValue([])
    renderIsrcs()
    expect(await screen.findByText('No ISRCs yet')).toBeInTheDocument()
    expect(screen.queryByRole('link', {name: /Download CSV/})).not.toBeInTheDocument()
  })

  it('shows API errors instead of an empty list', async () => {
    vi.mocked(listProviderIsrcs).mockImplementationOnce(async () => { throw new Error('A provider profile is required') })
    renderIsrcs()
    expect(await screen.findByRole('alert')).toHaveTextContent('A provider profile is required')
  })
})
