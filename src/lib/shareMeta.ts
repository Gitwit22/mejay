/**
 * Link-preview tags for shared MeJay pages (the card iMessage, WhatsApp, X, Facebook and Slack
 * show for a pasted link). Crawlers don't run JavaScript, so the Cloudflare Pages functions in
 * /functions fill these into the page's <head> on the server.
 *
 * Kept free of app imports and browser APIs so the Pages functions can bundle it and it can be
 * unit tested. Values here are plain text; the functions escape them when writing HTML.
 */

export type ShareMeta = {
  /** The browser tab <title>. */
  documentTitle: string
  /** Tag name (og:*, twitter:*, description) to content. */
  tags: Record<string, string>
}

/** The fields of GET /api/store/releases/:releaseId's `release` that a preview needs. */
export type ShareableRelease = {
  id: string
  title: string
  artist_name: string
  artist_credit?: string | null
  release_type?: string | null
  availability?: 'available' | 'preorder' | string | null
  amount_minor?: number | string | null
  currency?: string | null
  artwork_asset_id?: string | null
}

/** The fields of GET /api/store/artists/:slug's `artist` that a preview needs. */
export type ShareableArtist = {
  name: string
  slug: string
  tagline?: string | null
  bio?: string | null
  profile_photo_asset_id?: string | null
  banner_asset_id?: string | null
}

const SITE_NAME = 'MeJay'

/** Same public route the store page uses for artwork and artist images. */
export function storeAssetPath(assetId: string): string {
  return `/api/store/assets/${encodeURIComponent(assetId)}`
}

export function formatSharePrice(amountMinor: unknown, currency: unknown): string | null {
  const amount = Number(amountMinor)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const code = typeof currency === 'string' && /^[A-Z]{3}$/i.test(currency) ? currency.toUpperCase() : 'USD'
  try {
    return new Intl.NumberFormat('en-US', {style: 'currency', currency: code}).format(amount / 100)
  } catch {
    return null
  }
}

/** Collapses whitespace and trims to `max` characters on a word boundary where possible. */
export function clipText(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

function imageTags(imageUrl: string | null, alt: string): Record<string, string> {
  if (!imageUrl) return {'twitter:card': 'summary'}
  return {'og:image': imageUrl, 'og:image:alt': alt, 'twitter:image': imageUrl, 'twitter:card': 'summary_large_image'}
}

/**
 * "Boldy by John Blaze · Buy now on MeJay", with the cover art as the image.
 * The buy message sits in the title because several apps (iMessage among them) show only the
 * title and image, never the description.
 */
export function buildReleaseShareMeta(release: ShareableRelease, origin: string): ShareMeta {
  const artist = (release.artist_credit || release.artist_name || '').trim()
  const preorder = release.availability === 'preorder'
  const action = preorder ? 'Pre-order now' : 'Buy now'
  const heading = artist ? `${release.title} by ${artist}` : release.title
  const title = `${heading} · ${action} on ${SITE_NAME}`
  const price = formatSharePrice(release.amount_minor, release.currency)
  const description = `${action} on ${SITE_NAME}${price ? ` for ${price}` : ''}. Play a preview and download it to keep.`
  const url = `${origin}/app/store/${encodeURIComponent(release.id)}`
  const image = release.artwork_asset_id ? `${origin}${storeAssetPath(release.artwork_asset_id)}` : null
  return {
    documentTitle: `${heading} | ${SITE_NAME}`,
    tags: {
      'og:title': title,
      'og:description': description,
      'og:type': release.release_type === 'single' ? 'music.song' : 'music.album',
      'og:url': url,
      'og:site_name': SITE_NAME,
      description,
      'twitter:title': title,
      'twitter:description': description,
      ...imageTags(image, `${release.title} cover art`),
    },
  }
}

/** "John Blaze on MeJay", with the artist's photo (or banner) as the image. */
export function buildArtistShareMeta(artist: ShareableArtist, origin: string): ShareMeta {
  const title = `${artist.name} on ${SITE_NAME}`
  const blurb = artist.tagline?.trim() || artist.bio?.trim()
  const description = blurb ? clipText(blurb, 200) : `Listen to ${artist.name} and buy their music on ${SITE_NAME}.`
  const imageId = artist.profile_photo_asset_id || artist.banner_asset_id
  const image = imageId ? `${origin}${storeAssetPath(imageId)}` : null
  return {
    documentTitle: `${artist.name} | ${SITE_NAME}`,
    tags: {
      'og:title': title,
      'og:description': description,
      'og:type': 'profile',
      'og:url': `${origin}/artist/${encodeURIComponent(artist.slug)}`,
      'og:site_name': SITE_NAME,
      description,
      'twitter:title': title,
      'twitter:description': description,
      ...imageTags(image, artist.name),
    },
  }
}

/** Escapes a value for a double-quoted HTML attribute. */
export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A <meta> tag for a key from `ShareMeta.tags`: og:* use `property`, the rest `name`. */
export function metaTagHtml(key: string, value: string): string {
  const attribute = key.startsWith('og:') ? 'property' : 'name'
  return `<meta ${attribute}="${escapeAttribute(key)}" content="${escapeAttribute(value)}" />`
}
