import {render, screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {describe, expect, it} from 'vitest'

import {parseInline} from '@/lib/storyInline'
import type {StoryView} from '@/lib/storiesApi'
import {StoryRenderer} from './StoryRenderer'

function story(overrides: Partial<StoryView> = {}): StoryView {
  return {
    slug: 'detroit', template: 'headliner', title: 'Detroit has something to say', teaser: 'Inside the studios.', authorName: 'MeJay Editorial',
    category: 'Stories', tags: ['detroit'], content: [{type: 'paragraph', text: 'Detroit is **loud** and *proud*. Read [more](https://example.com).'}],
    quote: {text: 'Keep going.', attribution: 'Kairo'}, source: {name: 'Free Press', url: 'https://freep.example/story'},
    appearance: {palette: 'ink', overlay: 50, coverFocal: {x: 30, y: 60}},
    cover: {id: 'c1', url: '/api/stories/media/c1', width: 1600, height: 900, altText: 'Producer at a desk', caption: 'Late night', credit: 'Ana'},
    background: null, gallery: [], inlineMedia: {}, publishedAt: '2026-10-20T00:00:00.000Z', updatedAt: null, artist: null, release: null,
    ...overrides,
  }
}

const render$ = (view: StoryView) => render(<MemoryRouter><StoryRenderer story={view} /></MemoryRouter>)

describe('story inline formatting', () => {
  it('turns bold, italic and http(s) links into tokens and leaves anything else as text', () => {
    expect(parseInline('a **b** *c* [d](https://x.test)')).toEqual([
      {type: 'text', text: 'a '}, {type: 'bold', text: 'b'}, {type: 'text', text: ' '}, {type: 'italic', text: 'c'}, {type: 'text', text: ' '},
      {type: 'link', text: 'd', href: 'https://x.test/'},
    ])
    expect(parseInline('[x](javascript:alert(1))')).toEqual(expect.not.arrayContaining([expect.objectContaining({type: 'link'})]))
  })
})

describe('StoryRenderer', () => {
  it('renders a Headliner with cover, byline, formatted text, quote and source', () => {
    render$(story())
    expect(screen.getByRole('heading', {level: 1, name: 'Detroit has something to say'})).toBeInTheDocument()
    expect(screen.getByAltText('Producer at a desk')).toHaveStyle({objectPosition: '30% 60%'})
    expect(screen.getByText('loud').tagName).toBe('STRONG')
    expect(screen.getByText('proud').tagName).toBe('EM')
    expect(screen.getByRole('link', {name: 'more'})).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getByText('“Keep going.”')).toBeInTheDocument()
    expect(screen.getByText(/By MeJay Editorial/)).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Free Press'})).toHaveAttribute('href', 'https://freep.example/story')
  })

  it('never renders typed HTML or unsafe links', () => {
    const {container} = render$(story({content: [{type: 'paragraph', text: '<img src=x onerror=alert(1)> [click](javascript:alert(1))'}]}))
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
    expect(screen.queryByRole('link', {name: 'click'})).not.toBeInTheDocument()
  })

  it('links a Spotlight to the artist page only when the artist is public', () => {
    const {rerender} = render$(story({template: 'artist_spotlight', artist: {id: 'a1', name: 'Kairo', slug: 'kairo', profile_photo_asset_id: null}}))
    expect(screen.getByRole('link', {name: /Explore the music/})).toHaveAttribute('href', '/artist/kairo')
    rerender(<MemoryRouter><StoryRenderer story={story({template: 'artist_spotlight', artist: null})} /></MemoryRouter>)
    expect(screen.queryByRole('link', {name: /Explore the music/})).not.toBeInTheDocument()
  })

  it('shows previews and the existing purchase page for a Release Drop, and hides them when the release is gone', () => {
    const release = {
      release: {id: 'r1', title: 'After Hours', release_type: 'single' as const, genre: 'Hip-Hop', original_release_date: null, published_at: '2026-10-01', artist_id: 'a1', artist_name: 'Demo Artist',
        artwork_asset_id: 'art1', product_id: 'p1', amount_minor: 199, currency: 'USD', purchase_available: true, track_count: 1, preview_asset_id: 'pv1', version_title: null, subgenre: null, label_name: null},
      tracks: [{id: 't1', title: 'After Hours', version_title: null, disc_number: 1, track_number: 1, duration_ms: 208000, explicit: true, preview_asset_id: 'pv1'}],
    }
    const {rerender} = render$(story({template: 'release_drop', cover: null, release}))
    expect(screen.getByRole('link', {name: /View release \/ Buy · \$1.99/})).toHaveAttribute('href', '/app/store/r1')
    expect(screen.getByRole('button', {name: 'Preview After Hours'})).toBeEnabled()
    expect(screen.getByAltText('After Hours cover')).toHaveAttribute('src', expect.stringContaining('/api/store/assets/art1'))
    rerender(<MemoryRouter><StoryRenderer story={story({template: 'release_drop', cover: null, release: null})} /></MemoryRouter>)
    expect(screen.queryByRole('link', {name: /View release/})).not.toBeInTheDocument()
  })

  it('keeps a background image under a readable overlay, and leaves it off the light palette', () => {
    const background = {id: 'b1', url: '/api/stories/media/b1', width: 1600, height: 900, altText: 'City', caption: null, credit: null}
    const {container, rerender} = render$(story({background, appearance: {palette: 'violet', overlay: 0, coverFocal: {x: 50, y: 50}}}))
    expect(container.querySelector('[style*="0.35)"]')).not.toBeNull()
    rerender(<MemoryRouter><StoryRenderer story={story({background, appearance: {palette: 'paper', overlay: 60, coverFocal: {x: 50, y: 50}}})} /></MemoryRouter>)
    expect(container.querySelector('img[src*="/api/stories/media/b1"]')).toBeNull()
  })
})
