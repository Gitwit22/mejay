import type {ProviderArtist, ReleaseArtistCredit} from './providerApi'

/** Mirrors the API's credit line: "A & B feat. C & D" (blanks and repeats dropped). */
const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()

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

export function formatArtistCredit(lead: string | null | undefined, credits: Array<{role: 'primary' | 'featured'; name: string}> = []): string {
  const main = joinArtistNames([lead, ...credits.filter((credit) => credit.role === 'primary').map((credit) => credit.name)])
  const mainKeys = new Set(main.toLowerCase().split(/, | & /))
  const featured = joinArtistNames(credits.filter((credit) => credit.role === 'featured' && !mainKeys.has(clean(credit.name).toLowerCase())).map((credit) => credit.name))
  return featured ? `${main} feat. ${featured}`.trim() : main
}

/** True when a title carries a feature credit ("MIA ft Boldy James") that belongs in the artist credits. */
export function titleHasFeature(title: string): boolean {
  return /(\s|\()(ft\.?|feat\.?|featuring)\s/i.test(title)
}

/** Editing state for the Release Information "Additional artists" rows. */
export type AdditionalArtistRow = {key: string; role: 'primary' | 'featured'; artistId: string; name: string}

/** Picker value meaning "someone not on MeJay" (a typed name instead of an account artist). */
export const EXTERNAL_ARTIST = '__external__'
export const MAX_ADDITIONAL_ARTISTS = 10

let rowCounter = 0
export const newArtistRowKey = () => `artist-row-${(rowCounter += 1)}`

export function rowsFromCredits(credits: ReleaseArtistCredit[] | undefined): AdditionalArtistRow[] {
  return (credits ?? []).map((credit) => ({key: newArtistRowKey(), role: credit.role, artistId: credit.artist_id ?? EXTERNAL_ARTIST, name: credit.name}))
}

/** Rows as the API expects them; null while any row is incomplete. */
export function creditsInput(rows: AdditionalArtistRow[], artists: ProviderArtist[]): Array<{role: 'primary' | 'featured'; artistId: string | null; name: string}> | null {
  const out: Array<{role: 'primary' | 'featured'; artistId: string | null; name: string}> = []
  for (const row of rows) {
    if (row.artistId === EXTERNAL_ARTIST) {
      if (!row.name.trim()) return null
      out.push({role: row.role, artistId: null, name: row.name.trim()})
    } else {
      const artist = artists.find((candidate) => candidate.id === row.artistId)
      if (!artist) return null
      out.push({role: row.role, artistId: artist.id, name: artist.name})
    }
  }
  return out
}

export function creditName(row: AdditionalArtistRow, artists: ProviderArtist[]): string {
  return row.artistId === EXTERNAL_ARTIST ? row.name : artists.find((artist) => artist.id === row.artistId)?.name ?? ''
}

