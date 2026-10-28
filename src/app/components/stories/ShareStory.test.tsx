import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {shareDetails} from '@/lib/storyShare'
import {ShareStory} from './ShareStory'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const story = {slug: 'is-detroit-rap-dying', title: 'Is Detroit rap dying?', teaser: 'Or are artists struggling to get heard?'}

describe('sharing a story', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'share', {value: undefined, configurable: true})
  })

  it('shares only the readable story link with a short line of text', () => {
    expect(shareDetails(story, 'https://mejayapp.com')).toEqual({
      url: 'https://mejayapp.com/stories/is-detroit-rap-dying',
      text: '“Is Detroit rap dying?” on MeJay',
      title: 'Is Detroit rap dying?',
      summary: '“Is Detroit rap dying?” on MeJay: Or are artists struggling to get heard?',
    })
  })

  it('opens the device share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', {value: share, configurable: true})
    render(<ShareStory story={story} />)
    fireEvent.click(screen.getByRole('button', {name: 'Share'}))
    await waitFor(() => expect(share).toHaveBeenCalledWith({
      title: 'Is Detroit rap dying?', text: '“Is Detroit rap dying?” on MeJay: Or are artists struggling to get heard?', url: `${window.location.origin}/stories/is-detroit-rap-dying`,
    }))
    expect(screen.queryByText('Share this story')).not.toBeInTheDocument()
  })

  it('offers copy link and the usual places when the device cannot share', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true})
    render(<ShareStory story={story} />)
    fireEvent.click(screen.getByRole('button', {name: 'Share'}))
    expect(await screen.findByText('Share this story')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Copy link'}))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/stories/is-detroit-rap-dying`))
    expect(await screen.findByRole('button', {name: 'Link copied'})).toBeInTheDocument()
    const encodedUrl = encodeURIComponent(`${window.location.origin}/stories/is-detroit-rap-dying`)
    expect(screen.getByRole('link', {name: /Post on X/})).toHaveAttribute('href', `https://x.com/intent/post?text=${encodeURIComponent('“Is Detroit rap dying?” on MeJay')}&url=${encodedUrl}`)
    expect(screen.getByRole('link', {name: /Share on Facebook/})).toHaveAttribute('href', `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`)
    expect(screen.getByRole('link', {name: /Send as a text/}).getAttribute('href')).toContain(encodedUrl)
    expect(screen.getByRole('link', {name: /Send by email/}).getAttribute('href')).toContain('subject=Is%20Detroit%20rap%20dying%3F')
  })
})
