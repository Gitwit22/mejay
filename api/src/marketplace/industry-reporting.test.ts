import {describe, expect, it, vi} from 'vitest'

import {allocateCumulativeRefunds, buildReportingEvents, insertReportingEvents} from './industry-reporting'

const base = {
  orderId: 'order-1',
  orderItemId: 'item-1',
  ledgerTransactionId: 'ledger-1',
  eventType: 'sale' as const,
  upc: '123456789012',
  artistName: 'Example Artist',
  releaseTitle: 'Night Drive',
  stripeTransactionId: 'pi_1',
  currency: 'USD',
  amountMinor: 1000,
  territory: 'US',
  occurredAt: '2026-09-17T10:00:00.000Z',
  tracks: [
    {id: 'track-2', title: 'Second', isrc: 'QTA3L2600002', discNumber: 1, trackNumber: 2},
    {id: 'track-1', title: 'First', isrc: 'QTA3L2600001', discNumber: 1, trackNumber: 1},
    {id: 'track-3', title: 'Third', isrc: 'QTA3L2600003', discNumber: 1, trackNumber: 3},
  ],
}

describe('industry reporting events', () => {
  it('allocates every cent deterministically across ordered tracks', () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
    const events = buildReportingEvents(base)

    expect(events.map(({trackId, priceMinor}) => ({trackId, priceMinor}))).toEqual([
      {trackId: 'track-1', priceMinor: 334},
      {trackId: 'track-2', priceMinor: 333},
      {trackId: 'track-3', priceMinor: 333},
    ])
    expect(events.reduce((sum, event) => sum + event.priceMinor, 0)).toBe(1000)
    expect(events.every((event) => event.validationStatus === 'ready')).toBe(true)
  })

  it('retains incomplete events with actionable metadata errors', () => {
    const [event] = buildReportingEvents({...base, upc: null, territory: null, tracks: [{...base.tracks[0], isrc: null}]})

    expect(event.validationStatus).toBe('metadata_error')
    expect(event.validationErrors).toEqual([
      'isrc_missing_or_invalid',
      'upc_missing_or_invalid',
      'territory_missing_or_invalid',
    ])
  })

  it('reconciles successive partial refunds to each original track sale amount', () => {
    const sales = [{trackId: 'track-a', priceMinor: 334}, {trackId: 'track-b', priceMinor: 333}, {trackId: 'track-c', priceMinor: 333}]
    const first = allocateCumulativeRefunds(200, sales, new Map())
    const second = allocateCumulativeRefunds(500, sales, first)
    const prior = new Map(sales.map(({trackId}) => [trackId, (first.get(trackId) ?? 0) + (second.get(trackId) ?? 0)]))
    const final = allocateCumulativeRefunds(1000, sales, prior)

    expect([...first.values()].reduce((sum, amount) => sum + amount, 0)).toBe(200)
    expect([...second.values()].reduce((sum, amount) => sum + amount, 0)).toBe(300)
    expect([...final.values()].reduce((sum, amount) => sum + amount, 0)).toBe(500)
    for (const sale of sales) expect((prior.get(sale.trackId) ?? 0) + (final.get(sale.trackId) ?? 0)).toBe(sale.priceMinor)
  })

  it('attaches workflow state to the persisted event when an insert conflicts', async () => {
    const stateBindings: unknown[][] = []
    const database = {
      prepare(sql: string) {
        let bindings: unknown[] = []
        const statement = {
          bind(...values: unknown[]) {
            bindings = values
            return statement
          },
          async first<T = Record<string, unknown>>(): Promise<T | null> {
            if (sql.includes('INSERT INTO marketplace_reporting_events')) return null
            if (sql.includes('SELECT id FROM marketplace_reporting_events')) return {id: 'persisted-event'} as T
            return null
          },
          async run() {
            if (sql.includes('INSERT INTO marketplace_reporting_event_states')) stateBindings.push(bindings)
          },
        }
        return statement
      },
    }
    const [event] = buildReportingEvents({...base, amountMinor: 100, tracks: [base.tracks[0]]})

    await insertReportingEvents(database, [event])

    expect(stateBindings[0]?.[0]).toBe('persisted-event')
  })
})