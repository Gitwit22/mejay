import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getReviewAsset} from './index'

const {getSessionUserId} = vi.hoisted(() => ({getSessionUserId: vi.fn()}))

vi.mock('../_auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('../_auth')>(),
  getSessionUserId: (...args: unknown[]) => getSessionUserId(...args),
}))

/** Answers the two queries getReviewAsset makes: the staff lookup and the asset row. */
function fakeDb(staff: boolean) {
  return {
    prepare: (sql: string) => {
      const statement = {
        bind: () => statement,
        first: async () => sql.includes('marketplace_staff')
          ? (staff ? {role: 'reviewer'} : null)
          : {storage_key: 'marketplace/p/audio/t/a.wav', mime_type: 'audio/wav', kind: 'audio', file_name: 'master.wav'},
      }
      return statement
    },
  }
}

function context(headers: Record<string, string> = {}, staff = true) {
  const getExact = vi.fn(async (_key: string, range?: string) => ({
    body: new Response('x'.repeat(100)).body!,
    contentLength: range ? 100 : 5000,
    contentRange: range ? 'bytes 0-99/5000' : undefined,
  }))
  return {
    getExact,
    value: {request: new Request('https://mejay.app/api/marketplace-admin/assets/asset-1', {headers}), env: {DB: fakeDb(staff), DOWNLOADS: {getExact}} as never, params: {assetId: 'asset-1'}},
  }
}

describe('staff review asset route', () => {
  beforeEach(() => {
    getSessionUserId.mockReset().mockResolvedValue('staff-1')
  })

  it('serves byte ranges so the review player can seek through a master', async () => {
    const {value, getExact} = context({range: 'bytes=0-99'})
    const response = await getReviewAsset(value)
    expect(response.status).toBe(206)
    expect(getExact).toHaveBeenCalledWith('marketplace/p/audio/t/a.wav', 'bytes=0-99')
    expect(response.headers.get('content-range')).toBe('bytes 0-99/5000')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('returns the whole file without a range and ignores malformed ranges', async () => {
    const plain = context()
    expect((await getReviewAsset(plain.value)).status).toBe(200)
    const odd = context({range: 'bytes=0-99,200-300'})
    expect((await getReviewAsset(odd.value)).status).toBe(200)
    expect(odd.getExact).toHaveBeenCalledWith('marketplace/p/audio/t/a.wav', undefined)
  })

  it('refuses people who are not marketplace staff', async () => {
    const {value, getExact} = context({range: 'bytes=0-99'}, false)
    expect((await getReviewAsset(value)).status).toBe(403)
    expect(getExact).not.toHaveBeenCalled()
  })
})
