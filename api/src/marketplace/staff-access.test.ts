import {describe, expect, it, vi} from 'vitest'

import {claimMarketplaceAccess} from './staff-access'

describe('marketplace staff access claims', () => {
  it('claims the seeded owner invitation without Stripe billing data', async () => {
    const statements: Array<{sql: string; values: unknown[]}> = []
    const database: any = {
      prepare: vi.fn((sql: string) => {
        const statement: any = {
          bind: vi.fn((...values: unknown[]) => {
            statements.push({sql, values})
            return statement
          }),
          first: vi.fn(async () => {
            if (sql.includes('FROM marketplace_staff_invites')) {
              return {
                role: 'admin',
                protected_owner: true,
                full_site_access: true,
                artist_portal_access: true,
              }
            }
            return null
          }),
          run: vi.fn().mockResolvedValue({success: true}),
        }
        return statement
      }),
    }
    database.transaction = vi.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(database))

    await expect(claimMarketplaceAccess(
      database,
      'user-1',
      ' NxtLvlTechLLC@Gmail.com ',
    )).resolves.toEqual({
      role: 'admin',
      protectedOwner: true,
      fullSiteAccess: true,
      artistPortalAccess: true,
    })

    expect(statements.some(({sql}) => sql.includes('INSERT INTO marketplace_staff '))).toBe(true)
    expect(statements.some(({sql}) => sql.includes('INSERT INTO platform_access_grants'))).toBe(true)
    expect(statements.some(({sql}) => sql.includes('INSERT INTO provider_profiles'))).toBe(true)
    expect(statements.some(({sql}) => sql.includes('INSERT INTO provider_members'))).toBe(true)
    expect(statements.some(({sql}) => sql.includes("UPDATE users SET account_intent = 'provider'"))).toBe(true)
    expect(statements.find(({sql}) => sql.includes('FROM marketplace_staff_invites'))?.values).toEqual([
      'nxtlvltechllc@gmail.com',
    ])
  })

  it('does nothing when there is no pending invitation', async () => {
    const run = vi.fn()
    const database: any = {
      prepare: vi.fn(() => {
        const statement: any = {
          bind: vi.fn(() => statement),
          first: vi.fn().mockResolvedValue(null),
          run,
        }
        return statement
      }),
    }

    await expect(claimMarketplaceAccess(database, 'user-2', 'person@example.com')).resolves.toBeNull()
    expect(run).not.toHaveBeenCalled()
  })
})