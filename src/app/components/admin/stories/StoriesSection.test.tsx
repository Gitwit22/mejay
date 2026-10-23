import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {commandAdminStory, listAdminStories, type AdminStoryListItem} from '@/lib/storiesAdminApi'
import {StoriesSection} from './StoriesSection'

vi.mock('@/lib/storiesAdminApi', async (importOriginal) => ({...await importOriginal<typeof import('@/lib/storiesAdminApi')>(), listAdminStories: vi.fn(), commandAdminStory: vi.fn()}))

const item = (overrides: Partial<AdminStoryListItem>): AdminStoryListItem => ({id: 's1', slug: 'detroit', template: 'headliner', status: 'published', title: 'Detroit', featured: false, version: 3, published_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z', cover_media_id: null, ...overrides})

function renderSection(role: 'admin' | 'reviewer') {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><MemoryRouter><StoriesSection role={role} /></MemoryRouter></QueryClientProvider>)
}

describe('admin stories list', () => {
  beforeEach(() => {
    vi.mocked(listAdminStories).mockReset().mockResolvedValue({items: [item({}), item({id: 's2', slug: 'draft-one', title: 'Draft one', status: 'draft', published_at: null})], total: 2})
    vi.mocked(commandAdminStory).mockReset().mockResolvedValue({} as never)
  })

  it('shows title, template, status and actions, and features a published story', async () => {
    renderSection('admin')
    expect(await screen.findByText('Detroit')).toBeInTheDocument()
    expect(screen.getAllByText('The Headliner').length).toBe(2)
    expect(screen.getByRole('link', {name: 'New story'})).toHaveAttribute('href', '/app/marketplace-admin/stories/new')
    expect(screen.getByRole('link', {name: 'View live'})).toHaveAttribute('href', '/stories/detroit')
    fireEvent.click(screen.getByRole('button', {name: 'Feature'}))
    await waitFor(() => expect(commandAdminStory).toHaveBeenCalledWith('s1', 'feature', 3))
    fireEvent.click(screen.getByRole('tab', {name: 'Drafts'}))
    await waitFor(() => expect(listAdminStories).toHaveBeenLastCalledWith({status: 'draft', offset: 0, limit: 20}))
  })

  it('lets reviewers look but not change anything', async () => {
    renderSection('reviewer')
    expect(await screen.findByText('Detroit')).toBeInTheDocument()
    expect(screen.queryByRole('link', {name: 'New story'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Feature'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Publish'})).not.toBeInTheDocument()
  })
})
