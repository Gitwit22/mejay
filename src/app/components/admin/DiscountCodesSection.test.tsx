import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {createDiscountCode, listDiscountCodes, updateDiscountCode, type DiscountCode} from '@/lib/marketplaceCommerceApi'
import {lookupStoryLinks} from '@/lib/storiesAdminApi'
import {DiscountCodesSection} from './DiscountCodesSection'

vi.mock('@/lib/marketplaceCommerceApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/marketplaceCommerceApi')>(),
  listDiscountCodes: vi.fn(),
  createDiscountCode: vi.fn(),
  updateDiscountCode: vi.fn(),
}))
vi.mock('@/lib/storiesAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/storiesAdminApi')>(),
  lookupStoryLinks: vi.fn(),
}))

const existing: DiscountCode = {
  id: 'code-1', code: 'BOLDY20', percent_off: 20, release_id: 'release-1', release_title: 'Boldy', active: true,
  max_redemptions: 50, redemption_count: 3, created_at: '2026-11-01T00:00:00.000Z',
}

function renderSection() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  return render(<QueryClientProvider client={client}><DiscountCodesSection /></QueryClientProvider>)
}

describe('DiscountCodesSection', () => {
  beforeEach(() => {
    vi.mocked(createDiscountCode).mockReset()
    vi.mocked(updateDiscountCode).mockReset()
  })

  it('lets an admin create a code for one release and switch codes off', async () => {
    vi.mocked(listDiscountCodes).mockResolvedValue({role: 'admin', codes: [existing]})
    vi.mocked(lookupStoryLinks).mockResolvedValue([{id: 'release-1', title: 'Boldy', artist_name: 'John Blaze', status: 'LIVE', public: true}])
    vi.mocked(createDiscountCode).mockResolvedValue({...existing, id: 'code-2', code: 'FANS15', percent_off: 15, max_redemptions: 100, redemption_count: 0})
    vi.mocked(updateDiscountCode).mockResolvedValue({...existing, active: false})
    renderSection()

    expect(await screen.findByText('BOLDY20')).toBeInTheDocument()
    expect(screen.getByText('3 / 50')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('BOLDY20'), {target: {value: 'fans15'}})
    fireEvent.change(screen.getByRole('spinbutton', {name: /Percent off/}), {target: {value: '15'}})
    fireEvent.change(screen.getByPlaceholderText('Unlimited'), {target: {value: '100'}})
    fireEvent.click(screen.getByLabelText('One release and its songs'))
    const create = screen.getByRole('button', {name: 'Create code'})
    expect(create).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Search releases'), {target: {value: 'boldy'}})
    fireEvent.click(screen.getByRole('button', {name: 'Search'}))
    fireEvent.click(await screen.findByRole('button', {name: /Boldy · John Blaze/}))
    fireEvent.click(create)
    await waitFor(() => expect(createDiscountCode).toHaveBeenCalledWith({code: 'FANS15', percentOff: 15, releaseId: 'release-1', maxRedemptions: 100}))

    fireEvent.click(screen.getByRole('button', {name: 'Switch off'}))
    await waitFor(() => expect(updateDiscountCode).toHaveBeenCalledWith('code-1', {active: false}))
  })

  it('shows reviewers the codes without letting them change anything', async () => {
    vi.mocked(listDiscountCodes).mockResolvedValue({role: 'reviewer', codes: [existing]})
    renderSection()
    expect(await screen.findByText('BOLDY20')).toBeInTheDocument()
    expect(screen.getByText('Only marketplace admins can create or change codes.')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Create code'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Switch off'})).not.toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Copy link'})).toBeInTheDocument()
  })
})
