import {z} from 'zod'

/** URL-safe artist slug: lowercase words joined by single hyphens. */
export const ARTIST_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function slugifyArtistName(name: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '')
  return slug || 'artist'
}

/**
 * Social/DSP link fields and the hosts each may point to. Restricting hosts keeps a "Spotify" button
 * from sending fans to an arbitrary site.
 */
export const ARTIST_LINK_HOSTS = {
  website: null,
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com', 'youtu.be', 'music.youtube.com'],
  facebook: ['facebook.com', 'fb.com'],
  x: ['x.com', 'twitter.com'],
  spotify: ['open.spotify.com', 'spotify.com'],
  appleMusic: ['music.apple.com'],
  soundcloud: ['soundcloud.com'],
  bandcamp: ['bandcamp.com'],
  tidal: ['tidal.com', 'listen.tidal.com'],
  amazonMusic: ['music.amazon.com'],
  deezer: ['deezer.com'],
} as const satisfies Record<string, readonly string[] | null>

export type ArtistLinkKey = keyof typeof ARTIST_LINK_HOSTS

function hostAllowed(host: string, allowed: readonly string[] | null): boolean {
  if (!allowed) return true
  const normalized = host.toLowerCase().replace(/^www\./, '')
  return allowed.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`))
}

export function artistLinkProblem(key: ArtistLinkKey, value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'must be a full URL starting with https://'
  }
  if (url.protocol !== 'https:') return 'must use https://'
  if (url.username || url.password) return 'must not contain credentials'
  if (!hostAllowed(url.hostname, ARTIST_LINK_HOSTS[key])) return `must be a ${String(key)} link`
  return null
}

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null).nullable().optional()

const linksSchema = z.object(
  Object.fromEntries(Object.keys(ARTIST_LINK_HOSTS).map((key) => [key, z.string().trim().max(300).optional()])) as Record<ArtistLinkKey, z.ZodOptional<z.ZodString>>,
).strict().superRefine((links, context) => {
  for (const [key, value] of Object.entries(links)) {
    if (!value) continue
    const problem = artistLinkProblem(key as ArtistLinkKey, value)
    if (problem) context.addIssue({code: z.ZodIssueCode.custom, path: [key], message: `${key} ${problem}`})
  }
})

export const artistProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().toLowerCase().max(80).regex(ARTIST_SLUG_PATTERN, 'Use lowercase letters, numbers and single hyphens').optional(),
  tagline: optionalText(160),
  bio: optionalText(5000),
  location: optionalText(120),
  genres: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
  links: linksSchema.default({}),
  spotifyArtistId: z.string().trim().regex(/^[A-Za-z0-9]{22}$/, 'Spotify artist IDs are 22 letters and numbers').nullable().optional(),
  appleMusicArtistId: z.string().trim().regex(/^[0-9]{1,20}$/, 'Apple Music artist IDs are numeric').nullable().optional(),
  profilePhotoAssetId: z.string().trim().min(1).max(128).nullable().optional(),
  bannerAssetId: z.string().trim().min(1).max(128).nullable().optional(),
}).strict()

export type ArtistProfileInput = z.infer<typeof artistProfileSchema>

/** Drop empty link values so stored JSON only holds links the artist actually set. */
export function compactLinks(links: Partial<Record<ArtistLinkKey, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(links).filter((entry): entry is [string, string] => Boolean(entry[1])))
}
