type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  run: () => Promise<unknown>
}

type Database = {
  prepare: (sql: string) => Statement
  transaction: <T>(callback: (database: Database) => Promise<T>) => Promise<T>
}

type Entitlement = {
  access_type: string
  has_full_access: number | boolean
  subscription_status: string | null
}

export class AccountDeletionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export function accountDeletionEligibility(
  entitlement: Entitlement | null,
  forfeitFullProgram: boolean,
): {allowed: true} | {allowed: false; code: 'subscription_active' | 'full_program_forfeiture_required'} {
  if (!entitlement) return {allowed: true}
  const accessType = entitlement.access_type
  const fullProgram = accessType === 'full' || accessType === 'full_program'
  if (fullProgram) {
    return forfeitFullProgram ? {allowed: true} : {allowed: false, code: 'full_program_forfeiture_required'}
  }

  const paidStatus = ['active', 'trialing', 'past_due', 'unpaid'].includes(entitlement.subscription_status ?? '')
  const free = accessType === 'free' && !Boolean(entitlement.has_full_access) && !paidStatus
  return free ? {allowed: true} : {allowed: false, code: 'subscription_active'}
}

export class AccountDeletionService {
  constructor(private readonly database: Database) {}

  async deleteCurrentUser(args: {userId: string; email: string; forfeitFullProgram: boolean}): Promise<void> {
    return this.database.transaction(async (db) => {
      const user = await db.prepare('SELECT id, email FROM users WHERE id = ?1 FOR UPDATE')
        .bind(args.userId)
        .first<{id: string; email: string}>()
      if (!user) throw new AccountDeletionError(401, 'unauthorized', 'The account session is no longer valid')
      if (user.email.trim().toLowerCase() !== args.email.trim().toLowerCase()) {
        throw new AccountDeletionError(400, 'confirmation_required', 'Enter the current account email to confirm deletion')
      }

      const staff = await db.prepare(
        'SELECT protected_owner FROM marketplace_staff WHERE user_id = ?1 FOR UPDATE',
      ).bind(user.id).first<{protected_owner: boolean}>()
      if (staff?.protected_owner) {
        throw new AccountDeletionError(409, 'protected_owner', 'Transfer platform ownership before deleting this account')
      }

      const entitlement = await db.prepare(
        'SELECT access_type, has_full_access, subscription_status FROM entitlements WHERE user_id = ?1 FOR UPDATE',
      ).bind(user.id).first<Entitlement>()
      const eligibility = accountDeletionEligibility(entitlement, args.forfeitFullProgram)
      if (!eligibility.allowed) {
        const message = eligibility.code === 'subscription_active'
          ? 'Cancel the subscription and wait until the account returns to the free tier before deleting it'
          : 'Confirm that the Full Program purchase will be permanently forfeited'
        throw new AccountDeletionError(eligibility.code === 'subscription_active' ? 409 : 400, eligibility.code, message)
      }

      const membership = await db.prepare(
        `SELECT pm.provider_profile_id, pm.role, p.owner_user_id
         FROM provider_members pm JOIN provider_profiles p ON p.id = pm.provider_profile_id
         WHERE pm.user_id = ?1`,
      ).bind(user.id).first<{provider_profile_id: string; role: string; owner_user_id: string}>()

      if (membership?.owner_user_id === user.id || membership?.role === 'owner') {
        const otherMember = await db.prepare(
          'SELECT user_id FROM provider_members WHERE provider_profile_id = ?1 AND user_id <> ?2 LIMIT 1',
        ).bind(membership.provider_profile_id, user.id).first<{user_id: string}>()
        if (otherMember) {
          throw new AccountDeletionError(409, 'provider_ownership_transfer_required', 'Transfer provider ownership before deleting this account')
        }

        const financialHistory = await db.prepare(
          'SELECT id FROM marketplace_orders WHERE provider_profile_id = ?1 LIMIT 1',
        ).bind(membership.provider_profile_id).first<{id: string}>()
        if (financialHistory) {
          throw new AccountDeletionError(409, 'provider_financial_history_retained', 'Contact support to close or transfer a provider with marketplace sales')
        }

        await this.anonymizeAudits(db, user.id, membership.provider_profile_id)
        await db.prepare('DELETE FROM releases WHERE provider_profile_id = ?1').bind(membership.provider_profile_id).run()
        await db.prepare('DELETE FROM artists WHERE provider_profile_id = ?1').bind(membership.provider_profile_id).run()
        await db.prepare('DELETE FROM provider_members WHERE provider_profile_id = ?1').bind(membership.provider_profile_id).run()
        await db.prepare('DELETE FROM provider_profiles WHERE id = ?1').bind(membership.provider_profile_id).run()
      } else {
        await this.anonymizeAudits(db, user.id, null)
        await db.prepare('DELETE FROM provider_members WHERE user_id = ?1').bind(user.id).run()
      }

      await db.prepare('DELETE FROM marketplace_staff WHERE user_id = ?1').bind(user.id).run()
      await db.prepare(
        `UPDATE marketplace_staff_invites SET
          claimed_by_user_id = NULL,
          claimed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
         WHERE claimed_by_user_id = ?1`,
      ).bind(user.id).run()
      await db.prepare('DELETE FROM platform_access_grants WHERE user_id = ?1').bind(user.id).run()
      await db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(user.id).run()
      await db.prepare('DELETE FROM entitlements WHERE user_id = ?1').bind(user.id).run()
      await db.prepare('DELETE FROM email_codes WHERE email = ?1').bind(user.email).run()
      await db.prepare('DELETE FROM auth_codes WHERE email = ?1').bind(user.email).run()
      await db.prepare('DELETE FROM users WHERE id = ?1').bind(user.id).run()
    })
  }

  private async anonymizeAudits(db: Database, userId: string, providerId: string | null): Promise<void> {
    await db.prepare(
      `UPDATE marketplace_audit_events SET
        provider_profile_id = CASE WHEN provider_profile_id = ?2 THEN NULL ELSE provider_profile_id END,
        actor_user_id = CASE WHEN actor_user_id = ?1 THEN NULL ELSE actor_user_id END,
        before_data = NULL,
        after_data = NULL,
        metadata = '{}'::jsonb,
        anonymized_at = CURRENT_TIMESTAMP
       WHERE anonymized_at IS NULL AND (actor_user_id = ?1 OR provider_profile_id = ?2)`,
    ).bind(userId, providerId).run()
  }
}