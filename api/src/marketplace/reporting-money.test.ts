import {describe, expect, it} from 'vitest'

import {providerRefundAmount, reconcileRecipientAllocations, reportingOrderAmounts} from './reporting-money'

describe('marketplace reporting money', () => {
  const order = {
    grossAmountMinor: 1000,
    platformFeeMinor: 100,
    providerProceedsMinor: 900,
    refundedAmountMinor: 0,
    transferStatus: 'pending' as const,
    disputeStatus: 'none' as const,
  }

  it('reconciles provider earnings, pending transfers, and paid transfers', () => {
    expect(reportingOrderAmounts(order)).toEqual({providerRefundMinor: 0, earningsMinor: 900, pendingMinor: 900, paidOutMinor: 0})
    expect(reportingOrderAmounts({...order, transferStatus: 'transferred'})).toEqual({providerRefundMinor: 0, earningsMinor: 900, pendingMinor: 0, paidOutMinor: 900})
    expect(reportingOrderAmounts({...order, transferStatus: 'reversed'}).paidOutMinor).toBe(0)
  })

  it('uses commerce refund apportionment for partial and full refunds', () => {
    expect(providerRefundAmount({...order, refundedAmountMinor: 333})).toBe(300)
    expect(providerRefundAmount({...order, refundedAmountMinor: 1000})).toBe(900)
    expect(reportingOrderAmounts({...order, refundedAmountMinor: 333}).earningsMinor).toBe(600)
  })

  it('excludes open disputes from pending and lost disputes from earnings', () => {
    expect(reportingOrderAmounts({...order, disputeStatus: 'open'})).toMatchObject({earningsMinor: 900, pendingMinor: 0})
    expect(reportingOrderAmounts({...order, disputeStatus: 'lost'})).toMatchObject({earningsMinor: 0, pendingMinor: 0})
  })

  it('redistributes refund-adjusted proceeds with deterministic penny rounding', () => {
    const result = reconcileRecipientAllocations(8, [
      {id: 'artist', amountMinor: 6},
      {id: 'producer', amountMinor: 3},
    ])
    expect(Object.fromEntries(result)).toEqual({artist: 5, producer: 3})
    expect([...result.values()].reduce((sum, value) => sum + value, 0)).toBe(8)
  })
})
