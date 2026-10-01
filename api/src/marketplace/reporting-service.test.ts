import {describe, expect, it} from 'vitest'

import {buildProviderSalesReport, buildRecipientEarningsReport} from './reporting-service'
import {reportingPeriod} from './reporting-schemas'

const period = reportingPeriod('30d', new Date('2026-09-17T12:00:00.000Z'))
const orders = [
  {
    id: 'order-1',
    paid_at: '2026-09-15T10:00:00.000Z',
    buyer_country_code: 'US',
    gross_amount_minor: 1000,
    platform_fee_minor: 100,
    provider_proceeds_minor: 900,
    refunded_amount_minor: 200,
    payment_status: 'partially_refunded',
    transfer_status: 'pending' as const,
    dispute_status: 'none' as const,
    release_id: 'release-1',
    release_title: 'Night Drive',
    artist_name: 'Example Artist',
  },
]
const allocations = [
  {id: 'allocation-artist', order_id: 'order-1', track_id: 'track-1', track_title: 'Getaway', payee_name: 'Artist', payee_email: 'ARTIST@example.com', payee_role: 'artist', amount_minor: 600},
  {id: 'allocation-producer', order_id: 'order-1', track_id: 'track-1', track_title: 'Getaway', payee_name: 'Producer', payee_email: 'producer@example.com', payee_role: 'producer', amount_minor: 300},
]

describe('provider sales reporting', () => {
  it('reconciles every provider dashboard grouping in integer cents', () => {
    const report = buildProviderSalesReport(period, orders, allocations, [{
      release_id: 'release-1', release_title: 'Night Drive', track_id: 'track-1', track_title: 'Getaway', download_count: 3,
    }])

    expect(report.summary).toEqual({
      grossSalesMinor: 1000,
      unitsSold: 1,
      earningsMinor: 720,
      pendingMinor: 720,
      paidOutMinor: 0,
      refundsMinor: 200,
      refundCount: 1,
      downloadCount: 3,
    })
    expect(report.topSongs).toEqual([{trackId: 'track-1', title: 'Getaway', units: 1, earningsMinor: 720}])
    expect(report.salesByRelease[0]).toMatchObject({releaseId: 'release-1', units: 1, grossMinor: 1000, earningsMinor: 720, refundsMinor: 200, downloads: 3})
    expect(report.salesByDay.find(({date}) => date === '2026-09-15')).toMatchObject({units: 1, grossMinor: 1000, earningsMinor: 720})
    expect(report.salesByTerritory).toEqual([{countryCode: 'US', units: 1, grossMinor: 1000, earningsMinor: 720}])
    expect(report.refunds[0]).toMatchObject({orderId: 'order-1', amountMinor: 200, status: 'partially_refunded'})
    expect(report.recipientLiabilities).toEqual([
      {name: 'Artist', email: 'artist@example.com', role: 'artist', allocatedMinor: 600, refundAdjustmentMinor: 120, owedMinor: 480},
      {name: 'Producer', email: 'producer@example.com', role: 'producer', allocatedMinor: 300, refundAdjustmentMinor: 60, owedMinor: 240},
    ])
  })

  it('groups missing payment territory as Unknown', () => {
    const report = buildProviderSalesReport(period, [{...orders[0], buyer_country_code: null}], allocations, [])
    expect(report.salesByTerritory[0].countryCode).toBeNull()
  })

  it('keeps differently labeled liabilities separate when they share an email', () => {
    const sharedEmailAllocations = [
      {...allocations[0], amount_minor: 300},
      {...allocations[1], id: 'allocation-writer', payee_name: 'Songwriter', payee_email: 'artist@example.com', payee_role: 'writer'},
      {...allocations[1], id: 'allocation-producer'},
    ]
    const report = buildProviderSalesReport(period, orders, sharedEmailAllocations, [])

    expect(report.recipientLiabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'Artist', email: 'artist@example.com', role: 'artist'}),
      expect.objectContaining({name: 'Songwriter', email: 'artist@example.com', role: 'writer'}),
    ]))
  })
})

describe('recipient earnings reporting', () => {
  it('returns only allocations matching the normalized signed-in email', () => {
    const report = buildRecipientEarningsReport(period, ' artist@EXAMPLE.com ', orders, allocations)
    expect(report.recipientEmail).toBe('artist@example.com')
    expect(report.summary).toEqual({allocatedMinor: 600, refundAdjustmentMinor: 120, owedMinor: 480})
    expect(report.rows).toEqual([expect.objectContaining({allocationId: 'allocation-artist', trackTitle: 'Getaway', allocatedMinor: 600, refundAdjustmentMinor: 120, owedMinor: 480})])
  })
})
