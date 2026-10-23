import {describe, expect, it, vi} from 'vitest'

import {getStory, getStoryMedia} from './index'

function fakeDb(row: Record<string, unknown> | null) {
  const prepare = vi.fn(() => {
    const statement = {bind: () => statement, first: async () => row, all: async () => ({results: []})}
    return statement
  })
  return {prepare}
}

function bucket() {
  return {getExact: vi.fn(async () => ({body: new Response('img').body!, contentLength: 3}))}
}

describe('public story routes', () => {
  it('streams an image of a published story with safe headers', async () => {
    const downloads = bucket()
    const response = await getStoryMedia({request: new Request('https://mejay.app/api/stories/media/m1'), env: {DB: fakeDb({storage_key: 'mejay-editorial/s1/m1.png', mime_type: 'image/png'}) as never, DOWNLOADS: downloads as never}, params: {mediaId: 'm1'}})
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(downloads.getExact).toHaveBeenCalledWith('mejay-editorial/s1/m1.png')
  })

  it('never serves a key outside the editorial folder, or an image no published story uses', async () => {
    const downloads = bucket()
    const outside = await getStoryMedia({request: new Request('https://mejay.app/api/stories/media/m1'), env: {DB: fakeDb({storage_key: 'mejay-artist/p/audio/t/master.wav', mime_type: 'image/png'}) as never, DOWNLOADS: downloads as never}, params: {mediaId: 'm1'}})
    expect(outside.status).toBe(404)
    const unused = await getStoryMedia({request: new Request('https://mejay.app/api/stories/media/m2'), env: {DB: fakeDb(null) as never, DOWNLOADS: downloads as never}, params: {mediaId: 'm2'}})
    expect(unused.status).toBe(404)
    expect(downloads.getExact).not.toHaveBeenCalled()
  })

  it('answers 404 for malformed slugs without querying', async () => {
    const db = fakeDb(null)
    const response = await getStory({request: new Request('https://mejay.app/api/stories/x'), env: {DB: db as never}, params: {slug: '../../etc'}})
    expect(response.status).toBe(404)
    expect(db.prepare).not.toHaveBeenCalled()
  })
})
