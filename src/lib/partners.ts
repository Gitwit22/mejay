/**
 * Partner directory for the artist portal's Partners tab.
 *
 * This is the single source of truth for which partner services artists can reach from MeJay.
 * Partners are external apps with their own accounts; MeJay only links out today. No user
 * identity is passed in the URL: shared sign-in between MeJay and a partner is a separate,
 * server-side piece of work and must not be faked with query parameters.
 */

export type PartnerCategoryId = 'beats' | 'shows' | 'venues'

/** `available`: artists can open it now. `coming_soon`: listed so artists know it is planned; never actionable. */
export type PartnerAvailability = 'available' | 'coming_soon'

export type PartnerCategory = {
  id: PartnerCategoryId
  label: string
  description: string
}

export type Partner = {
  id: string
  name: string
  category: PartnerCategoryId
  tagline: string
  description: string
  highlights: string[]
  availability: PartnerAvailability
  /** Base URL of the partner app. Required for an `available` partner to be actionable. */
  url: string | null
}

export const PARTNER_CATEGORIES: readonly PartnerCategory[] = [
  {id: 'beats', label: 'Beats', description: 'License instrumentals and production for your next release.'},
  {id: 'shows', label: 'Shows', description: 'Find performance opportunities and get booked.'},
  {id: 'venues', label: 'Venues', description: 'Rent spaces for shows, release parties and rehearsals.'},
]

/** Production Beat Wing. Kept as a fallback so a missing build variable never hides the partner. */
export const DEFAULT_BEATWING_URL = 'https://beatwing.mejayapp.com'

/**
 * Accepts only absolute http(s) URLs. https is required except for localhost, so a
 * misconfigured variable (e.g. `javascript:` or a bare host) can never become a live link.
 */
export function normalizePartnerUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost)) return null
  return parsed.toString()
}

export type PartnerEnv = {VITE_BEATWING_URL?: string}

export function getPartners(env: PartnerEnv = import.meta.env): Partner[] {
  // An explicitly set but invalid value falls back to production rather than silently disabling the link.
  const beatwingUrl = normalizePartnerUrl(env.VITE_BEATWING_URL) ?? DEFAULT_BEATWING_URL
  return [
    {
      id: 'beatwing',
      name: 'Beat Wing',
      category: 'beats',
      tagline: 'The beat marketplace from the MeJay ecosystem.',
      description: 'Browse beats from independent producers and compare lease and exclusive licenses before you buy.',
      // Only claims Beat Wing delivers today; its MeJay release hand-off is still in progress on Beat Wing's side.
      highlights: ['Lease or buy exclusive rights', 'License agreement and receipt with every purchase', 'Download exactly the files your license grants'],
      availability: 'available',
      url: beatwingUrl,
    },
  ]
}

/** Partners in one category, in directory order. */
export function partnersInCategory(partners: Partner[], category: PartnerCategoryId): Partner[] {
  return partners.filter((partner) => partner.category === category)
}

/**
 * Outbound link for a partner, or null when it cannot be opened (coming soon or no valid URL).
 * Adds attribution parameters only; existing query parameters on the base URL are kept.
 */
export function partnerLaunchUrl(partner: Partner): string | null {
  if (partner.availability !== 'available') return null
  const base = normalizePartnerUrl(partner.url)
  if (!base) return null
  const url = new URL(base)
  url.searchParams.set('utm_source', 'mejay')
  url.searchParams.set('utm_medium', 'artist_portal')
  url.searchParams.set('utm_campaign', 'partners')
  return url.toString()
}
