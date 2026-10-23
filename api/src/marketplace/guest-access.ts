import {createHash, randomBytes} from 'node:crypto'
import {MarketplaceError} from './service'

/**
 * Emailed download access for purchases, which works without signing in.
 *
 * - An email link carries a random 256-bit token. Only its SHA-256 hash is stored.
 * - Opening the link does nothing by itself: the download page calls `exchangeEmailLink` only when
 *   the buyer presses "Download your music", so email scanners that prefetch links consume nothing.
 * - An exchange is repeatable while the link is valid (7 days) and returns a short-lived download
 *   session (2 hours) that authorizes byte-range downloads of exactly that purchase's files, so an
 *   interrupted download can resume or be retried.
 * - Every check also requires the purchase to be paid-up (status 'active') and released
 *   (delivery_status 'available'); held pre-orders get their release date and no session.
 */

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
  run: () => Promise<unknown>
}

type Database = {prepare: (sql: string) => Statement}

export const EMAIL_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const DOWNLOAD_SESSION_TTL_MS = 2 * 60 * 60 * 1000

export type EmailLinkPurpose = 'purchase' | 'release_day' | 'recovery'

export function generateAccessToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(`mejay-guest-access:${token}`).digest('hex')
}

/** Tokens are base64url of 32 bytes (43 chars); anything else is rejected before touching the DB. */
function plausibleToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(token)
}

/** Creates a 7-day email link for one purchase and returns the secret, which is never stored. */
export async function issueEmailLink(db: Database, args: {entitlementId: string; orderId: string; recipientEmail: string | null; purpose: EmailLinkPurpose; now?: number}): Promise<{token: string; expiresAt: string}> {
  const token = generateAccessToken()
  const expiresAt = new Date((args.now ?? Date.now()) + EMAIL_LINK_TTL_MS).toISOString()
  await db.prepare(
    `INSERT INTO marketplace_guest_access_tokens
      (id, entitlement_id, order_id, kind, token_hash, recipient_email, issued_for, expires_at)
     VALUES (?1, ?2, ?3, 'email_link', ?4, ?5, ?6, ?7)`,
  ).bind(crypto.randomUUID(), args.entitlementId, args.orderId, hashAccessToken(token), args.recipientEmail, args.purpose, expiresAt).run()
  return {token, expiresAt}
}

/** The download page URL for an email link. The token rides in the fragment, which browsers never send to servers. */
export function downloadPageUrl(origin: string, token: string): string {
  return `${origin}/download#token=${token}`
}

type PurchaseRow = {
  entitlement_id: string
  order_id: string
  status: string
  delivery_status: 'held' | 'available'
  product_name: string
  release_title: string
  artist_name: string
  track_id: string | null
  scheduled_release_at: string | Date | null
  release_timezone: string | null
}

export type GuestPurchase = {
  itemTitle: string
  artistName: string
  releaseTitle: string
  deliveryStatus: 'held' | 'available'
  releaseAt: string | null
  releaseTimezone: string | null
}

function describe(row: PurchaseRow): GuestPurchase {
  return {
    itemTitle: row.track_id ? row.product_name : row.release_title,
    artistName: row.artist_name,
    releaseTitle: row.release_title,
    deliveryStatus: row.delivery_status,
    releaseAt: row.delivery_status === 'held' && row.scheduled_release_at ? new Date(row.scheduled_release_at).toISOString() : null,
    releaseTimezone: row.release_timezone,
  }
}

const PURCHASE_COLUMNS = `entitlement.id AS entitlement_id, entitlement.order_id, entitlement.status, entitlement.delivery_status,
  item.product_name, item.release_title, item.artist_name, item.catalog_snapshot->>'track_id' AS track_id,
  release.scheduled_release_at, release.release_timezone`

export type ExchangeResult =
  | {state: 'held'; purchase: GuestPurchase}
  | {state: 'available'; purchase: GuestPurchase; accessToken: string; expiresAt: string; files: Array<{id: string; title: string; trackNumber: number; discNumber: number; fileName: string; mimeType: string; byteSize: number}>}

/**
 * Exchanges a valid email link for a short-lived download session. Called only on an explicit
 * download action. Expired, unknown and revoked links all fail; held pre-orders return their date.
 */
export async function exchangeEmailLink(db: Database, token: unknown, now = Date.now()): Promise<ExchangeResult> {
  if (!plausibleToken(token)) throw new MarketplaceError(404, 'link_invalid', 'This download link is not valid.')
  const link = await db.prepare(
    `SELECT link.id, link.expires_at, ${PURCHASE_COLUMNS}
     FROM marketplace_guest_access_tokens link
     JOIN download_entitlements entitlement ON entitlement.id = link.entitlement_id
     JOIN marketplace_order_items item ON item.id = entitlement.order_item_id
     LEFT JOIN releases release ON release.id = item.release_id
     WHERE link.token_hash = ?1 AND link.kind = 'email_link'`,
  ).bind(hashAccessToken(token)).first<PurchaseRow & {id: string; expires_at: string | Date}>()
  if (!link) throw new MarketplaceError(404, 'link_invalid', 'This download link is not valid.')
  if (new Date(link.expires_at).getTime() <= now) {
    throw new MarketplaceError(410, 'link_expired', 'This download link has expired. Request a new one with your purchase email.')
  }
  if (link.status !== 'active') {
    throw new MarketplaceError(403, 'purchase_unavailable', 'Downloads for this purchase are unavailable. Contact MeJay support if you think this is a mistake.')
  }
  const purchase = describe(link)
  if (link.delivery_status === 'held') return {state: 'held', purchase}

  const accessToken = generateAccessToken()
  const expiresAt = new Date(Math.min(now + DOWNLOAD_SESSION_TTL_MS, new Date(link.expires_at).getTime() + DOWNLOAD_SESSION_TTL_MS)).toISOString()
  await db.prepare(
    `INSERT INTO marketplace_guest_access_tokens
      (id, entitlement_id, order_id, kind, token_hash, issued_for, expires_at)
     VALUES (?1, ?2, ?3, 'download_session', ?4, 'exchange', ?5)`,
  ).bind(crypto.randomUUID(), link.entitlement_id, link.order_id, hashAccessToken(accessToken), expiresAt).run()
  await db.prepare(
    `UPDATE marketplace_guest_access_tokens SET use_count = use_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?1`,
  ).bind(link.id).run()
  const {results: files} = await db.prepare(
    `SELECT id, track_title AS title, track_number, disc_number, file_name, mime_type, byte_size
     FROM download_entitlement_files WHERE entitlement_id = ?1 ORDER BY disc_number, track_number`,
  ).bind(link.entitlement_id).all<{id: string; title: string; track_number: number; disc_number: number; file_name: string; mime_type: string; byte_size: number | string}>()
  return {
    state: 'available',
    purchase,
    accessToken,
    expiresAt,
    files: files.map((file) => ({
      id: file.id, title: file.title, trackNumber: Number(file.track_number), discNumber: Number(file.disc_number),
      fileName: file.file_name, mimeType: file.mime_type, byteSize: Number(file.byte_size),
    })),
  }
}

/** Resolves one file for a download session; every request re-checks payment and release state. */
export async function resolveSessionDownload(db: Database, accessToken: unknown, fileId: string, now = Date.now()): Promise<{
  entitlementId: string
  fileId: string
  storageKey: string
  fileName: string
  mimeType: string
}> {
  if (!plausibleToken(accessToken)) throw new MarketplaceError(401, 'download_session_invalid', 'This download session is not valid. Open your download link again.')
  const row = await db.prepare(
    `SELECT session.expires_at, entitlement.id AS entitlement_id, entitlement.status, entitlement.delivery_status,
       file.id AS file_id, file.storage_key, file.file_name, file.mime_type
     FROM marketplace_guest_access_tokens session
     JOIN download_entitlements entitlement ON entitlement.id = session.entitlement_id
     LEFT JOIN download_entitlement_files file ON file.entitlement_id = entitlement.id AND file.id = ?2
     WHERE session.token_hash = ?1 AND session.kind = 'download_session'`,
  ).bind(hashAccessToken(accessToken), fileId).first<{
    expires_at: string | Date; entitlement_id: string; status: string; delivery_status: string
    file_id: string | null; storage_key: string | null; file_name: string | null; mime_type: string | null
  }>()
  if (!row || new Date(row.expires_at).getTime() <= now) {
    throw new MarketplaceError(401, 'download_session_invalid', 'This download session has expired. Open your download link again.')
  }
  if (row.status !== 'active' || row.delivery_status !== 'available' || !row.file_id || !row.storage_key) {
    throw new MarketplaceError(404, 'download_not_found', 'Download is unavailable')
  }
  return {entitlementId: row.entitlement_id, fileId: row.file_id, storageKey: row.storage_key, fileName: row.file_name!, mimeType: row.mime_type!}
}

/** Purchases (not revoked) made with this email, for access recovery. */
export async function purchasesForEmail(db: Database, email: string): Promise<Array<PurchaseRow & {buyer_email: string}>> {
  const {results} = await db.prepare(
    `SELECT ${PURCHASE_COLUMNS}, entitlement.buyer_email
     FROM download_entitlements entitlement
     JOIN marketplace_order_items item ON item.id = entitlement.order_item_id
     LEFT JOIN releases release ON release.id = item.release_id
     WHERE entitlement.buyer_email = ?1 AND entitlement.status = 'active'
     ORDER BY entitlement.granted_at DESC LIMIT 20`,
  ).bind(email).all<PurchaseRow & {buyer_email: string}>()
  return results
}

export {describe as describeGuestPurchase}
