import {describe, expect, it} from 'vitest'

import {applyPercentOff, createDiscountCodeSchema, normalizeDiscountCode, updateDiscountCodeSchema} from './discount-codes'

describe('discount code names', () => {
  it('trims and upper-cases, and accepts letters, digits, dashes and underscores', () => {
    expect(normalizeDiscountCode(' boldy20 ')).toBe('BOLDY20')
    expect(normalizeDiscountCode('summer_sale-2026')).toBe('SUMMER_SALE-2026')
  })

  it('rejects anything else', () => {
    for (const value of ['', 'ab', '-LEADING', 'has space', 'emoji🔥', 'x'.repeat(33), 42, null, undefined]) {
      expect(normalizeDiscountCode(value)).toBeNull()
    }
  })
})

describe('applyPercentOff', () => {
  it('takes whole cents off, rounded to the nearest cent', () => {
    expect(applyPercentOff(1000, 20)).toEqual({discountMinor: 200, amountMinor: 800})
    expect(applyPercentOff(999, 15)).toEqual({discountMinor: 150, amountMinor: 849})
    expect(applyPercentOff(129, 10)).toEqual({discountMinor: 13, amountMinor: 116})
  })

  it('refuses amounts and percentages outside the allowed range', () => {
    expect(() => applyPercentOff(0, 10)).toThrow()
    expect(() => applyPercentOff(1000, 0)).toThrow()
    expect(() => applyPercentOff(1000, 91)).toThrow()
    expect(() => applyPercentOff(10.5, 10)).toThrow()
  })
})

describe('admin input', () => {
  it('normalizes a new code and caps the percent at 90', () => {
    expect(createDiscountCodeSchema.parse({code: 'boldy20', percentOff: 20})).toEqual({code: 'BOLDY20', percentOff: 20})
    expect(() => createDiscountCodeSchema.parse({code: 'boldy20', percentOff: 95})).toThrow()
    expect(() => createDiscountCodeSchema.parse({code: 'no spaces', percentOff: 20})).toThrow()
    expect(() => createDiscountCodeSchema.parse({code: 'EXTRA', percentOff: 20, amountOff: 5})).toThrow()
  })

  it('requires something to change on update', () => {
    expect(() => updateDiscountCodeSchema.parse({})).toThrow()
    expect(updateDiscountCodeSchema.parse({active: false})).toEqual({active: false})
    expect(updateDiscountCodeSchema.parse({maxRedemptions: null})).toEqual({maxRedemptions: null})
  })
})
