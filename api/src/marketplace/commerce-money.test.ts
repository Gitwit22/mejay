import {describe, expect, it} from 'vitest'

import {allocateProviderProceeds, assertBalancedLedger, calculateSaleAmounts, saleLedgerEntries} from './commerce-money'

describe('marketplace commerce money', () => {
  it('calculates the configured platform fee in integer minor units', () => {
    expect(calculateSaleAmounts(129, 1000)).toEqual({
      grossAmountMinor: 129,
      platformFeeMinor: 13,
      providerProceedsMinor: 116,
    })
  })

  it('allocates proceeds equally by track and then by payee without losing cents', () => {
    const allocations = allocateProviderProceeds(1001, [
      {id: 'track-b', title: 'Second', splits: [
        {id: 'split-c', payeeName: 'Artist', shareBps: 7000},
        {id: 'split-d', payeeName: 'Producer', shareBps: 3000},
      ]},
      {id: 'track-a', title: 'First', splits: [
        {id: 'split-a', payeeName: 'Artist', shareBps: 7000},
        {id: 'split-b', payeeName: 'Producer', shareBps: 3000},
      ]},
    ])

    expect(allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0)).toBe(1001)
    expect(allocations.filter((allocation) => allocation.trackId === 'track-a').map((allocation) => allocation.amountMinor)).toEqual([351, 150])
    expect(allocations.filter((allocation) => allocation.trackId === 'track-b').map((allocation) => allocation.amountMinor)).toEqual([350, 150])
  })

  it('uses stable IDs to resolve equal fractional remainders', () => {
    const allocations = allocateProviderProceeds(1, [{
      id: 'track-1',
      title: 'One',
      splits: [
        {id: 'split-b', payeeName: 'B', shareBps: 5000},
        {id: 'split-a', payeeName: 'A', shareBps: 5000},
      ],
    }])
    expect(allocations.find((allocation) => allocation.id === 'split-a')?.amountMinor).toBe(1)
    expect(allocations.find((allocation) => allocation.id === 'split-b')?.amountMinor).toBe(0)
  })

  it('rejects incomplete split sets and unbalanced ledger entries', () => {
    expect(() => allocateProviderProceeds(100, [{
      id: 'track-1', title: 'One', splits: [{id: 'split-1', payeeName: 'Artist', shareBps: 9999}],
    }])).toThrow('must total 10000')
    expect(() => assertBalancedLedger([
      {accountCode: 'cash', debitMinor: 100, creditMinor: 0},
      {accountCode: 'revenue', debitMinor: 0, creditMinor: 99},
    ])).toThrow('unbalanced')
  })

  it('creates a balanced sale posting', () => {
    expect(saleLedgerEntries(calculateSaleAmounts(999, 1000))).toEqual([
      {accountCode: 'stripe_clearing', debitMinor: 999, creditMinor: 0},
      {accountCode: 'platform_revenue', debitMinor: 0, creditMinor: 100},
      {accountCode: 'provider_payable', debitMinor: 0, creditMinor: 899},
    ])
  })
})