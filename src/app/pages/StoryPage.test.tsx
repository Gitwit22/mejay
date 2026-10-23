import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getStory, StoryNotFoundError, type StoryView} from '@/lib/storiesApi'
import StoryPage from './StoryPage'

vi.mock('@/lib/storiesApi', async (importOriginal) => ({...await importOriginal<typeof import('@/lib/storiesApi')>(), getStory: vi.fn()}))

const view: StoryView = {
  slug: 'meet-kairo', template: 'artist_spotlight', title: 'Meet your next favorite artist', teaser: 'From Detroit to the world.', authorName: null, category: 'Artist Spotlight', tags: [],
  content: [{type: 'paragraph', text: 'Kairo blends raw storytelling with cinematic beats.'}], quote: null, source: null,
  appearance: {palette: 'violet', overlay: 50, coverFocal: {x: 50, y: 50}}, cover: {id: 'c', url: '/api/stories/media/c', width: 1600, height: 900, altText: 'Kairo portrait', caption: null, credit: null},
  background: null, gallery: [], inlineMedia: {}, publishedAt: '2026-10-20T00:00:00Z', updatedAt: null, artist: null, release: null,
}

function renderAt(path: string) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/stories/:slug" element={<StoryPage />} /></Routes></MemoryRouter></QueryClientProvider>)
}

describe('public story page', () => {
  beforeEach(() => { vi.mocked(getStory).mockReset() })

  it('renders a published story on a direct link and sets its title and share tags', async () => {
    vi.mocked(getStory).mockResolvedValue(view)
    renderAt('/stories/meet-kairo')
    expect(await screen.findByRole('heading', {level: 1, name: 'Meet your next favorite artist'})).toBeInTheDocument()
    expect(getStory).toHaveBeenCalledWith('meet-kairo')
    await waitFor(() => expect(document.title).toBe('Meet your next favorite artist | MeJay Stories'))
    expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain('/api/stories/media/c')
    expect(document.head.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe('article')
    expect(screen.getByRole('link', {name: 'Stories'})).toHaveAttribute('href', '/stories')
  })

  it('explains when a story is unpublished or missing', async () => {
    vi.mocked(getStory).mockRejectedValue(new StoryNotFoundError('Story was not found'))
    renderAt('/stories/gone')
    expect(await screen.findByRole('heading', {name: "This story isn't available"})).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'See all stories'})).toHaveAttribute('href', '/stories')
  })
})
