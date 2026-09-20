import {describe, expect, it} from 'vitest'

import {claimStripeWebhookEvent, finalizeStripeWebhookEvent} from './webhook-events'

function database(firstResults: Array<Record<string, unknown> | null> = []) {
  const calls: Array<{sql: string; bindings: unknown[]}> = []
  return {
    calls,
    prepare(sql: string) {
      let bindings: unknown[] = []
      const statement = {
        bind(...values: unknown[]) { bindings = values; calls.push({sql, bindings}); return statement },
        async first<T>() { return (firstResults.shift() ?? null) as T | null },
        async run() { return undefined },
      }
      return statement
    },
  }
}

describe('Stripe webhook event claims', () => {
  it('claims a new event and suppresses an in-flight or processed duplicate', async () => {
    const fresh = database([{stripe_event_id: 'evt_1'}])
    const duplicate = database([null, null])

    await expect(claimStripeWebhookEvent(fresh, {id: 'evt_1', type: 'checkout.session.completed', createdAt: null})).resolves.toBe(true)
    await expect(claimStripeWebhookEvent(duplicate, {id: 'evt_1', type: 'checkout.session.completed', createdAt: null})).resolves.toBe(false)
  })

  it('reclaims failed events and records bounded failure details', async () => {
    const retried = database([null, {stripe_event_id: 'evt_1'}])
    await expect(claimStripeWebhookEvent(retried, {id: 'evt_1', type: 'charge.refunded', createdAt: null})).resolves.toBe(true)

    await finalizeStripeWebhookEvent(retried, 'evt_1', new Error('failed'))
    expect(retried.calls.at(-1)?.bindings).toEqual(['failed', 'failed', 'evt_1'])
    expect(retried.calls[1]?.sql).toContain("INTERVAL '10 minutes'")
  })
})