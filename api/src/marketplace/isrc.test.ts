import {describe, expect, it} from 'vitest'
import {buildGeneratedIsrc, formatIsrc, normalizeIsrc, readIsrcGenerationConfig} from './isrc'

describe('MEJay ISRC helpers', () => {
  it('fails closed for partial or incorrect generation configuration', () => {
    expect(readIsrcGenerationConfig({})).toBeNull()
    expect(() => readIsrcGenerationConfig({ISRC_PREFIX: 'QTA3L'})).toThrow('ISRC generation requires')
    expect(() => readIsrcGenerationConfig({
      ISRC_PREFIX: 'USABC',
      ISRC_COUNTRY_CODE: 'US',
      ISRC_REGISTRANT_CODE: 'ABC',
    })).toThrow('ISRC generation requires')
  })

  it('accepts only the purchased QTA3L prefix', () => {
    expect(readIsrcGenerationConfig({
      ISRC_PREFIX: 'qta3l',
      ISRC_COUNTRY_CODE: 'qt',
      ISRC_REGISTRANT_CODE: 'a3l',
    })).toEqual({prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'})
  })

  it('stores canonical values and displays the required format', () => {
    expect(normalizeIsrc('qt-a3l-26-00001')).toBe('QTA3L2600001')
    expect(buildGeneratedIsrc('QTA3L', 26, 1)).toBe('QTA3L2600001')
    expect(formatIsrc('QTA3L2600001')).toBe('QT-A3L-26-00001')
  })

  it('enforces the purchased five-digit designation range', () => {
    expect(buildGeneratedIsrc('QTA3L', 26, 99999)).toBe('QTA3L2699999')
    expect(() => buildGeneratedIsrc('QTA3L', 26, 0)).toThrow('Invalid ISRC designation')
    expect(() => buildGeneratedIsrc('QTA3L', 26, 100000)).toThrow('Invalid ISRC designation')
  })
})