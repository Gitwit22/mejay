import {describe, expect, it} from 'vitest'

import {paymentCountry} from './commerce-service'

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
