import {z} from 'zod'

import {MarketplaceError, type Database} from './service'

/**
 * Admin-granted free access ("comp"): a marketplace admin unlocks the full MeJay app for an account
 * without a payment. It is stored as `platform_access_grants.full_site_access`, which
 * /api/account/me already treats as full access. Stripe-owned `entitlements` rows are never touched,
 * so a grant cannot be undone by a subscription webhook or a refund, and removing a grant leaves any
 * paid plan exactly as it was.
 *
 * Marketplace admins only; every change is audited. A protected owner's access cannot be removed.
 */

export const fullAccessCommandSchema = z.object({grant: z.boolean()}).strict()

export type FullAccessResult = {
  user_id: string
  full_site_access: boolean
  /** False when the account was already in the requested state (repeat clicks, retries). */
  changed: boolean
}

type GrantRow = {full_site_access: boolean; artist_portal_access: boolean; source: string}

export class CustomerAccessService {
  constructor(private readonly database: Database) {}

  private async requireAdmin(db: Database, userId: string): Promise<void> {
    const staff = await db.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1').bind(userId).first<{role: string}>()
    if (staff?.role !== 'admin') throw new MarketplaceError(403, 'marketplace_admin_required', 'Marketplace admin access is required')
  }

  async setFullAccess(adminUserId: string, targetUserId: string, rawCommand: unknown): Promise<FullAccessResult> {
    const {grant} = fullAccessCommandSchema.parse(rawCommand)
    const target = targetUserId.trim()
    if (!target) throw new MarketplaceError(400, 'missing_parameter', 'An account is required.')

    return this.database.transaction(async (db) => {
      await this.requireAdmin(db, adminUserId)
      // Lock the account row so a concurrent grant/revoke (or account deletion) cannot interleave.
      const account = await db.prepare('SELECT id FROM users WHERE id = ?1 FOR UPDATE').bind(target).first<{id: string}>()
      if (!account) throw new MarketplaceError(404, 'customer_not_found', 'That account no longer exists.')

      const existing = await db.prepare(
        'SELECT full_site_access, artist_portal_access, source FROM platform_access_grants WHERE user_id = ?1 FOR UPDATE',
      ).bind(target).first<GrantRow>()
      const hadAccess = existing?.full_site_access === true
      if (hadAccess === grant) return {user_id: target, full_site_access: grant, changed: false}

      const now = new Date().toISOString()
      if (grant) {
        // Keep an existing row's source (e.g. the owner's 'bootstrap' artist-portal grant); only add full access.
        await db.prepare(
          `INSERT INTO platform_access_grants
             (user_id, full_site_access, artist_portal_access, source, granted_by_user_id, created_at, updated_at)
           VALUES (?1, TRUE, FALSE, 'marketplace_admin', ?2, ?3, ?3)
           ON CONFLICT (user_id) DO UPDATE SET
             full_site_access = TRUE,
             granted_by_user_id = EXCLUDED.granted_by_user_id,
             updated_at = EXCLUDED.updated_at`,
        ).bind(target, adminUserId, now).run()
      } else {
        const owner = await db.prepare('SELECT protected_owner FROM marketplace_staff WHERE user_id = ?1').bind(target).first<{protected_owner: boolean}>()
        if (owner?.protected_owner) throw new MarketplaceError(403, 'protected_owner', "The MeJay owner's access cannot be removed.")
        if (existing?.artist_portal_access) {
          // The row also carries artist-portal access, which stays. (The table requires one flag to be true.)
          await db.prepare(
            'UPDATE platform_access_grants SET full_site_access = FALSE, granted_by_user_id = ?2, updated_at = ?3 WHERE user_id = ?1',
          ).bind(target, adminUserId, now).run()
        } else {
          await db.prepare('DELETE FROM platform_access_grants WHERE user_id = ?1').bind(target).run()
        }
      }

      // Not tied to a provider, so provider_profile_id stays NULL. Only flags are recorded, never the email.
      await db.prepare(
        `INSERT INTO marketplace_audit_events
           (id, provider_profile_id, actor_user_id, entity_type, entity_id, action, before_data, after_data, metadata)
         VALUES (?1, NULL, ?2, 'user', ?3, ?4, ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(), adminUserId, target,
        grant ? 'user.full_access_granted' : 'user.full_access_revoked',
        JSON.stringify({full_site_access: hadAccess}), JSON.stringify({full_site_access: grant}), JSON.stringify({}),
      ).run()

      return {user_id: target, full_site_access: grant, changed: true}
    })
  }
}
