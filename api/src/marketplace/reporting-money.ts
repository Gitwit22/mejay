export type ReportingOrderMoney = {
  grossAmountMinor: number
  platformFeeMinor: number
  providerProceedsMinor: number
  refundedAmountMinor: number
  transferStatus: 'pending' | 'transferred' | 'reversing' | 'reversed' | 'failed'
  disputeStatus: 'none' | 'open' | 'won' | 'lost'
}

export type ReportingOrderAmounts = {
  providerRefundMinor: number
  earningsMinor: number
  pendingMinor: number
  paidOutMinor: number
}

export type RecipientAllocation = {
  id: string
  amountMinor: number
}

function requireMinor(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`)
}

export function providerRefundAmount(order: Pick<ReportingOrderMoney, 'grossAmountMinor' | 'platformFeeMinor' | 'refundedAmountMinor'>): number {
  requireMinor(order.grossAmountMinor, 'grossAmountMinor')
  requireMinor(order.platformFeeMinor, 'platformFeeMinor')
  requireMinor(order.refundedAmountMinor, 'refundedAmountMinor')
  if (order.grossAmountMinor <= 0) throw new Error('grossAmountMinor must be positive')
  if (order.platformFeeMinor > order.grossAmountMinor || order.refundedAmountMinor > order.grossAmountMinor) {
    throw new Error('Order amounts are inconsistent')
  }
  if (order.refundedAmountMinor === 0) return 0
  const platformRefundMinor = order.refundedAmountMinor === order.grossAmountMinor
    ? order.platformFeeMinor
    : Math.floor(order.refundedAmountMinor * order.platformFeeMinor / order.grossAmountMinor)
  return order.refundedAmountMinor - platformRefundMinor
}

export function reportingOrderAmounts(order: ReportingOrderMoney): ReportingOrderAmounts {
  requireMinor(order.providerProceedsMinor, 'providerProceedsMinor')
  if (order.platformFeeMinor + order.providerProceedsMinor !== order.grossAmountMinor) {
    throw new Error('Provider proceeds and platform fee must equal gross')
  }
  const providerRefundMinor = providerRefundAmount(order)
  const earningsMinor = order.disputeStatus === 'lost' ? 0 : Math.max(0, order.providerProceedsMinor - providerRefundMinor)
  const pendingMinor = order.disputeStatus === 'open' || order.disputeStatus === 'lost'
    ? 0
    : ['pending', 'failed'].includes(order.transferStatus) ? earningsMinor : 0
  const paidOutMinor = order.transferStatus === 'transferred' ? order.providerProceedsMinor : 0
  return {providerRefundMinor, earningsMinor, pendingMinor, paidOutMinor}
}

export function reconcileRecipientAllocations(netProviderMinor: number, allocations: RecipientAllocation[]): Map<string, number> {
  requireMinor(netProviderMinor, 'netProviderMinor')
  if (allocations.length === 0) return new Map()
  const ids = new Set(allocations.map(({id}) => id))
  if (ids.size !== allocations.length) throw new Error('Allocation IDs must be unique')
  for (const allocation of allocations) requireMinor(allocation.amountMinor, 'amountMinor')
  const originalTotal = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0)
  if (netProviderMinor > originalTotal) throw new Error('Net provider amount cannot exceed original allocations')
  if (originalTotal === 0) {
    if (netProviderMinor !== 0) throw new Error('A positive net amount requires positive allocations')
    return new Map(allocations.map(({id}) => [id, 0]))
  }

  const rows = allocations.map((allocation) => {
    const weighted = netProviderMinor * allocation.amountMinor
    if (!Number.isSafeInteger(weighted)) throw new Error('Allocation exceeds safe integer precision')
    return {id: allocation.id, amountMinor: Math.floor(weighted / originalTotal), remainder: weighted % originalTotal}
  })
  let remaining = netProviderMinor - rows.reduce((sum, row) => sum + row.amountMinor, 0)
  rows.sort((left, right) => right.remainder - left.remainder || left.id.localeCompare(right.id))
  for (let index = 0; index < rows.length && remaining > 0; index += 1, remaining -= 1) rows[index].amountMinor += 1
  return new Map(rows.map(({id, amountMinor}) => [id, amountMinor]))
}
