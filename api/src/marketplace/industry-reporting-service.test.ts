import {describe, expect, it} from 'vitest'

import {buildReportingCsv, type IndustryReportingExportEvent} from './industry-reporting-service'

const event: IndustryReportingExportEvent = {
  id: 'event-1',
  orderId: 'order-1',
  orderItemId: 'item-1',
  ledgerTransactionId: 'ledger-1',
  trackId: 'track-1',
  eventType: 'sale',
  isrc: 'QTA3L2600001',
  upc: '123456789012',
  artistName: 'Artist, Jr.',
  releaseTitle: 'Night "Drive"',
  trackTitle: 'Getaway',
  stripeTransactionId: 'pi_1',
  currency: 'USD',
  priceMinor: 100,
  quantity: 1,
  territory: 'US',
  occurredAt: '2026-09-17T10:00:00.000Z',
  validation_status: 'ready',
  validation_errors: [],
  batch_id: null,
}

describe('industry reporting CSV export', () => {
  it('exports identifiers, transaction trace, and escaped metadata', () => {
    const csv = buildReportingCsv([event])

    expect(csv).toContain('event_id,event_type,isrc,upc,artist,release,track,transaction,ledger_transaction')
    expect(csv).toContain('event-1,sale,QTA3L2600001,123456789012,"Artist, Jr.","Night ""Drive""",Getaway,pi_1,ledger-1,100,USD,1,US')
    expect(csv.endsWith('\r\n')).toBe(true)
  })
})
