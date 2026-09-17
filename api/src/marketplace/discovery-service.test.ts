import {describe, expect, it, vi} from 'vitest'

import {DiscoveryService} from './discovery-service'

describe('music discovery policy', () => {
  it('builds LIVE-gated feeds from explicit ranking sources', async () => {
    const queries: string[] = []
    const prepare = vi.fn((sql: string) => {
      queries.push(sql)
      return {all: vi.fn().mockResolvedValue({results: []})}
    })

    await expect(new DiscoveryService({prepare} as never).getOverview()).resolves.toEqual({
      newestReleases: [],
      newestSingles: [],
      newestProjects: [],
      mostPurchased: [],
      mostPreviewed: [],
      featuredReleases: [],
      featuredArtists: [],
    })

    expect(queries).toHaveLength(7)
    expect(queries.slice(0, 6).every((query) => query.includes("r.status = 'LIVE'"))).toBe(true)
    expect(queries[1]).toContain("r.release_type = 'single'")
    expect(queries[2]).toContain("r.release_type IN ('ep', 'album')")
    expect(queries[3]).toContain('marketplace_order_items')
    expect(queries[3]).toContain("payment_status IN ('paid', 'partially_refunded')")
    expect(queries[3]).toContain('purchased.order_item_id IS NOT NULL')
    expect(queries[4]).toContain('marketplace_preview_events')
    expect(queries[4]).toContain('preview_event.id IS NOT NULL')
    expect(queries[5]).toContain('marketplace_discovery_features')
    expect(queries[6]).toContain("live_release.status = 'LIVE'")
    expect(queries[6]).toContain('ORDER BY feature.position ASC')
  })
})
