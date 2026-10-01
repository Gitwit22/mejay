import {describe, expect, it} from 'vitest'

import {MarketplaceAdminService} from './admin-service'
import {DiscoveryService} from './discovery-service'
import {StoreService} from './store-service'

type TestDatabase = {
  transaction: <T>(callback: (database: TestDatabase) => Promise<T>) => Promise<T>
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => ReturnType<TestDatabase['prepare']>
    first: () => Promise<Record<string, unknown> | null>
    all: () => Promise<{results: Array<Record<string, unknown>>}>
    run: () => Promise<{success: boolean}>
  }
}

describe('publishing discovery integration', () => {
  it('makes one LIVE release visible to both Store and Music feeds', async () => {
    let status = 'APPROVED'
    let version = 1
    let saleReady = false
    const release = {id: 'release-1', title: 'Launch Day', release_type: 'single'}

    const database: TestDatabase = {
      transaction: async <T>(callback: (db: TestDatabase) => Promise<T>) => callback(database),
      prepare: (sql: string) => {
        let values: unknown[] = []
        const statement = {
          bind: (...next: unknown[]) => {values = next; return statement},
          first: async () => {
            if (sql.includes('FROM marketplace_staff')) return {role: 'admin', protected_owner: false}
            if (sql.includes('AS has_minimum_price')) return {has_minimum_price: saleReady, stripe_ready: saleReady}
            if (sql.includes('FROM releases WHERE id') && sql.includes('FOR UPDATE')) {
              return {id: release.id, provider_profile_id: 'provider-1', status, version, scheduled_release_at: null}
            }
            if (sql.includes('UPDATE releases SET status')) {
              status = String(values[0])
              version += 1
              return {...release, provider_profile_id: 'provider-1', status, version, scheduled_release_at: null}
            }
            return null
          },
          all: async () => ({results: status === 'LIVE' && sql.includes('FROM releases r') && !sql.includes('marketplace_discovery_features feature') ? [release] : []}),
          run: async () => ({success: true}),
        }
        return statement
      },
    }

    const store = new StoreService(database as never)
    const discovery = new DiscoveryService(database as never)
    expect(await store.listCatalog()).toEqual([])
    expect((await discovery.getOverview()).newestReleases).toEqual([])

    const admin = new MarketplaceAdminService(database as never)
    await expect(admin.commandRelease('admin-1', release.id, {
      action: 'publish_now', expectedVersion: 1,
    })).rejects.toMatchObject({status: 422, code: 'release_sale_not_ready'})

    saleReady = true
    await admin.commandRelease('admin-1', release.id, {
      action: 'publish_now', expectedVersion: 1,
    })

    expect(await store.listCatalog()).toEqual([release])
    const overview = await discovery.getOverview()
    expect(overview.newestReleases).toEqual([release])
    expect(overview.newestSingles).toEqual([release])
  })
})
