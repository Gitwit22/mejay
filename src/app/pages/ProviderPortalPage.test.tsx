import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {describe, expect, it, vi} from 'vitest'

import {deleteProviderRelease, getProviderDashboard, listProviderArtists, listProviderReleases, type ProviderRelease} from '@/lib/providerApi'
import ProviderPortalPage from './ProviderPortalPage'

vi.mock('@/lib/providerApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providerApi')>(),
  getProviderDashboard: vi.fn(),
  listProviderReleases: vi.fn(),
  listProviderArtists: vi.fn(),
  deleteProviderRelease: vi.fn(),
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

describe('My Releases deletion', () => {
  const release = (id: string, title: string, status: string): ProviderRelease => ({id, title, release_type: 'single', status, version: 1, primary_artist_id: 'a1', primary_artist_name: 'John Blaze', track_count: 1, updated_at: '2026-10-01T00:00:00Z'})

  function renderReleases() {
    vi.mocked(getProviderDashboard).mockResolvedValue({
      provider: {id: 'p1', display_name: 'John Blaze', status: 'approved', role: 'owner'},
      counts: {artists: 1, releases: 2, drafts: 1, live_releases: 1, active_isrcs: 0},
    })
    vi.mocked(listProviderArtists).mockResolvedValue([])
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/artist?section=releases']}>
      <Routes><Route path="/app/artist" element={<ProviderPortalPage />} /></Routes>
    </MemoryRouter></QueryClientProvider>)
  }

  it('offers delete only on drafts and refreshes the list after confirming', async () => {
    vi.mocked(listProviderReleases).mockResolvedValueOnce([release('r1', 'Draft Song', 'DRAFT'), release('r2', 'Live Song', 'LIVE')]).mockResolvedValue([release('r2', 'Live Song', 'LIVE')])
    vi.mocked(deleteProviderRelease).mockResolvedValue({deleted: true})
    renderReleases()

    expect(await screen.findByRole('button', {name: 'Delete Draft Song'})).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Delete Live Song'})).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Delete Draft Song'}))
    fireEvent.click(await screen.findByRole('button', {name: 'Delete release'}))
    await waitFor(() => expect(deleteProviderRelease).toHaveBeenCalledWith('r1'))
    await waitFor(() => expect(screen.queryByText('Draft Song')).not.toBeInTheDocument())
    expect(screen.getByText('Live Song')).toBeInTheDocument()
  })

  it('shows the server reason when a delete is refused', async () => {
    vi.mocked(listProviderReleases).mockResolvedValue([release('r1', 'Draft Song', 'DRAFT')])
    vi.mocked(deleteProviderRelease).mockImplementationOnce(async () => { throw new Error('A track on this draft has an ISRC, so it cannot be deleted here.') })
    renderReleases()

    fireEvent.click(await screen.findByRole('button', {name: 'Delete Draft Song'}))
    fireEvent.click(await screen.findByRole('button', {name: 'Delete release'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('has an ISRC')
    expect(screen.getByText('Draft Song', {selector: 'p'})).toBeInTheDocument()
  })
})
