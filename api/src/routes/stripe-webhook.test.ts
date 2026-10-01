import {createHmac} from 'node:crypto'
import {describe, expect, it} from 'vitest'

import {verifyStripeWebhook} from './stripe-webhook'

const secret = 'whsec_test_secret'
const payload = JSON.stringify({id: 'evt_1', type: 'checkout.session.completed'})

function signature(timestamp: number, value = payload): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${value}`).digest('hex')
  return `t=${timestamp},v1=${digest}`
}

describe('Stripe webhook signatures', () => {
  it('accepts an authentic current payload and rejects tampering', async () => {
    await expect(verifyStripeWebhook({payload, header: signature(1000), secret, nowSeconds: 1000})).resolves.toBe(true)
    await expect(verifyStripeWebhook({payload: `${payload} `, header: signature(1000), secret, nowSeconds: 1000})).resolves.toBe(false)
  })

  it('rejects replayed signatures outside the five-minute window', async () => {
    await expect(verifyStripeWebhook({payload, header: signature(1000), secret, nowSeconds: 1301})).resolves.toBe(false)
    await expect(verifyStripeWebhook({payload, header: 't=1000,v1=invalid', secret, nowSeconds: 1000})).resolves.toBe(false)
  })
})