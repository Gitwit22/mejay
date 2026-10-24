import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {commandAdminStory, createAdminStory, getAdminStory, StoryApiError, updateAdminStory, uploadStoryImage, type AdminStory} from '@/lib/storiesAdminApi'
import StoryEditorPage from './StoryEditorPage'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

vi.mock('@/lib/storiesAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/storiesAdminApi')>(),
  getAdminStory: vi.fn(),
  updateAdminStory: vi.fn(),
  commandAdminStory: vi.fn(),
  createAdminStory: vi.fn(),
  uploadStoryImage: vi.fn(),
  deleteStoryMedia: vi.fn(),
  lookupStoryLinks: vi.fn().mockResolvedValue([]),
}))

function story(overrides: Partial<AdminStory> = {}): AdminStory {
  return {
    id: 's1', slug: 'detroit', template: 'headliner', status: 'draft', title: 'Detroit has something to say', teaser: 'Inside the studios.', author_name: 'MeJay Editorial',
    category: 'Stories', tags: [], content: [{type: 'paragraph', text: 'Detroit is loud.'}], quote_text: null, quote_attribution: null, source_name: null, source_url: null,
    artist_id: null, release_id: null, cover_media_id: null, background_media_id: null, appearance: {palette: 'ink', overlay: 55, coverFocal: {x: 50, y: 50}},
    featured: false, version: 4, created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z', published_at: null, archived_at: null,
    media: [], linked_artist: null, linked_release: null, publishProblems: ['Upload a cover image.'], ...overrides,
  }
}

function renderAt(path: string) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/app/marketplace-admin/stories/:storyId" element={<StoryEditorPage />} />
  </Routes></MemoryRouter></QueryClientProvider>)
}

describe('story wizard', () => {
  beforeEach(() => {
    vi.mocked(getAdminStory).mockReset().mockResolvedValue(story())
    vi.mocked(updateAdminStory).mockReset().mockImplementation(async (_id, input) => story({version: input.expectedVersion + 1, title: input.title}))
    vi.mocked(commandAdminStory).mockReset()
    vi.mocked(uploadStoryImage).mockReset()
    vi.mocked(createAdminStory).mockReset()
  })

  it('creates a draft from a chosen template and title', async () => {
    vi.mocked(createAdminStory).mockResolvedValue(story({id: 'new-1'}))
    renderAt('/app/marketplace-admin/stories/new')
    const create = screen.getByRole('button', {name: 'Create draft and continue'})
    expect(create).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', {name: /Artist Spotlight/}))
    fireEvent.change(screen.getByLabelText('Working title'), {target: {value: 'Meet Kairo'}})
    fireEvent.click(create)
    await waitFor(() => expect(createAdminStory).toHaveBeenCalledWith({template: 'artist_spotlight', title: 'Meet Kairo'}))
  })

  it('has four labelled steps as real buttons and marks the current one', async () => {
    renderAt('/app/marketplace-admin/stories/s1?step=content')
    expect(await screen.findByRole('heading', {name: 'Add story'})).toBeInTheDocument()
    const steps = screen.getAllByRole('button', {name: /Choose template|Add story|Photos & look|Preview & publish/})
    expect(steps).toHaveLength(4)
    expect(screen.getByRole('button', {name: /Add story/})).toHaveAttribute('aria-current', 'step')
    fireEvent.click(screen.getByRole('button', {name: /Photos & look/}))
    expect(await screen.findByRole('heading', {name: 'Photos & look'})).toBeInTheDocument()
  })

  it('saves a draft at any step, and keeps what was typed when the save fails', async () => {
    renderAt('/app/marketplace-admin/stories/s1?step=content')
    const title = await screen.findByLabelText('Title')
    fireEvent.change(title, {target: {value: 'A new headline'}})
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    vi.mocked(updateAdminStory).mockRejectedValueOnce(new StoryApiError('Someone else saved this story since you opened it. Reload to get the latest version.', 'stale_story_version'))
    fireEvent.click(screen.getByRole('button', {name: 'Save draft'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else saved this story')
    expect(screen.getByLabelText('Title')).toHaveValue('A new headline')
    expect(screen.getByRole('button', {name: /Reload latest/})).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Save draft'}))
    await waitFor(() => expect(screen.getByText('All changes saved')).toBeInTheDocument())
    expect(updateAdminStory).toHaveBeenLastCalledWith('s1', expect.objectContaining({expectedVersion: 4, title: 'A new headline', slug: 'detroit'}))
  })

  it('shows upload problems without losing other choices', async () => {
    vi.mocked(uploadStoryImage).mockRejectedValue(new StoryApiError('The image failed validation', 'upload_validation_failed', ['This image must be at least 1200 x 630 pixels.']))
    renderAt('/app/marketplace-admin/stories/s1?step=photos')
    fireEvent.click(await screen.findByRole('radio', {name: /Violet/}))
    const input = document.querySelector('section[aria-labelledby="cover-label"] input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {target: {files: [new File(['x'], 'small.png', {type: 'image/png'})]}})
    expect(await screen.findByText('This image must be at least 1200 x 630 pixels.')).toBeInTheDocument()
    expect(screen.getByRole('radio', {name: /Violet/})).toHaveAttribute('aria-checked', 'true')
  })

  it('previews with the public renderer and publishes, saving pending edits first', async () => {
    vi.mocked(commandAdminStory).mockResolvedValue(story({status: 'published', version: 6, published_at: '2026-10-21T00:00:00Z', publishProblems: []}))
    renderAt('/app/marketplace-admin/stories/s1?step=preview')
    expect(await screen.findByTitle('desktop preview')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Share'})).not.toBeInTheDocument()
    expect(screen.getByText('Upload a cover image.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', {name: /Mobile/}))
    expect(screen.getByTitle('mobile preview')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', {name: 'Publish'}))
    await waitFor(() => expect(commandAdminStory).toHaveBeenCalledWith('s1', 'publish', 4))
    expect(await screen.findByText('published')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeEnabled()
  })

  it('explains publishing problems from the server without clearing the story', async () => {
    vi.mocked(commandAdminStory).mockRejectedValue(new StoryApiError('Finish these before publishing', 'story_incomplete', ['Upload a cover image.', 'Add a teaser. It appears on story cards.']))
    renderAt('/app/marketplace-admin/stories/s1?step=preview')
    fireEvent.click(await screen.findByRole('button', {name: 'Publish'}))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Finish these before publishing')
    expect(alert).toHaveTextContent('Add a teaser.')
  })
})
