import {describe, expect, it} from 'vitest'

import {DEFAULT_BEATWING_URL, PARTNER_CATEGORIES, getPartners, normalizePartnerUrl, partnerLaunchUrl, partnersInCategory, type Partner} from './partners'

describe('normalizePartnerUrl', () => {
  it('accepts https URLs and http only on localhost', () => {
    expect(normalizePartnerUrl('https://beatwing.mejayapp.com')).toBe('https://beatwing.mejayapp.com/')
    expect(normalizePartnerUrl('  http://localhost:3000 ')).toBe('http://localhost:3000/')
  })

  it('rejects anything that could become an unsafe or broken link', () => {
    for (const value of [undefined, null, '', '   ', 'beatwing.mejayapp.com', 'http://beatwing.mejayapp.com', 'javascript:alert(1)', 'ftp://example.com']) {
      expect(normalizePartnerUrl(value)).toBeNull()
    }
  })
})

describe('getPartners', () => {
  it('lists Beat Wing as an available beats partner on production by default', () => {
    const beatwing = getPartners({}).find((partner) => partner.id === 'beatwing')
    expect(beatwing).toMatchObject({category: 'beats', availability: 'available', url: DEFAULT_BEATWING_URL})
  })

  it('uses a valid configured URL and falls back to production for an invalid one', () => {
    expect(getPartners({VITE_BEATWING_URL: 'http://localhost:3000'})[0].url).toBe('http://localhost:3000/')
    expect(getPartners({VITE_BEATWING_URL: 'javascript:alert(1)'})[0].url).toBe(DEFAULT_BEATWING_URL)
  })

  it('only assigns partners to known categories', () => {
    const known = new Set(PARTNER_CATEGORIES.map((category) => category.id))
    getPartners({}).forEach((partner) => expect(known.has(partner.category)).toBe(true))
  })
})

describe('partnerLaunchUrl', () => {
  const partner = (overrides: Partial<Partner>): Partner => ({id: 'x', name: 'X', category: 'shows', tagline: '', description: '', highlights: [], availability: 'available', url: 'https://x.example.com', ...overrides})

  it('adds attribution while keeping the base URL and its query', () => {
    const url = new URL(partnerLaunchUrl(partner({url: 'https://x.example.com/path?keep=1'}))!)
    expect(url.origin + url.pathname).toBe('https://x.example.com/path')
    expect(url.searchParams.get('keep')).toBe('1')
    expect(url.searchParams.get('utm_source')).toBe('mejay')
    expect(url.searchParams.get('utm_medium')).toBe('artist_portal')
  })

  it('carries no user identity', () => {
    const url = new URL(partnerLaunchUrl(partner({}))!)
    expect([...url.searchParams.keys()].sort()).toEqual(['utm_campaign', 'utm_medium', 'utm_source'])
  })

  it('is null for coming-soon partners and partners without a valid URL', () => {
    expect(partnerLaunchUrl(partner({availability: 'coming_soon'}))).toBeNull()
    expect(partnerLaunchUrl(partner({url: null}))).toBeNull()
    expect(partnerLaunchUrl(partner({url: 'javascript:alert(1)'}))).toBeNull()
  })
})

describe('partnersInCategory', () => {
  it('filters by category', () => {
    const partners = getPartners({})
    expect(partnersInCategory(partners, 'beats').map((partner) => partner.id)).toContain('beatwing')
    expect(partnersInCategory(partners, 'venues')).toEqual([])
  })
})
