import {describe, expect, it} from 'vitest'

import {buildArtistShareMeta, buildReleaseShareMeta, clipText, formatSharePrice, metaTagHtml} from './shareMeta'

const origin = 'https://mejay2.pages.dev'

describe('buildReleaseShareMeta', () => {
  const release = {
    id: 'rel_123', title: 'Boldy', artist_name: 'John Blaze', artist_credit: 'John Blaze feat. Kay',
    release_type: 'single', availability: 'available', amount_minor: 499, currency: 'USD', artwork_asset_id: 'asset_9',
  }

  it('titles the card with the song, the full artist credit and a buy message, and uses the cover', () => {
    const meta = buildReleaseShareMeta(release, origin)
    expect(meta.tags['og:title']).toBe('Boldy by John Blaze feat. Kay · Buy now on MeJay')
    expect(meta.tags['twitter:title']).toBe(meta.tags['og:title'])
    expect(meta.tags['og:description']).toBe('Buy now on MeJay for $4.99. Play a preview and download it to keep.')
    expect(meta.tags['og:image']).toBe('https://mejay2.pages.dev/api/store/assets/asset_9')
    expect(meta.tags['twitter:image']).toBe(meta.tags['og:image'])
    expect(meta.tags['twitter:card']).toBe('summary_large_image')
    expect(meta.tags['og:url']).toBe('https://mejay2.pages.dev/app/store/rel_123')
    expect(meta.tags['og:type']).toBe('music.song')
    expect(meta.documentTitle).toBe('Boldy by John Blaze feat. Kay | MeJay')
  })

  it('says pre-order for a release that is not out yet', () => {
    const meta = buildReleaseShareMeta({...release, availability: 'preorder', release_type: 'album'}, origin)
    expect(meta.tags['og:title']).toBe('Boldy by John Blaze feat. Kay · Pre-order now on MeJay')
    expect(meta.tags['og:description']).toMatch(/^Pre-order now on MeJay for \$4\.99/)
    expect(meta.tags['og:type']).toBe('music.album')
  })

  it('falls back to the lead artist and a text card when there is no credit or cover', () => {
    const meta = buildReleaseShareMeta({...release, artist_credit: null, artwork_asset_id: null, amount_minor: null}, origin)
    expect(meta.tags['og:title']).toBe('Boldy by John Blaze · Buy now on MeJay')
    expect(meta.tags['og:description']).toBe('Buy now on MeJay. Play a preview and download it to keep.')
    expect(meta.tags['og:image']).toBeUndefined()
    expect(meta.tags['twitter:card']).toBe('summary')
  })
})

describe('buildArtistShareMeta', () => {
  it('uses the tagline and profile photo', () => {
    const meta = buildArtistShareMeta({name: 'John Blaze', slug: 'john-blaze', tagline: 'Detroit soul', bio: 'Long bio', profile_photo_asset_id: 'p1', banner_asset_id: 'b1'}, origin)
    expect(meta.tags['og:title']).toBe('John Blaze on MeJay')
    expect(meta.tags['og:description']).toBe('Detroit soul')
    expect(meta.tags['og:image']).toBe('https://mejay2.pages.dev/api/store/assets/p1')
    expect(meta.tags['og:url']).toBe('https://mejay2.pages.dev/artist/john-blaze')
  })

  it('falls back to the banner and a default description', () => {
    const meta = buildArtistShareMeta({name: 'Kay', slug: 'kay', profile_photo_asset_id: null, banner_asset_id: 'b1'}, origin)
    expect(meta.tags['og:image']).toBe('https://mejay2.pages.dev/api/store/assets/b1')
    expect(meta.tags['og:description']).toBe('Listen to Kay and buy their music on MeJay.')
  })
})

describe('helpers', () => {
  it('formats prices and rejects unusable amounts', () => {
    expect(formatSharePrice(129, 'usd')).toBe('$1.29')
    expect(formatSharePrice('1000', 'USD')).toBe('$10.00')
    expect(formatSharePrice(0, 'USD')).toBeNull()
    expect(formatSharePrice('abc', 'USD')).toBeNull()
  })

  it('clips long text on a word boundary', () => {
    expect(clipText('one two three four five', 12)).toBe('one two…')
    expect(clipText('  short\n text ', 50)).toBe('short text')
  })

  it('escapes values so artist-entered text cannot break out of the tag', () => {
    expect(metaTagHtml('og:title', 'A "quote" <script>&')).toBe('<meta property="og:title" content="A &quot;quote&quot; &lt;script&gt;&amp;" />')
    expect(metaTagHtml('description', 'x')).toBe('<meta name="description" content="x" />')
  })
})
