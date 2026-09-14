import {describe, expect, it, vi} from 'vitest'
import {AccountDeletionService, accountDeletionEligibility} from './deletion'

const entitlement = (accessType: string, status: string | null, hasFullAccess = true) => ({
  access_type: accessType,
  has_full_access: hasFullAccess ? 1 : 0,
  subscription_status: status,
})

describe('account deletion eligibility', () => {
  it('allows accounts with no entitlement or a free entitlement', () => {
    expect(accountDeletionEligibility(null, false)).toEqual({allowed: true})
    expect(accountDeletionEligibility(entitlement('free', null, false), false)).toEqual({allowed: true})
    expect(accountDeletionEligibility(entitlement('free', 'canceled', false), false)).toEqual({allowed: true})
  })

  it.each(['active', 'trialing', 'past_due', 'unpaid'])('blocks paid subscription status %s', (status) => {
    expect(accountDeletionEligibility(entitlement('pro', status), false)).toEqual({
      allowed: false,
      code: 'subscription_active',
    })
  })

  it('blocks canceled Pro until the entitlement has returned to free', () => {
    expect(accountDeletionEligibility(entitlement('pro', 'canceled'), false)).toEqual({
      allowed: false,
      code: 'subscription_active',
    })
  })

  it('requires explicit Full Program forfeiture', () => {
    expect(accountDeletionEligibility(entitlement('full', null), false)).toEqual({
      allowed: false,
      code: 'full_program_forfeiture_required',
    })
    expect(accountDeletionEligibility(entitlement('full', null), true)).toEqual({allowed: true})
  })
})

describe('AccountDeletionService', () => {
  it('requires an owner to transfer a shared provider before deletion', async () => {
    const run = vi.fn().mockResolvedValue({success: true})
    const database: any = {
      prepare: vi.fn((sql: string) => {
        const statement: any = {
          bind: vi.fn(() => statement),
          run,
          first: vi.fn(async () => {
            if (sql.includes('FROM users WHERE id')) return {id: 'owner-1', email: 'owner@example.com'}
            if (sql.includes('FROM entitlements')) return {access_type: 'free', has_full_access: 0, subscription_status: null}
            if (sql.includes('FROM provider_members pm')) {
              return {provider_profile_id: 'provider-1', role: 'owner', owner_user_id: 'owner-1'}
            }
            if (sql.includes('SELECT user_id FROM provider_members')) return {user_id: 'member-2'}
            return null
          }),
        }
        return statement
      }),
    }
    database.transaction = vi.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(database))

    await expect(new AccountDeletionService(database).deleteCurrentUser({
      userId: 'owner-1',
      email: 'owner@example.com',
      forfeitFullProgram: false,
    })).rejects.toMatchObject({status: 409, code: 'provider_ownership_transfer_required'})
    expect(run).not.toHaveBeenCalled()
  })
})