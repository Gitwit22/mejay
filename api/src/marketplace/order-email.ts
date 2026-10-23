import {sendResendEmail, type ResendEnv} from '../services/email'
import {downloadPageUrl, issueEmailLink} from './guest-access'
import {formatReleaseTime} from './release-schedule'
import {PREORDER_CHARGE_NOTICE} from './commerce-service'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  run: () => Promise<unknown>
}

type Database = {prepare: (sql: string) => Statement}

export type OrderEmailEnv = ResendEnv & {
  FRONTEND_URL?: string
  SUPPORT_EMAIL?: string
}

export type OrderEmailOutcome = 'sent' | 'failed' | 'skipped' | 'already_handled'

const KIND = 'purchase_confirmation'
const MAX_ATTEMPTS = 5

type OrderEmailRow = {
  order_id: string
  entitlement_id: string | null
  delivery_status: 'held' | 'available' | null
  purchase_type: string | null
  scheduled_release_at: string | Date | null
  release_timezone: string | null
  account_email: string | null
  buyer_email: string | null
  currency: string
  gross_amount_minor: number
  paid_at: string | Date | null
  product_name: string
  release_title: string
  artist_name: string
  track_id: string | null
  buyer_user_id: string | null
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[character]!)
}

function formatAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency}).format(amountMinor / 100)
}

/** The app's public origin. FRONTEND_URL may list several allowed origins; the first is canonical. */
export function appOrigin(env: OrderEmailEnv): string | null {
  const first = (env.FRONTEND_URL ?? '').split(',')[0]?.trim()
  if (!first) return null
  try {
    return new URL(first).origin
  } catch {
    return null
  }
}

export const ACCOUNT_INVITE = 'Want your music saved in one place? Create a free account to keep your purchases in your library.'

/** Shared MeJay email frame: heading, body paragraphs (already escaped HTML), optional button, footer. */
export function renderEmail(args: {eyebrow: string; paragraphs: string[]; details?: Array<[string, string]>; button?: {label: string; url: string}; footer: string[]}): string {
  const details = args.details?.length
    ? `<table style="border-collapse:collapse; margin:0 0 16px 0; font-size:14px;">${args.details.map(([label, value]) => `<tr><td style="padding:2px 12px 2px 0; color:#555;">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join('')}</table>`
    : ''
  const button = args.button
    ? `<p style="margin:0 0 18px 0;"><a href="${escapeHtml(args.button.url)}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#10b981;color:#fff;text-decoration:none;font-weight:700;">${escapeHtml(args.button.label)}</a></p>`
    : ''
  return `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.5; color: #111">
      <h2 style="margin:0 0 4px 0;">MeJay</h2>
      <p style="margin:0 0 16px 0; font-size: 14px; color:#555;">${escapeHtml(args.eyebrow)}</p>
      ${args.paragraphs.map((paragraph) => `<p style="margin:0 0 12px 0;">${paragraph}</p>`).join('')}
      ${details}
      ${button}
      ${args.footer.map((line) => `<p style="margin:0 0 8px 0; font-size: 12px; color:#555;">${escapeHtml(line)}</p>`).join('')}
    </div>
  `.trim()
}

export function supportLine(env: OrderEmailEnv): string {
  const support = (env.SUPPORT_EMAIL ?? '').trim()
  return support ? `Questions? Contact ${support}.` : 'Questions? Just reply to this email.'
}

/**
 * Builds the confirmation. A delivered purchase carries one "Download your music" link: a 7-day,
 * purchase-scoped token page (never a storage URL), so guests are never forced to sign in. A pre-order
 * explains the charge and that the download link arrives on release day.
 */
export function buildOrderConfirmationEmail(order: OrderEmailRow, env: OrderEmailEnv, downloadUrl: string | null = null): {subject: string; text: string; html: string} {
  const origin = appOrigin(env)
  const purchasesUrl = origin && order.buyer_user_id ? `${origin}/app/purchased` : null
  const item = order.track_id ? `${order.product_name} (from ${order.release_title})` : order.release_title
  const amount = formatAmount(Number(order.gross_amount_minor), order.currency)
  const preorder = order.delivery_status === 'held'
  const releaseLabel = preorder && order.scheduled_release_at ? formatReleaseTime(order.scheduled_release_at, order.release_timezone) : null
  const help = supportLine(env)

  const delivery = preorder
    ? [
        `Pre-order · releases ${releaseLabel ?? 'on release day'}.`,
        PREORDER_CHARGE_NOTICE,
        "We'll email your download link on release day. Releases go live within a few minutes of the scheduled time.",
      ]
    : downloadUrl
      ? ['Your music is ready. Use the button below to download it; the link works for 7 days without signing in.']
      : purchasesUrl ? [`Sign in to MeJay and open Purchases to download: ${purchasesUrl}`] : []
  const accountLines = order.buyer_user_id
    ? (purchasesUrl ? [`Your purchase is also saved in Purchases: ${purchasesUrl}`] : [])
    : [ACCOUNT_INVITE]

  const subject = preorder ? `Your MeJay pre-order: ${item}` : `Your MeJay order: ${item}`
  const text = [
    preorder ? 'Thanks for your pre-order on MeJay.' : 'Thanks for your purchase on MeJay.',
    '',
    `Item: ${item}`,
    `Artist: ${order.artist_name}`,
    `Amount paid: ${amount}`,
    `Order reference: ${order.order_id}`,
    '',
    ...delivery,
    ...(downloadUrl && !preorder ? [`Download your music: ${downloadUrl}`] : []),
    '',
    ...accountLines,
    'Keep this link private. Lost it or it expired? Request a new link from the download page with this email address.',
    '',
    help,
  ].join('\n')

  const html = renderEmail({
    eyebrow: preorder ? 'Pre-order confirmation' : 'Order confirmation',
    paragraphs: [
      preorder ? 'Thanks for your pre-order.' : 'Thanks for your purchase.',
      ...delivery.map(escapeHtml),
    ],
    details: [['Item', item], ['Artist', order.artist_name], ['Amount paid', amount], ['Order reference', order.order_id]],
    button: downloadUrl && !preorder ? {label: 'Download your music', url: downloadUrl} : purchasesUrl && !preorder ? {label: 'Open Purchases', url: purchasesUrl} : undefined,
    footer: [...accountLines, 'Keep this link private. Lost it or it expired? Request a new link from the download page with this email address.', help],
  })
  return {subject, text, html}
}

/** Claims the order's confirmation for this attempt. Only one concurrent caller ever wins. */
async function claim(database: Database, orderId: string): Promise<boolean> {
  const inserted = await database.prepare(
    `INSERT INTO marketplace_order_notifications (order_id, kind, status, attempts)
     VALUES (?1, ?2, 'sending', 1) ON CONFLICT (order_id, kind) DO NOTHING
     RETURNING order_id`,
  ).bind(orderId, KIND).first<{order_id: string}>()
  if (inserted) return true
  const retried = await database.prepare(
    `UPDATE marketplace_order_notifications SET status = 'sending', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
     WHERE order_id = ?1 AND kind = ?2 AND attempts < ?3 AND (
       status = 'failed' OR (status = 'sending' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
     )
     RETURNING order_id`,
  ).bind(orderId, KIND, MAX_ATTEMPTS).first<{order_id: string}>()
  return Boolean(retried)
}

async function finish(database: Database, orderId: string, status: 'sent' | 'failed' | 'skipped', error: string | null): Promise<void> {
  await database.prepare(
    `UPDATE marketplace_order_notifications SET status = ?1, last_error = ?2,
      sent_at = CASE WHEN ?1 = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END, updated_at = CURRENT_TIMESTAMP
     WHERE order_id = ?3 AND kind = ?4`,
  ).bind(status, error, orderId, KIND).run()
}

/**
 * Sends the purchase confirmation for a fulfilled order at most once. Call it only after the order
 * has committed. It never throws, so an email problem can never fail or roll back fulfillment.
 */
export async function sendOrderConfirmation(database: Database, env: OrderEmailEnv, orderId: string): Promise<OrderEmailOutcome> {
  try {
    if (!(await claim(database, orderId))) return 'already_handled'
    const order = await database.prepare(
      `SELECT purchase_order.id AS order_id, buyer.email AS account_email, purchase_order.buyer_email,
        purchase_order.buyer_user_id, purchase_order.purchase_type,
        purchase_order.currency, purchase_order.gross_amount_minor, purchase_order.paid_at,
        item.product_name, item.release_title, item.artist_name, item.catalog_snapshot->>'track_id' AS track_id,
        entitlement.id AS entitlement_id, entitlement.delivery_status, entitlement.status AS entitlement_status,
        release.scheduled_release_at, release.release_timezone
       FROM marketplace_orders purchase_order
       JOIN marketplace_order_items item ON item.order_id = purchase_order.id
       LEFT JOIN download_entitlements entitlement ON entitlement.order_item_id = item.id
       LEFT JOIN releases release ON release.id = item.release_id
       LEFT JOIN users buyer ON buyer.id = purchase_order.buyer_user_id
       WHERE purchase_order.id = ?1
       ORDER BY item.created_at LIMIT 1`,
    ).bind(orderId).first<OrderEmailRow & {entitlement_status: string | null}>()
    // The account email is where the buyer signs in to reach the download; prefer it over Stripe's.
    const to = order?.account_email?.trim() || order?.buyer_email?.trim() || ''
    if (!order || !to) {
      await finish(database, orderId, 'skipped', order ? 'no_recipient' : 'order_not_found')
      console.warn('[order-email] Confirmation skipped', {orderId, reason: order ? 'no_recipient' : 'order_not_found'})
      return 'skipped'
    }
    // A fresh 7-day link per send attempt; links from failed attempts were never delivered.
    const origin = appOrigin(env)
    const downloadUrl = origin && order.entitlement_id && order.delivery_status === 'available' && order.entitlement_status === 'active'
      ? downloadPageUrl(origin, (await issueEmailLink(database as never, {entitlementId: order.entitlement_id, orderId, recipientEmail: to, purpose: 'purchase'})).token)
      : null
    const message = buildOrderConfirmationEmail(order, env, downloadUrl)
    const support = (env.SUPPORT_EMAIL ?? '').trim()
    const result = await sendResendEmail({
      env, to, ...message,
      ...(support ? {replyTo: support} : {}),
      idempotencyKey: `mejay-order-confirmation/${orderId}`,
    })
    if (result.status === 'sent') {
      await finish(database, orderId, 'sent', null)
      return 'sent'
    }
    await finish(database, orderId, result.status, result.reason)
    console.warn('[order-email] Confirmation not sent', {orderId, status: result.status, reason: result.reason})
    return result.status
  } catch (error) {
    console.error('[order-email] Confirmation failed', {orderId, error: error instanceof Error ? error.name : 'unknown'})
    try {
      await finish(database, orderId, 'failed', 'internal_error')
    } catch {
      // The claim row stays 'sending' and becomes retryable after ten minutes.
    }
    return 'failed'
  }
}
