import {MarketplaceError, type Database} from './service'

/**
 * Admin customer lookup: type an email (or part of one) and see that person's MeJay account and
 * every marketplace purchase tied to it, whether bought signed in or as a guest. Read only;
 * marketplace admins only. Order actions (download links, email fixes) stay on the order itself.
 */

export type CustomerAccount = {
  id: string
  email: string
  display_name: string | null
  account_intent: string
  created_at: string
  has_password: boolean
  last_session_at: string | null
  plan: {access_type: string; has_full_access: boolean; subscription_status: string | null; billing_cadence: string | null; current_period_end: string | null} | null
  marketplace_role: string | null
  /** Free access given by MeJay staff (not a purchase). Null when there is none. */
  free_access: {granted_by_email: string | null; updated_at: string} | null
  provider: {id: string; display_name: string | null; status: string; member_role: string} | null
}

export type CustomerPurchase = {
  order_id: string
  paid_at: string | null
  purchase_type: string | null
  payment_status: string
  gross_amount_minor: number
  currency: string
  release_title: string
  song_title: string | null
  artist_name: string
  buyer_email: string | null
  guest_checkout: boolean
  delivery_status: string | null
  access_status: string | null
  download_count: number
  last_downloaded_at: string | null
  last_email: {kind: string; status: string; sent_at: string | null} | null
}

export type CustomerLookup = {
  query: string
  /** Emails containing the query, for typos and partial searches (accounts and checkout emails). */
  matches: string[]
  /** Set when the query is a full email with an account or purchases. */
  customer: {email: string; account: CustomerAccount | null; purchases: CustomerPurchase[]} | null
}

const MATCH_LIMIT = 10
const MIN_QUERY = 3
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`

export class CustomerLookupService {
  constructor(private readonly database: Database) {}

  private async requireAdmin(userId: string): Promise<void> {
    const staff = await this.database.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1').bind(userId).first<{role: string}>()
    if (staff?.role !== 'admin') throw new MarketplaceError(403, 'marketplace_admin_required', 'Marketplace admin access is required')
  }

  async lookup(userId: string, rawQuery: unknown): Promise<CustomerLookup> {
    await this.requireAdmin(userId)
    const query = typeof rawQuery === 'string' ? rawQuery.trim().toLowerCase().slice(0, 320) : ''
    if (query.length < MIN_QUERY) throw new MarketplaceError(400, 'query_too_short', `Type at least ${MIN_QUERY} characters of an email.`)

    const {results: matchRows} = await this.database.prepare(
      `SELECT email FROM (
         SELECT LOWER(email) AS email FROM users WHERE LOWER(email) LIKE ?1 ESCAPE '\\'
         UNION
         SELECT LOWER(buyer_email) FROM marketplace_orders WHERE buyer_email IS NOT NULL AND LOWER(buyer_email) LIKE ?1 ESCAPE '\\'
       ) found ORDER BY (email = ?2) DESC, email LIMIT ?3`,
    ).bind(likePattern(query), query, MATCH_LIMIT).all<{email: string}>()
    const matches = matchRows.map((row) => row.email)

    const customer = looksLikeEmail(query) ? await this.loadCustomer(query) : null
    return {query, matches, customer}
  }

  private async loadCustomer(email: string): Promise<CustomerLookup['customer']> {
    const account = await this.database.prepare(
      `SELECT account.id, account.email, account.display_name, account.account_intent, account.created_at,
         (account.password_hash IS NOT NULL) AS has_password,
         (SELECT MAX(session.created_at) FROM sessions session WHERE session.user_id = account.id) AS last_session_at,
         plan.access_type, plan.has_full_access, plan.subscription_status, plan.billing_cadence, plan.current_period_end,
         staff.role AS marketplace_role,
         COALESCE(platform_grant.full_site_access, FALSE) AS free_access, platform_grant.updated_at AS free_access_updated_at,
         granter.email AS free_access_granted_by,
         provider.id AS provider_id, provider.display_name AS provider_name, provider.status AS provider_status, member.role AS member_role
       FROM users account
       LEFT JOIN entitlements plan ON plan.user_id = account.id
       LEFT JOIN marketplace_staff staff ON staff.user_id = account.id
       LEFT JOIN platform_access_grants platform_grant ON platform_grant.user_id = account.id
       LEFT JOIN users granter ON granter.id = platform_grant.granted_by_user_id
       LEFT JOIN provider_members member ON member.user_id = account.id
       LEFT JOIN provider_profiles provider ON provider.id = member.provider_profile_id
       WHERE LOWER(account.email) = ?1 LIMIT 1`,
    ).bind(email).first<Record<string, unknown> & {id: string; email: string; display_name: string | null; account_intent: string; created_at: string; has_password: boolean; last_session_at: string | null}>()

    const {results: purchases} = await this.database.prepare(
      `SELECT purchase_order.id AS order_id, purchase_order.paid_at, purchase_order.purchase_type, purchase_order.payment_status,
         purchase_order.gross_amount_minor, purchase_order.currency,
         item.release_title, item.catalog_snapshot->>'track_title' AS song_title, item.artist_name,
         LOWER(COALESCE(purchase_order.buyer_email, buyer.email)) AS buyer_email, (purchase_order.buyer_user_id IS NULL) AS guest_checkout,
         entitlement.delivery_status, entitlement.status AS access_status,
         (SELECT COUNT(*)::integer FROM marketplace_download_events download WHERE download.entitlement_id = entitlement.id) AS download_count,
         (SELECT MAX(download.downloaded_at) FROM marketplace_download_events download WHERE download.entitlement_id = entitlement.id) AS last_downloaded_at,
         (SELECT json_build_object('kind', mail.kind, 'status', mail.status, 'sent_at', mail.sent_at) FROM (
            SELECT kind, status, sent_at, created_at FROM marketplace_email_jobs WHERE order_id = purchase_order.id
            UNION ALL SELECT kind, status, sent_at, created_at FROM marketplace_order_notifications WHERE order_id = purchase_order.id
          ) mail ORDER BY mail.created_at DESC LIMIT 1) AS last_email
       FROM marketplace_orders purchase_order
       JOIN marketplace_order_items item ON item.order_id = purchase_order.id
       LEFT JOIN users buyer ON buyer.id = purchase_order.buyer_user_id
       LEFT JOIN LATERAL (SELECT id, delivery_status, status FROM download_entitlements
         WHERE order_id = purchase_order.id ORDER BY granted_at LIMIT 1) entitlement ON TRUE
       WHERE (?2::text IS NOT NULL AND purchase_order.buyer_user_id = ?2)
          OR LOWER(purchase_order.buyer_email) = ?1
          OR EXISTS (SELECT 1 FROM download_entitlements claimed WHERE claimed.order_id = purchase_order.id AND LOWER(claimed.buyer_email) = ?1)
       ORDER BY purchase_order.paid_at DESC NULLS LAST, purchase_order.id
       LIMIT 200`,
    ).bind(email, account?.id ?? null).all<CustomerPurchase>()

    if (!account && purchases.length === 0) return null
    return {
      email,
      account: account ? {
        id: account.id, email: account.email, display_name: account.display_name, account_intent: account.account_intent,
        created_at: account.created_at, has_password: Boolean(account.has_password), last_session_at: account.last_session_at,
        plan: account.access_type ? {
          access_type: String(account.access_type), has_full_access: Boolean(Number(account.has_full_access)),
          subscription_status: account.subscription_status as string | null, billing_cadence: account.billing_cadence as string | null,
          current_period_end: account.current_period_end as string | null,
        } : null,
        marketplace_role: account.marketplace_role as string | null,
        free_access: account.free_access
          ? {granted_by_email: (account.free_access_granted_by as string | null) ?? null, updated_at: account.free_access_updated_at as string}
          : null,
        provider: account.provider_id ? {id: String(account.provider_id), display_name: account.provider_name as string | null, status: String(account.provider_status), member_role: String(account.member_role)} : null,
      } : null,
      purchases: purchases.map((purchase) => ({
        ...purchase,
        gross_amount_minor: Number(purchase.gross_amount_minor),
        guest_checkout: Boolean(purchase.guest_checkout),
        download_count: Number(purchase.download_count),
      })),
    }
  }
}
