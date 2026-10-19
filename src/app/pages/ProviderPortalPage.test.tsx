import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, within} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {describe, expect, it, vi} from 'vitest'

import {getProviderDashboard} from '@/lib/providerApi'
import ProviderPortalPage from './ProviderPortalPage'

vi.mock('@/lib/providerApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providerApi')>(),
  getProviderDashboard: vi.fn(),
}))

describe('artist portal navigation', () => {
  it('offers a way back to MeJay from the sidebar, the phone menu and the phone header', async () => {
    vi.mocked(getProviderDashboard).mockResolvedValue({
      provider: {id: 'p1', display_name: 'John Blaze', status: 'pending_review', role: 'owner'},
      counts: {artists: 1, releases: 0, drafts: 0, live_releases: 0, active_isrcs: 0},
    })
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/artist?section=settings']}>
      <Routes><Route path="/app/artist" element={<ProviderPortalPage />} /><Route path="/app" element={<p>MeJay home</p>} /></Routes>
    </MemoryRouter></QueryClientProvider>)

    // Desktop sidebar link and the compact phone header link.
    const links = await screen.findAllByRole('link', {name: /Back to MeJay/})
    expect(links.length).toBeGreaterThanOrEqual(2)
    links.forEach((link) => expect(link).toHaveAttribute('href', '/app'))

    // The phone menu carries it too.
    fireEvent.click(screen.getByRole('button', {name: 'Open navigation'}))
    const drawers = screen.getAllByRole('navigation', {name: 'Provider portal'})
    expect(within(drawers[drawers.length - 1]).getByRole('link', {name: /Back to MeJay/})).toHaveAttribute('href', '/app')

    fireEvent.click(links[0])
    expect(await screen.findByText('MeJay home')).toBeInTheDocument()
  })
})
