import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getOwnAudio} from './index'

const {getSessionUserId} = vi.hoisted(() => ({getSessionUserId: vi.fn()}))

vi.mock('../_auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('../_auth')>(),
  getSessionUserId: (...args: unknown[]) => getSessionUserId(...args),
}))

/** Answers the two queries getOwnAudio makes: the caller's provider and the asset row (scoped to it). */
function fakeDb(asset: Record<string, unknown> | null) {
  const binds: unknown[][] = []
  return {
    binds,
    prepare: (sql: string) => {
      const statement = {
        bind: (...values: unknown[]) => { binds.push(values); return statement },
        first: async () => sql.includes('provider_members') ? {provider_profile_id: 'provider-1', role: 'owner', suspended_at: null} : asset,
      }
      return statement
    },
  }
}

const master = {storage_key: 'mejay-artist/provider-1/audio/track-1/a.wav', mime_type: 'audio/wav', kind: 'audio', file_name: 'master.wav'}

function context(headers: Record<string, string> = {}, asset: Record<string, unknown> | null = master) {
  const getExact = vi.fn(async (_key: string, range?: string) => ({
    body: new Response('x'.repeat(100)).body!,
    contentLength: range ? 100 : 5000,
    contentRange: range ? 'bytes 0-99/5000' : undefined,
  }))
  const db = fakeDb(asset)
  return {
    getExact, db,
    value: {request: new Request('https://mejay.app/api/marketplace/assets/asset-1/audio', {headers}), env: {DB: db, DOWNLOADS: {getExact}} as never, params: {assetId: 'asset-1'}},
  }
}

describe("artist's own song audio route", () => {
  beforeEach(() => {
    getSessionUserId.mockReset().mockResolvedValue('user-1')
  })

  it('streams byte ranges of the owner\'s file, privately', async () => {
    const {value, getExact, db} = context({range: 'bytes=0-99'})
    const response = await getOwnAudio(value)
    expect(response.status).toBe(206)
    expect(getExact).toHaveBeenCalledWith(master.storage_key, 'bytes=0-99')
    expect(response.headers.get('content-range')).toBe('bytes 0-99/5000')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    // The asset lookup is scoped to the caller's own provider.
    expect(db.binds).toContainEqual(['asset-1', 'provider-1'])
  })

  it('returns the whole file without a range and ignores malformed ranges', async () => {
    expect((await getOwnAudio(context().value)).status).toBe(200)
    const odd = context({range: 'bytes=0-99,200-300'})
    expect((await getOwnAudio(odd.value)).status).toBe(200)
    expect(odd.getExact).toHaveBeenCalledWith(master.storage_key, undefined)
  })

  it('requires a session and hides files the caller does not own', async () => {
    getSessionUserId.mockResolvedValueOnce(null)
    const anonymous = context()
    expect((await getOwnAudio(anonymous.value)).status).toBe(401)
    expect(anonymous.getExact).not.toHaveBeenCalled()

    const notOwned = context({}, null)
    expect((await getOwnAudio(notOwned.value)).status).toBe(404)
    expect(notOwned.getExact).not.toHaveBeenCalled()
  })

  it('never serves objects outside MeJay upload storage', async () => {
    const outside = context({}, {...master, storage_key: 'other-bucket/secret.wav'})
    expect((await getOwnAudio(outside.value)).status).toBe(404)
    expect(outside.getExact).not.toHaveBeenCalled()
  })
})
