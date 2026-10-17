import {describe, expect, it} from 'vitest'
import {buildGeneratedIsrc, formatIsrc, normalizeIsrc, readIsrcGenerationConfig} from './isrc'

describe('MEJay ISRC helpers', () => {
  it('fails closed for partial or incorrect generation configuration', () => {
    expect(readIsrcGenerationConfig({})).toBeNull()
    expect(readIsrcGenerationConfig({ISRC_PREFIX: ' ', ISRC_COUNTRY_CODE: '', ISRC_REGISTRANT_CODE: ''})).toBeNull()
    // Partial or contradictory configuration never generates.
    expect(() => readIsrcGenerationConfig({ISRC_COUNTRY_CODE: 'QT'})).toThrow('ISRC generation requires')
    expect(() => readIsrcGenerationConfig({ISRC_REGISTRANT_CODE: 'A3L'})).toThrow('ISRC generation requires')
    expect(() => readIsrcGenerationConfig({ISRC_PREFIX: 'QTA3L', ISRC_COUNTRY_CODE: 'US'})).toThrow('ISRC generation requires')
    expect(() => readIsrcGenerationConfig({ISRC_PREFIX: 'QTA3L', ISRC_REGISTRANT_CODE: 'ABC'})).toThrow('ISRC generation requires')
    // Malformed prefixes, including ones that repeat part of the registrant code.
    for (const bad of ['QT', 'A3L', 'QTA3', 'QTA3LA3L', 'QTQTA3L', 'QT-A3L', 'QTA3L26']) {
      expect(() => readIsrcGenerationConfig({ISRC_PREFIX: bad})).toThrow('ISRC generation requires')
    }
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
    expect(readIsrcGenerationConfig({ISRC_PREFIX: 'QTA3L'})).toEqual({prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'})
    expect(readIsrcGenerationConfig({ISRC_COUNTRY_CODE: 'QT', ISRC_REGISTRANT_CODE: 'A3L'})).toEqual({prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'})
  })

  it('builds QT-A3L-YY-NNNNN with a two-digit year and no repeated prefix parts', () => {
    const config = readIsrcGenerationConfig({ISRC_PREFIX: 'QTA3L', ISRC_COUNTRY_CODE: 'QT', ISRC_REGISTRANT_CODE: 'A3L'})!
    const generated = buildGeneratedIsrc(config.prefix, 2026 % 100, 42)
    expect(generated).toBe('QTA3L2600042')
    expect(generated).toHaveLength(12)
    expect(formatIsrc(generated)).toMatch(/^QT-A3L-26-00042$/)
    expect(buildGeneratedIsrc(config.prefix, 2030 % 100, 1)).toBe('QTA3L3000001')
    expect(buildGeneratedIsrc(config.prefix, 2100 % 100, 1)).toBe('QTA3L0000001')
    expect(() => buildGeneratedIsrc(config.prefix, 2026, 1)).toThrow('Invalid ISRC assignment year')
  })

  it('issues consecutive designations as distinct codes', () => {
    const codes = Array.from({length: 50}, (_, index) => buildGeneratedIsrc('QTA3L', 26, index + 1))
    expect(new Set(codes).size).toBe(50)
    expect(codes.slice(0, 3)).toEqual(['QTA3L2600001', 'QTA3L2600002', 'QTA3L2600003'])
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