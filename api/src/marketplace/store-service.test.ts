import {describe, expect, it, vi} from 'vitest'

import {StoreService} from './store-service'

describe('public music store policy', () => {
  it('filters catalog listings to LIVE releases in the database query', async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(),
      first: vi.fn(),
      all: vi.fn().mockResolvedValue({results: []}),
      run: vi.fn(),
      sql,
    }))

    await expect(new StoreService({prepare} as never).listCatalog()).resolves.toEqual([])
    expect(prepare.mock.calls[0][0]).toContain("WHERE r.status = 'LIVE'")
    expect(prepare.mock.calls[0][0]).toContain("provider.stripe_transfers_status = 'active'")
  })

  it('requires LIVE status when resolving public catalog assets', async () => {
    let query = ''
    const statement = {
      bind: vi.fn(() => statement),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn(),
      run: vi.fn(),
    }
    const service = new StoreService({prepare: (sql: string) => {query = sql; return statement}} as never)

    await expect(service.getAsset('asset-1')).rejects.toMatchObject({status: 404, code: 'not_found'})
    expect(query).toContain("r.status = 'LIVE'")
  })

  it('records only ready audio previews belonging to LIVE releases', async () => {
    const queries: string[] = []
    const statement = {
      bind: vi.fn(() => statement),
      first: vi.fn().mockResolvedValue({id: 'asset-1', track_id: 'track-1', release_id: 'release-1'}),
      all: vi.fn(),
      run: vi.fn().mockResolvedValue({success: true}),
    }
    const service = new StoreService({prepare: (sql: string) => {queries.push(sql); return statement}} as never)

    await expect(service.recordPreview('asset-1', null)).resolves.toBeUndefined()
    expect(queries[0]).toContain("asset.kind = 'audio'")
    expect(queries[0]).toContain("release.status = 'LIVE'")
    expect(queries[1]).toContain('INSERT INTO marketplace_preview_events')
  })

  it('rejects preview events when the public audio asset cannot be resolved', async () => {
    const statement = {
      bind: vi.fn(() => statement),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn(),
      run: vi.fn(),
    }

    await expect(new StoreService({prepare: () => statement} as never).recordPreview('missing', null))
      .rejects.toMatchObject({status: 404, code: 'preview_not_found'})
    expect(statement.run).not.toHaveBeenCalled()
  })
})