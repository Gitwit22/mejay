import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getArtistProfile, replaceArtistGallery, updateArtistProfile, type ArtistProfile} from '@/lib/providerApi'
import {ArtistProfileEditor} from './ArtistProfileEditor'

vi.mock('@/lib/providerApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providerApi')>(),
  getArtistProfile: vi.fn(),
  updateArtistProfile: vi.fn(),
  replaceArtistGallery: vi.fn(),
}))

const profile: ArtistProfile = {
  id: 'artist-1', name: 'John Blaze', slug: 'john-blaze', tagline: null, bio: 'Bio', location: 'Detroit, MI', genres: ['House'],
  links: {instagram: 'https://instagram.com/johnblaze'}, spotify_artist_id: null, apple_music_artist_id: null,
  profile_photo_asset_id: null, banner_asset_id: null, cutout_asset_id: 'cutout-1', story_photo_asset_id: null,
  featured_release_id: null, accent_color: '#ff3366', highlight_quote: null, liveReleaseCount: 2,
  liveReleases: [{id: 'release-a', title: 'Night Drive'}, {id: 'release-b', title: 'Early Days'}],
  gallery: [{asset_id: 'photo-1', caption: 'Stage', position: 0}, {asset_id: 'photo-2', caption: null, position: 1}],
}

function renderEditor() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><MemoryRouter><ArtistProfileEditor artist={{id: 'artist-1', name: 'John Blaze'} as never} /></MemoryRouter></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', {name: /Edit profile/}))
}

describe('artist page editor', () => {
  beforeEach(() => {
    vi.mocked(getArtistProfile).mockResolvedValue(profile)
    vi.mocked(updateArtistProfile).mockResolvedValue(profile)
    vi.mocked(replaceArtistGallery).mockResolvedValue([])
  })

  it('saves the page look fields and leaves an unchanged gallery alone', async () => {
    renderEditor()
    fireEvent.change(await screen.findByLabelText('Quote or career highlight'), {target: {value: 'Detroit made.'}})
    fireEvent.change(screen.getByLabelText('Featured release'), {target: {value: 'release-b'}})
    fireEvent.change(screen.getByLabelText('Booking / contact'), {target: {value: 'mailto:booking@johnblaze.test'}})
    fireEvent.click(screen.getByRole('button', {name: 'Save artist page'}))
    await waitFor(() => expect(updateArtistProfile).toHaveBeenCalledWith('artist-1', expect.objectContaining({
      cutoutAssetId: 'cutout-1', accentColor: '#ff3366', featuredReleaseId: 'release-b', highlightQuote: 'Detroit made.',
      links: {instagram: 'https://instagram.com/johnblaze', booking: 'mailto:booking@johnblaze.test'},
    })))
    expect(replaceArtistGallery).not.toHaveBeenCalled()
  })

  it('reorders, captions and removes gallery photos, then saves them in order', async () => {
    renderEditor()
    fireEvent.change(await screen.findByLabelText('Caption for photo 2'), {target: {value: 'Studio'}})
    fireEvent.click(screen.getAllByRole('button', {name: 'Move up'})[1])
    fireEvent.click(screen.getAllByRole('button', {name: 'Remove photo'})[1])
    fireEvent.click(screen.getByRole('button', {name: 'Save artist page'}))
    await waitFor(() => expect(replaceArtistGallery).toHaveBeenCalledWith('artist-1', [{assetId: 'photo-2', caption: 'Studio'}]))
  })
})
