/**
 * How a release is credited everywhere its artist name appears (store, checkout, emails, audio tags):
 * the lead and any additional primary artists joined with "&", then "feat." and featured artists.
 * "John Blaze & Kay feat. Boldy James & Tee".
 */
export type ArtistCredit = {role: 'primary' | 'featured'; name: string}

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()

/** "A", "A & B", "A, B & C"; blanks and repeats (case-insensitive) dropped. */
export function joinArtistNames(names: Array<string | null | undefined>): string {
  const seen = new Set<string>()
  const unique = names.map(clean).filter((name) => {
    const key = name.toLowerCase()
    if (!name || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.length <= 1 ? (unique[0] ?? '') : `${unique.slice(0, -1).join(', ')} & ${unique[unique.length - 1]}`
}

export function formatArtistCredit(lead: string | null | undefined, credits: ArtistCredit[] = []): string {
  const main = joinArtistNames([lead, ...credits.filter((credit) => credit.role === 'primary').map((credit) => credit.name)])
  const mainKeys = new Set(main.toLowerCase().split(/, | & /))
  const featured = joinArtistNames(credits.filter((credit) => credit.role === 'featured' && !mainKeys.has(clean(credit.name).toLowerCase())).map((credit) => credit.name))
  return featured ? `${main} feat. ${featured}`.trim() : main
}

/** SQL: release `alias`'s additional credits as a JSON array of {role, name}, primaries first, in order. */
export function releaseCreditsJsonSql(alias: string): string {
  return `COALESCE((SELECT json_agg(json_build_object('role', credit.role, 'name', credit.display_name) ORDER BY credit.role DESC, credit.position)
    FROM release_artist_credits credit WHERE credit.release_id = ${alias}.id), '[]'::json)`
}

export function parseCredits(value: unknown): ArtistCredit[] {
  const list = typeof value === 'string' ? JSON.parse(value) as unknown : value
  return Array.isArray(list) ? list.filter((item): item is ArtistCredit => Boolean(item) && (item.role === 'primary' || item.role === 'featured') && typeof item.name === 'string') : []
}
