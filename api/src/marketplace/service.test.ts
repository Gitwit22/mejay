import {describe, expect, it, vi} from 'vitest'
import {isReleaseMutable, isReleaseTransitionAllowed, MarketplaceService} from './service'

describe('release state machine', () => {
  it('allows only adjacent provider workflow transitions', () => {
    expect(isReleaseTransitionAllowed('DRAFT', 'METADATA_COMPLETE')).toBe(true)
    expect(isReleaseTransitionAllowed('METADATA_COMPLETE', 'RIGHTS_COMPLETE')).toBe(true)
    expect(isReleaseTransitionAllowed('RIGHTS_COMPLETE', 'ISRC_COMPLETE')).toBe(true)
    expect(isReleaseTransitionAllowed('ISRC_COMPLETE', 'PRICING_COMPLETE')).toBe(true)
    expect(isReleaseTransitionAllowed('PRICING_COMPLETE', 'SUBMITTED')).toBe(true)
    expect(isReleaseTransitionAllowed('DRAFT', 'SUBMITTED')).toBe(false)
    expect(isReleaseTransitionAllowed('SUBMITTED', 'DRAFT')).toBe(false)
  })

  it('supports the approved scheduling branch', () => {
    expect(isReleaseTransitionAllowed('SUBMITTED', 'UNDER_REVIEW')).toBe(true)
    expect(isReleaseTransitionAllowed('UNDER_REVIEW', 'APPROVED')).toBe(true)
    expect(isReleaseTransitionAllowed('APPROVED', 'SCHEDULED')).toBe(true)
    expect(isReleaseTransitionAllowed('APPROVED', 'LIVE')).toBe(true)
    expect(isReleaseTransitionAllowed('SCHEDULED', 'LIVE')).toBe(true)
    expect(isReleaseTransitionAllowed('LIVE', 'APPROVED')).toBe(true)
  })

  it('locks release-owned records at submission', () => {
    expect(isReleaseMutable('DRAFT')).toBe(true)
    expect(isReleaseMutable('PRICING_COMPLETE')).toBe(true)
    expect(isReleaseMutable('CHANGES_REQUESTED')).toBe(true)
    expect(isReleaseMutable('SUBMITTED')).toBe(false)
    expect(isReleaseMutable('UNDER_REVIEW')).toBe(false)
    expect(isReleaseMutable('LIVE')).toBe(false)
  })

  it('blocks provider writes when the Pro subscription has lapsed', async () => {
    const statements: string[] = []
    const database: any = {
      transaction: vi.fn(async (callback: (db: any) => Promise<unknown>) => callback({
        prepare: (sql: string) => {
          statements.push(sql)
          const statement: any = {
            bind: vi.fn(() => statement),
            first: vi.fn(async () => sql.includes('FROM entitlements')
              ? {stripe_subscription_id: 'sub_123', subscription_status: 'past_due'}
              : null),
            run: vi.fn(),
          }
          return statement
        },
      })),
    }
    const service = new MarketplaceService(database)

    await expect(service.createArtist('user-1', {name: 'Blocked Artist', metadata: {}})).rejects.toMatchObject({
      status: 403,
      code: 'pro_subscription_required',
    })
    expect(statements.some((sql) => sql.includes('INSERT INTO artists'))).toBe(false)
  })

  it('scopes artist reads to the provider membership', async () => {
    const boundValues: unknown[][] = []
    const database = {
      prepare: (sql: string) => {
        const statement = {
          bind: vi.fn(),
          first: vi.fn(async () => sql.includes('FROM provider_members')
            ? {provider_profile_id: 'provider-7', role: 'viewer'}
            : null),
          all: vi.fn(async () => ({results: [{id: 'artist-1', name: 'Sample Artist'}]})),
          run: vi.fn(),
        }
        statement.bind.mockImplementation((...values: unknown[]) => {
          boundValues.push(values)
          return statement
        })
        return statement
      },
    }

    const service = new MarketplaceService(database as never)
    await expect(service.listArtists('user-1')).resolves.toEqual([{id: 'artist-1', name: 'Sample Artist'}])
    expect(boundValues).toContainEqual(['provider-7'])
  })

  it('scopes release detail reads to the provider membership', async () => {
    const boundValues: unknown[][] = []
    const database = {
      prepare: (sql: string) => {
        const statement = {
          bind: vi.fn(),
          first: vi.fn(async () => sql.includes('FROM provider_members')
            ? {provider_profile_id: 'provider-7', role: 'viewer'}
            : sql.includes('FROM releases r') ? {id: 'release-2'} : null),
          all: vi.fn(async () => ({results: []})),
          run: vi.fn(),
        }
        statement.bind.mockImplementation((...values: unknown[]) => {
          boundValues.push(values)
          return statement
        })
        return statement
      },
    }

    const service = new MarketplaceService(database as never)
    await expect(service.getRelease('user-1', 'release-2')).resolves.toMatchObject({release: {id: 'release-2'}})
    expect(boundValues).toContainEqual(['release-2', 'provider-7'])
  })

  it('fails generated assignment when the purchased prefix is not configured', async () => {
    const service = new MarketplaceService({} as never)
    await expect(service.assignGeneratedIsrc('user-1', 'track-1', null)).rejects.toMatchObject({
      status: 503,
      code: 'isrc_generation_unavailable',
    })
  })
})
