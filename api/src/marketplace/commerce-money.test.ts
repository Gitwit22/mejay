import {describe, expect, it} from 'vitest'

import {allocateProviderProceeds, assertBalancedLedger, calculateSaleAmounts, DEFAULT_PLATFORM_FEE_BPS, estimateStripeFeeMinor, refundLedgerEntries, saleLedgerEntries} from './commerce-money'

describe('marketplace commerce money', () => {
  it('calculates the configured platform fee in integer minor units', () => {
    expect(calculateSaleAmounts(129, 1000)).toEqual({
      grossAmountMinor: 129,
      platformFeeMinor: 13,
      processingFeeMinor: 0,
      providerProceedsMinor: 116,
    })
  })

  it('deducts the Stripe processing fee from provider proceeds', () => {
    // $1.00 sale: 10¢ commission + 33¢ Stripe fee recovered; provider keeps 57¢.
    expect(estimateStripeFeeMinor(100)).toBe(33)
    expect(calculateSaleAmounts(100, 1000, 33)).toEqual({
      grossAmountMinor: 100,
      platformFeeMinor: 43,
      processingFeeMinor: 33,
      providerProceedsMinor: 57,
    })
  })

  it('splits a $3 minimum-price sale with the default 10% MEJay cut', () => {
    expect(DEFAULT_PLATFORM_FEE_BPS).toBe(1000)
    const stripeFee = estimateStripeFeeMinor(300)
    expect(stripeFee).toBe(39)
    expect(calculateSaleAmounts(300, DEFAULT_PLATFORM_FEE_BPS, stripeFee)).toEqual({
      grossAmountMinor: 300,
      platformFeeMinor: 69,
      processingFeeMinor: 39,
      providerProceedsMinor: 231,
    })
  })

  it('takes exactly $1.00 commission on a $10.00 sale at the default rate', () => {
    const stripeFee = estimateStripeFeeMinor(1000)
    expect(stripeFee).toBe(59)
    const amounts = calculateSaleAmounts(1000, DEFAULT_PLATFORM_FEE_BPS, stripeFee)
    // platformFeeMinor = 100 commission + 59 recovered processing fee.
    expect(amounts).toEqual({grossAmountMinor: 1000, platformFeeMinor: 159, processingFeeMinor: 59, providerProceedsMinor: 841})
    expect(amounts.platformFeeMinor - amounts.processingFeeMinor).toBe(100)
  })

  it('reverses a $10.00 sale at the same rate whether refunded in full or in parts', () => {
    const full = refundLedgerEntries({grossAmountMinor: 1000, platformFeeMinor: 159, previousRefundedMinor: 0, refundedAmountMinor: 1000})
    expect(full).toEqual([
      {accountCode: 'platform_revenue', debitMinor: 159, creditMinor: 0},
      {accountCode: 'provider_payable', debitMinor: 841, creditMinor: 0},
      {accountCode: 'stripe_clearing', debitMinor: 0, creditMinor: 1000},
    ])
    const first = refundLedgerEntries({grossAmountMinor: 1000, platformFeeMinor: 159, previousRefundedMinor: 0, refundedAmountMinor: 500})
    const second = refundLedgerEntries({grossAmountMinor: 1000, platformFeeMinor: 159, previousRefundedMinor: 500, refundedAmountMinor: 1000})
    const total = (account: string) => [...first, ...second].filter((entry) => entry.accountCode === account).reduce((sum, entry) => sum + entry.debitMinor, 0)
    expect(total('platform_revenue')).toBe(159)
    expect(total('provider_payable')).toBe(841)
  })

  it('never lets fees push provider proceeds below zero', () => {
    const amounts = calculateSaleAmounts(100, 9000, 33)
    expect(amounts.providerProceedsMinor).toBe(0)
    expect(amounts.platformFeeMinor).toBe(100)
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

  it('posts only the incremental amount for successive partial refunds', () => {
    expect(refundLedgerEntries({grossAmountMinor: 1000, platformFeeMinor: 100, previousRefundedMinor: 200, refundedAmountMinor: 500})).toEqual([
      {accountCode: 'platform_revenue', debitMinor: 30, creditMinor: 0},
      {accountCode: 'provider_payable', debitMinor: 270, creditMinor: 0},
      {accountCode: 'stripe_clearing', debitMinor: 0, creditMinor: 300},
    ])
    expect(refundLedgerEntries({grossAmountMinor: 1000, platformFeeMinor: 100, previousRefundedMinor: 500, refundedAmountMinor: 1000})).toEqual([
      {accountCode: 'platform_revenue', debitMinor: 50, creditMinor: 0},
      {accountCode: 'provider_payable', debitMinor: 450, creditMinor: 0},
      {accountCode: 'stripe_clearing', debitMinor: 0, creditMinor: 500},
    ])
  })
})