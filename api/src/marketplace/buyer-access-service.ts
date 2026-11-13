import {z} from 'zod'

import {sendAccessRecovery} from './email-jobs'
import {downloadPageUrl, issueEmailLink} from './guest-access'
import {appOrigin, type OrderEmailEnv} from './order-email'
import {audit, MarketplaceError, type Database} from './service'

/**
 * Staff help for buyers who cannot get their download by email (a mistyped checkout address, a
 * mailbox that rejects or delays MeJay's mail). Marketplace admins only; every action is audited.
 *
 * - A download link the admin hands to the buyer directly (text, DM). Same 7-day link as the
 *   emailed ones: no sign-in or password needed, and it only opens this order's downloads.
 * - Correcting the email on a guest order, then sending the download links to the new address.
 *
 * Account passwords are deliberately not involved: anyone could type someone else's email, so
 * letting an email alone reset a password would hand over the account.
 */

export const buyerEmailSchema = z.object({email: z.string().trim().toLowerCase().email().max(320)}).strict()

type OrderRow = {id: string; provider_profile_id: string; buyer_user_id: string | null; buyer_email: string | null; payment_status: string}

const PAID = new Set(['paid', 'partially_refunded'])

export class BuyerAccessService {
  constructor(private readonly database: Database) {}

  private async requireAdmin(db: Database, userId: string): Promise<void> {
    const staff = await db.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1').bind(userId).first<{role: string}>()
    if (staff?.role !== 'admin') throw new MarketplaceError(403, 'marketplace_admin_required', 'Marketplace admin access is required')
  }

  private async loadOrder(db: Database, orderId: string, lock = false): Promise<OrderRow> {
    const order = await db.prepare(
      `SELECT id, provider_profile_id, buyer_user_id, buyer_email, payment_status FROM marketplace_orders WHERE id = ?1${lock ? ' FOR UPDATE' : ''}`,
    ).bind(orderId).first<OrderRow>()
    if (!order) throw new MarketplaceError(404, 'order_not_found', 'Order was not found')
    return order
  }

  /** A fresh 7-day download link for one order, for the admin to give the buyer directly. */
  async createDownloadLink(userId: string, orderId: string, env: OrderEmailEnv): Promise<{url: string; expiresAt: string}> {
    const origin = appOrigin(env)
    if (!origin) throw new MarketplaceError(500, 'frontend_url_missing', 'FRONTEND_URL is not configured, so a link cannot be built.')
    return this.database.transaction(async (db) => {
      await this.requireAdmin(db, userId)
      const order = await this.loadOrder(db, orderId)
      if (!PAID.has(order.payment_status)) throw new MarketplaceError(409, 'order_not_paid', 'This order is not paid, so it has no downloads.')
      const entitlement = await db.prepare(
        `SELECT id, status, delivery_status FROM download_entitlements WHERE order_id = ?1 ORDER BY granted_at LIMIT 1`,
      ).bind(orderId).first<{id: string; status: string; delivery_status: string}>()
      if (!entitlement) throw new MarketplaceError(404, 'download_not_found', 'This order has no downloads.')
      if (entitlement.status !== 'active') throw new MarketplaceError(409, 'download_not_active', `Downloads for this order are ${entitlement.status}.`)
      if (entitlement.delivery_status === 'held') throw new MarketplaceError(409, 'preorder_held', 'This pre-order unlocks on release day. Create the link after it is out.')
      const {token, expiresAt} = await issueEmailLink(db, {entitlementId: entitlement.id, orderId, recipientEmail: order.buyer_email, purpose: 'recovery'})
      await audit(db, {providerId: order.provider_profile_id, actorUserId: userId, entityType: 'order', entityId: orderId, action: 'order.download_link_created', after: {expiresAt}})
      return {url: downloadPageUrl(origin, token), expiresAt}
    })
  }

  /**
   * Corrects the email on a guest order and emails the download links there. Orders bought with a
   * MeJay account are refused: that email is the account's sign-in and is changed by the buyer.
   */
  async changeBuyerEmail(userId: string, orderId: string, input: unknown, env: OrderEmailEnv): Promise<{email: string; email_status: 'sent' | 'none' | 'failed'}> {
    const {email} = buyerEmailSchema.parse(input)
    const previous = await this.database.transaction(async (db) => {
      await this.requireAdmin(db, userId)
      const order = await this.loadOrder(db, orderId, true)
      if (order.buyer_user_id) {
        throw new MarketplaceError(409, 'order_has_account', 'This order belongs to a MeJay account. Use "Copy download link" instead.')
      }
      if (order.buyer_email === email) return order.buyer_email
      await db.prepare('UPDATE marketplace_orders SET buyer_email = ?1 WHERE id = ?2').bind(email, orderId).run()
      await db.prepare('UPDATE download_entitlements SET buyer_email = ?1, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?2').bind(email, orderId).run()
      await audit(db, {providerId: order.provider_profile_id, actorUserId: userId, entityType: 'order', entityId: orderId, action: 'order.buyer_email_changed', before: {email: order.buyer_email}, after: {email}})
      return order.buyer_email
    })
    // Sent after the change is committed; a failed send leaves the corrected email in place to retry.
    const status = await sendAccessRecovery(this.database, env, email)
    if (status === 'failed') console.warn('[buyer-access] download email not sent after email change', {orderId, changed: previous !== email})
    return {email, email_status: status}
  }
}
