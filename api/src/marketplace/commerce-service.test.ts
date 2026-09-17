import {describe, expect, it} from 'vitest'

import {paymentCountry, stripeRefundReference} from './commerce-service'

describe('marketplace payment territory', () => {
  it('prefers and normalizes Stripe billing country', () => {
    expect(paymentCountry({
      id: 'pi_1',
      latest_charge: {
        billing_details: {address: {country: ' ca '}},
        payment_method_details: {card: {country: 'US'}},
      },
    })).toBe('CA')
  })

  it('falls back to card country and rejects invalid values', () => {
    expect(paymentCountry({id: 'pi_1', latest_charge: {payment_method_details: {card: {country: 'gb'}}}})).toBe('GB')
    expect(paymentCountry({id: 'pi_1', latest_charge: {billing_details: {address: {country: 'Unknown'}}, payment_method_details: {card: {country: 'US'}}}})).toBe('US')
    expect(paymentCountry({id: 'pi_1', latest_charge: {billing_details: {address: {country: 'Unknown'}}}})).toBeNull()
    expect(paymentCountry({id: 'pi_1', latest_charge: 'ch_1'})).toBeNull()
  })
})

describe('marketplace refund trace', () => {
  it('uses the newest individual Stripe refund ID when available', () => {
    expect(stripeRefundReference({
      id: 'ch_1',
      refunds: {data: [{id: 're_old', created: 1}, {id: 're_new', created: 2}]},
    })).toBe('re_new')
    expect(stripeRefundReference({
      id: 'ch_1',
      refunds: {data: [{id: 're_first', created: 2}, {id: 're_second', created: 2}]},
    })).toBe('re_first')
  })

  it('falls back to the charge ID for minimal or legacy payloads', () => {
    expect(stripeRefundReference({id: 'ch_1'})).toBe('ch_1')
    expect(stripeRefundReference({})).toBeNull()
  })
})
