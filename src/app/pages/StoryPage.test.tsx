import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getStory, recordStoryView, StoryNotFoundError, type StoryView} from '@/lib/storiesApi'
import StoryPage from './StoryPage'

vi.mock('@/lib/storiesApi', async (importOriginal) => ({...await importOriginal<typeof import('@/lib/storiesApi')>(), getStory: vi.fn(), recordStoryView: vi.fn()}))

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
  beforeEach(() => { vi.mocked(getStory).mockReset(); vi.mocked(recordStoryView).mockReset().mockResolvedValue(1235) })

  it('renders a published story on a direct link and sets its title and share tags', async () => {
    vi.mocked(getStory).mockResolvedValue(view)
    renderAt('/stories/meet-kairo')
    expect(await screen.findByRole('heading', {level: 1, name: 'Meet your next favorite artist'})).toBeInTheDocument()
    expect(getStory).toHaveBeenCalledWith('meet-kairo')
    await waitFor(() => expect(document.title).toBe('Meet your next favorite artist | MeJay Stories'))
    expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain('/api/stories/media/c')
    expect(document.head.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe('article')
    expect(screen.getByRole('link', {name: 'Stories'})).toHaveAttribute('href', '/stories')
    expect(screen.getAllByRole('button', {name: 'Share'}).length).toBeGreaterThan(0)
  })

  it('explains when a story is unpublished or missing', async () => {
    vi.mocked(getStory).mockRejectedValue(new StoryNotFoundError('Story was not found'))
    renderAt('/stories/gone')
    expect(await screen.findByRole('heading', {name: "This story isn't available"})).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'See all stories'})).toHaveAttribute('href', '/stories')
  })

  it('goes back to the previous page, or to Discover when opened from a shared link', async () => {
    vi.mocked(getStory).mockResolvedValue(view)
    function Where() { const location = useLocation(); return <p data-testid="where">{location.pathname}{location.search}</p> }
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const {unmount} = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app?tab=music', '/stories/meet-kairo']} initialIndex={1}><Routes>
      <Route path="/stories/:slug" element={<StoryPage />} /><Route path="/app" element={<Where />} />
    </Routes></MemoryRouter></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', {name: 'Back'}))
    expect(await screen.findByTestId('where')).toHaveTextContent('/app?tab=music')
    unmount()

    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/stories/meet-kairo']}><Routes>
      <Route path="/stories/:slug" element={<StoryPage />} /><Route path="/app" element={<Where />} />
    </Routes></MemoryRouter></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', {name: 'Back'}))
    expect(await screen.findByTestId('where')).toHaveTextContent('/app?tab=music')
  })

  it('records one view when the article opens and shows the total with an eye icon', async () => {
    vi.mocked(getStory).mockResolvedValue({...view, viewCount: 1234})
    renderAt('/stories/meet-kairo')
    expect(await screen.findByText('1,235 views')).toBeInTheDocument()
    expect(recordStoryView).toHaveBeenCalledTimes(1)
    expect(recordStoryView).toHaveBeenCalledWith('meet-kairo')
  })

  it('does not count a story that is not available', async () => {
    vi.mocked(getStory).mockRejectedValue(new StoryNotFoundError('Story was not found'))
    renderAt('/stories/gone')
    await screen.findByRole('heading', {name: "This story isn't available"})
    expect(recordStoryView).not.toHaveBeenCalled()
  })
})

