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
})