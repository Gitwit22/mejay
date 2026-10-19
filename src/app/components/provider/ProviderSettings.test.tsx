import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {updateProviderSettings, type ProviderDashboard} from '@/lib/providerApi'
import {ProviderSettings} from './ProviderSettings'

vi.mock('@/lib/providerApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providerApi')>(),
  updateProviderSettings: vi.fn(),
}))

const provider: ProviderDashboard['provider'] = {
  id: 'provider-1', display_name: 'John Blaze', legal_name: null, slug: 'john-blaze', contact_email: 'jb@example.test',
  country_code: 'US', bio: null, created_at: '2026-10-01T00:00:00.000Z', status: 'pending_review', role: 'owner',
}

function renderSettings(overrides: Partial<ProviderDashboard['provider']> = {}, onOpenPayout = vi.fn()) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><MemoryRouter><ProviderSettings provider={{...provider, ...overrides}} onOpenPayout={onOpenPayout} /></MemoryRouter></QueryClientProvider>)
  return onOpenPayout
}

describe('provider settings', () => {
  beforeEach(() => vi.mocked(updateProviderSettings).mockReset())

  it('saves edited business details with trimmed values and nulls for empty optionals', async () => {
    vi.mocked(updateProviderSettings).mockResolvedValue({...provider, display_name: 'John Blaze Music', country_code: 'CA'})
    renderSettings()
    const save = screen.getByRole('button', {name: 'Save changes'})
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Display name'), {target: {value: '  John Blaze Music '}})
    fireEvent.change(screen.getByLabelText('Country (2-letter code)'), {target: {value: 'ca'}})
    fireEvent.click(save)
    await waitFor(() => expect(updateProviderSettings).toHaveBeenCalledWith({
      displayName: 'John Blaze Music', legalName: null, contactEmail: 'jb@example.test', countryCode: 'CA', bio: null,
    }))
  })

  it('blocks invalid input before calling the API and shows server errors', async () => {
    renderSettings()
    fireEvent.change(screen.getByLabelText('Contact email'), {target: {value: 'not-an-email'}})
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid contact email.')
    expect(updateProviderSettings).not.toHaveBeenCalled()

    vi.mocked(updateProviderSettings).mockImplementationOnce(async () => { throw new Error('Only the account owner or an admin can change these settings') })
    fireEvent.change(screen.getByLabelText('Contact email'), {target: {value: 'new@example.test'}})
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the account owner or an admin')
  })

  it('is read-only for editors and viewers', () => {
    renderSettings({role: 'viewer'})
    expect(screen.getByText('Only the account owner or an admin can change these details.')).toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toBeDisabled()
    expect(screen.queryByRole('button', {name: 'Save changes'})).not.toBeInTheDocument()
  })

  it('shows account facts and links to payouts and billing', () => {
    const onOpenPayout = renderSettings()
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('john-blaze')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: /Payout account/}))
    expect(onOpenPayout).toHaveBeenCalled()
    expect(screen.getByRole('link', {name: /Subscription & billing/})).toHaveAttribute('href', '/app/settings/billing')
  })
})
