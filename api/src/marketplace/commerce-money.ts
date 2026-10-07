export type SplitInput = {
  id: string
  payeeName: string
  payeeEmail?: string | null
  role?: string | null
  shareBps: number
}

export type TrackSplitInput = {
  id: string
  title: string
  splits: SplitInput[]
}

export type SplitAllocation = SplitInput & {
  trackId: string
  trackTitle: string
  amountMinor: number
}

/** MEJay's default cut of each store sale, in basis points (2000 = 20%). */
export const DEFAULT_PLATFORM_FEE_BPS = 2000

export type SaleAmounts = {
  grossAmountMinor: number
  /**
   * Everything the platform retains: the platform fee plus recovery of Stripe's processing fee.
   * Always satisfies platformFeeMinor + providerProceedsMinor = grossAmountMinor.
   */
  platformFeeMinor: number
  /** Portion of platformFeeMinor that recovers Stripe's processing fee (borne by the provider). */
  processingFeeMinor: number
  providerProceedsMinor: number
}

function requireMinorUnits(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`)
}

function distributeByWeights<T extends {id: string}>(amountMinor: number, values: T[], weight: (value: T) => number): Map<string, number> {
  requireMinorUnits(amountMinor, 'amountMinor')
  if (values.length === 0) throw new Error('At least one allocation target is required')
  const totalWeight = values.reduce((sum, value) => sum + weight(value), 0)
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) throw new Error('Allocation weights must have a positive integer total')

  const rows = values.map((value) => {
    const weighted = amountMinor * weight(value)
    if (!Number.isSafeInteger(weighted)) throw new Error('Allocation exceeds safe integer precision')
    return {value, amount: Math.floor(weighted / totalWeight), remainder: weighted % totalWeight}
  })
  let remaining = amountMinor - rows.reduce((sum, row) => sum + row.amount, 0)
  rows.sort((left, right) => right.remainder - left.remainder || left.value.id.localeCompare(right.value.id))
  for (let index = 0; index < rows.length && remaining > 0; index += 1, remaining -= 1) rows[index].amount += 1
  return new Map(rows.map((row) => [row.value.id, row.amount]))
}

/**
 * The configured platform commission (MARKETPLACE_PLATFORM_FEE_BPS), validated. Every service that
 * prices a sale reads the rate through here so checkout, webhooks, and estimates cannot diverge.
 */
export function resolvePlatformFeeBps(env: {MARKETPLACE_PLATFORM_FEE_BPS?: string}): number {
  const raw = String(env.MARKETPLACE_PLATFORM_FEE_BPS ?? '').trim()
  const value = raw ? Number(raw) : DEFAULT_PLATFORM_FEE_BPS
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error('MARKETPLACE_PLATFORM_FEE_BPS must be an integer between 0 and 10000')
  }
  return value
}

export type SaleEstimate = {
  grossAmountMinor: number
  platformCommissionMinor: number
  estimatedProcessingFeeMinor: number
  estimatedArtistProceedsMinor: number
}

/**
 * Artist-facing estimate for one sale. It runs the exact calculation fulfillment uses when Stripe has
 * not yet reported the real fee; the final processing fee comes from Stripe's balance transaction.
 */
export function estimateSale(grossAmountMinor: number, platformFeeBps: number): SaleEstimate {
  const amounts = calculateSaleAmounts(grossAmountMinor, platformFeeBps, estimateStripeFeeMinor(grossAmountMinor))
  return {
    grossAmountMinor: amounts.grossAmountMinor,
    platformCommissionMinor: amounts.platformFeeMinor - amounts.processingFeeMinor,
    estimatedProcessingFeeMinor: amounts.processingFeeMinor,
    estimatedArtistProceedsMinor: amounts.providerProceedsMinor,
  }
}

/** Conservative estimate of Stripe's standard US card fee (2.9% + 30¢) when the real fee is unknown. */
export function estimateStripeFeeMinor(grossAmountMinor: number): number {
  requireMinorUnits(grossAmountMinor, 'grossAmountMinor')
  return Math.floor((grossAmountMinor * 290 + 5000) / 10000) + 30
}

export function calculateSaleAmounts(grossAmountMinor: number, platformFeeBps: number, processingFeeMinor = 0): SaleAmounts {
  if (!Number.isSafeInteger(grossAmountMinor) || grossAmountMinor <= 0) throw new Error('grossAmountMinor must be a positive safe integer')
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10000) {
    throw new Error('platformFeeBps must be between 0 and 10000')
  }
  requireMinorUnits(processingFeeMinor, 'processingFeeMinor')
  const weightedFee = grossAmountMinor * platformFeeBps
  if (!Number.isSafeInteger(weightedFee)) throw new Error('Fee calculation exceeds safe integer precision')
  const commissionMinor = Math.floor((weightedFee + 5000) / 10000)
  // The provider bears the processing fee, but proceeds can never go negative.
  const recoveredProcessingMinor = Math.min(processingFeeMinor, grossAmountMinor - commissionMinor)
  const platformFeeMinor = commissionMinor + recoveredProcessingMinor
  return {
    grossAmountMinor,
    platformFeeMinor,
    processingFeeMinor: recoveredProcessingMinor,
    providerProceedsMinor: grossAmountMinor - platformFeeMinor,
  }
}

export function allocateProviderProceeds(providerProceedsMinor: number, tracks: TrackSplitInput[]): SplitAllocation[] {
  requireMinorUnits(providerProceedsMinor, 'providerProceedsMinor')
  const orderedTracks = [...tracks].sort((left, right) => left.id.localeCompare(right.id))
  const trackAmounts = distributeByWeights(providerProceedsMinor, orderedTracks, () => 1)

  return orderedTracks.flatMap((track) => {
    const shareTotal = track.splits.reduce((sum, split) => sum + split.shareBps, 0)
    if (shareTotal !== 10000) throw new Error(`Track ${track.id} splits must total 10000 basis points`)
    const splitIds = new Set(track.splits.map((split) => split.id))
    if (splitIds.size !== track.splits.length) throw new Error(`Track ${track.id} split IDs must be unique`)
    const splitAmounts = distributeByWeights(trackAmounts.get(track.id) ?? 0, track.splits, (split) => split.shareBps)
    return track.splits.map((split) => ({
      ...split,
      trackId: track.id,
      trackTitle: track.title,
      amountMinor: splitAmounts.get(split.id) ?? 0,
    }))
  })
}

export type LedgerEntry = {accountCode: string; debitMinor: number; creditMinor: number}

export function assertBalancedLedger(entries: LedgerEntry[]): void {
  if (entries.length < 2) throw new Error('A ledger transaction requires at least two entries')
  let debits = 0
  let credits = 0
  for (const entry of entries) {
    requireMinorUnits(entry.debitMinor, 'debitMinor')
    requireMinorUnits(entry.creditMinor, 'creditMinor')
    if ((entry.debitMinor > 0) === (entry.creditMinor > 0)) throw new Error('Each ledger entry must contain exactly one positive side')
    debits += entry.debitMinor
    credits += entry.creditMinor
  }
  if (debits !== credits) throw new Error(`Ledger transaction is unbalanced: ${debits} debits != ${credits} credits`)
}

export function saleLedgerEntries(amounts: SaleAmounts): LedgerEntry[] {
  const entries = [
    {accountCode: 'stripe_clearing', debitMinor: amounts.grossAmountMinor, creditMinor: 0},
    {accountCode: 'platform_revenue', debitMinor: 0, creditMinor: amounts.platformFeeMinor},
    {accountCode: 'provider_payable', debitMinor: 0, creditMinor: amounts.providerProceedsMinor},
  ].filter((entry) => entry.debitMinor > 0 || entry.creditMinor > 0)
  assertBalancedLedger(entries)
  return entries
}

export function refundLedgerEntries(input: {
  grossAmountMinor: number
  platformFeeMinor: number
  previousRefundedMinor: number
  refundedAmountMinor: number
}): LedgerEntry[] {
  requireMinorUnits(input.grossAmountMinor, 'grossAmountMinor')
  requireMinorUnits(input.platformFeeMinor, 'platformFeeMinor')
  requireMinorUnits(input.previousRefundedMinor, 'previousRefundedMinor')
  requireMinorUnits(input.refundedAmountMinor, 'refundedAmountMinor')
  if (input.grossAmountMinor <= 0 || input.platformFeeMinor > input.grossAmountMinor) throw new Error('Original sale amounts are inconsistent')
  if (input.previousRefundedMinor >= input.refundedAmountMinor || input.refundedAmountMinor > input.grossAmountMinor) throw new Error('Refund totals must increase without exceeding gross')
  const platformAt = (refundedMinor: number) => refundedMinor === input.grossAmountMinor
    ? input.platformFeeMinor
    : Math.floor(refundedMinor * input.platformFeeMinor / input.grossAmountMinor)
  const refundDeltaMinor = input.refundedAmountMinor - input.previousRefundedMinor
  const platformRefundMinor = platformAt(input.refundedAmountMinor) - platformAt(input.previousRefundedMinor)
  const providerRefundMinor = refundDeltaMinor - platformRefundMinor
  const entries = [
    {accountCode: 'platform_revenue', debitMinor: platformRefundMinor, creditMinor: 0},
    {accountCode: 'provider_payable', debitMinor: providerRefundMinor, creditMinor: 0},
    {accountCode: 'stripe_clearing', debitMinor: 0, creditMinor: refundDeltaMinor},
  ].filter((entry) => entry.debitMinor > 0 || entry.creditMinor > 0)
  assertBalancedLedger(entries)
  return entries
}