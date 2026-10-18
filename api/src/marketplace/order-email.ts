import {sendResendEmail, type ResendEnv} from '../services/email'

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
  account_email: string | null
  buyer_email: string | null
  currency: string
  gross_amount_minor: number
  paid_at: string | Date | null
  product_name: string
  release_title: string
  artist_name: string
  track_id: string | null
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[character]!)
}

function formatAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency}).format(amountMinor / 100)
}

/** The app's public origin. FRONTEND_URL may list several allowed origins; the first is canonical. */
function appOrigin(env: OrderEmailEnv): string | null {
  const first = (env.FRONTEND_URL ?? '').split(',')[0]?.trim()
  if (!first) return null
  try {
    return new URL(first).origin
  } catch {
    return null
  }
}

/**
 * Builds the confirmation. It deliberately carries no download links, storage URLs, or tokens:
 * files are only reachable from the signed-in buyer's Purchases page, which checks the session and
 * an active entitlement, so the order reference alone grants nothing.
 */
export function buildOrderConfirmationEmail(order: OrderEmailRow, env: OrderEmailEnv): {subject: string; text: string; html: string} {
  const origin = appOrigin(env)
  const purchasesUrl = origin ? `${origin}/app/purchased` : null
  const item = order.track_id ? `${order.product_name} (from ${order.release_title})` : order.release_title
  const amount = formatAmount(Number(order.gross_amount_minor), order.currency)
  const support = (env.SUPPORT_EMAIL ?? '').trim()
  const supportLine = support ? `Questions? Contact ${support}.` : 'Questions? Just reply to this email.'
  const access = purchasesUrl
    ? `To download, sign in to MeJay with this email address and open Purchases: ${purchasesUrl}`
    : 'To download, sign in to MeJay with this email address and open Purchases.'

  const subject = `Your MeJay order: ${item}`
  const text = [
    'Thanks for your purchase on MeJay.',
    '',
    `Item: ${item}`,
    `Artist: ${order.artist_name}`,
    `Amount paid: ${amount}`,
    `Order reference: ${order.order_id}`,
    '',
    access,
    'Your download is tied to your MeJay account and is not shared through this email.',
    '',
    supportLine,
  ].join('\n')

  const button = purchasesUrl
    ? `<p style="margin:0 0 18px 0;"><a href="${escapeHtml(purchasesUrl)}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#10b981;color:#fff;text-decoration:none;font-weight:700;">Sign in to download</a></p>`
    : ''
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.5; color: #111">
      <h2 style="margin:0 0 4px 0;">MeJay</h2>
      <p style="margin:0 0 16px 0; font-size: 14px; color:#555;">Order confirmation</p>
      <p style="margin:0 0 12px 0;">Thanks for your purchase.</p>
      <table style="border-collapse:collapse; margin:0 0 16px 0; font-size:14px;">
        <tr><td style="padding:2px 12px 2px 0; color:#555;">Item</td><td>${escapeHtml(item)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0; color:#555;">Artist</td><td>${escapeHtml(order.artist_name)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0; color:#555;">Amount paid</td><td>${escapeHtml(amount)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0; color:#555;">Order reference</td><td>${escapeHtml(order.order_id)}</td></tr>
      </table>
      <p style="margin:0 0 12px 0;">Sign in to MeJay with this email address and open <strong>Purchases</strong> to download.</p>
      ${button}
      <p style="margin:0 0 12px 0; font-size: 12px; color:#555;">Your download is tied to your MeJay account and is not shared through this email.</p>
      <p style="margin:0; font-size: 12px; color:#555;">${escapeHtml(supportLine)}</p>
    </div>
  `.trim()
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
        purchase_order.currency, purchase_order.gross_amount_minor, purchase_order.paid_at,
        item.product_name, item.release_title, item.artist_name, item.catalog_snapshot->>'track_id' AS track_id
       FROM marketplace_orders purchase_order
       JOIN marketplace_order_items item ON item.order_id = purchase_order.id
       LEFT JOIN users buyer ON buyer.id = purchase_order.buyer_user_id
       WHERE purchase_order.id = ?1
       ORDER BY item.created_at LIMIT 1`,
    ).bind(orderId).first<OrderEmailRow>()
    // The account email is where the buyer signs in to reach the download; prefer it over Stripe's.
    const to = order?.account_email?.trim() || order?.buyer_email?.trim() || ''
    if (!order || !to) {
      await finish(database, orderId, 'skipped', order ? 'no_recipient' : 'order_not_found')
      console.warn('[order-email] Confirmation skipped', {orderId, reason: order ? 'no_recipient' : 'order_not_found'})
      return 'skipped'
    }
    const message = buildOrderConfirmationEmail(order, env)
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
