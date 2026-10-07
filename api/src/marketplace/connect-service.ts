import {MarketplaceError} from './service'
import {stripeRequest} from '../services/stripe'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  run: () => Promise<unknown>
}

type Database = {prepare: (sql: string) => Statement}

type ProviderRow = {
  id: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  contact_email: string | null
  country_code: string | null
  stripe_account_id: string | null
  stripe_details_submitted: boolean
  stripe_charges_enabled: boolean
  stripe_payouts_enabled: boolean
  stripe_transfers_status: 'inactive' | 'pending' | 'active'
  stripe_requirements: Record<string, unknown>
  stripe_account_synced_at: string | null
}

type StripeAccount = {
  id: string
  details_submitted?: boolean
  charges_enabled?: boolean
  payouts_enabled?: boolean
  capabilities?: {transfers?: string}
  requirements?: Record<string, unknown>
}

/**
 * Artist-facing lifecycle of the Stripe connected account, derived only from Stripe-reported state:
 * - not_connected: no Stripe account yet
 * - onboarding_required: account exists but Stripe-hosted onboarding was not submitted
 * - restricted: Stripe disabled the account or requirements are past due
 * - verification_required: Stripe needs more information or is verifying what was submitted
 * - connected: verified, but payouts or transfers are not active yet
 * - payouts_enabled: ready to sell (details submitted, payouts enabled, transfers active)
 */
export type ConnectOnboardingStatus =
  | 'not_connected' | 'onboarding_required' | 'restricted' | 'verification_required' | 'connected' | 'payouts_enabled'

function requirementList(requirements: Record<string, unknown>, key: string): string[] {
  const value = requirements[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function connectOnboardingStatus(row: Pick<ProviderRow,
  'stripe_account_id' | 'stripe_details_submitted' | 'stripe_payouts_enabled' | 'stripe_transfers_status' | 'stripe_requirements'>): ConnectOnboardingStatus {
  if (!row.stripe_account_id) return 'not_connected'
  if (!row.stripe_details_submitted) return 'onboarding_required'
  const requirements = row.stripe_requirements ?? {}
  const disabledReason = typeof requirements.disabled_reason === 'string' && requirements.disabled_reason.trim() !== ''
  if (disabledReason || requirementList(requirements, 'past_due').length > 0) return 'restricted'
  if (row.stripe_payouts_enabled && row.stripe_transfers_status === 'active') return 'payouts_enabled'
  if (requirementList(requirements, 'currently_due').length > 0 || requirementList(requirements, 'pending_verification').length > 0) {
    return 'verification_required'
  }
  return 'connected'
}

export type ConnectStatus = {
  onboardingStatus: ConnectOnboardingStatus
  connected: boolean
  accountId: string | null
  detailsSubmitted: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  transfersStatus: 'inactive' | 'pending' | 'active'
  purchaseReady: boolean
  requirements: Record<string, unknown>
  syncedAt: string | null
}

function status(row: ProviderRow): ConnectStatus {
  return {
    onboardingStatus: connectOnboardingStatus(row),
    connected: Boolean(row.stripe_account_id),
    accountId: row.stripe_account_id,
    detailsSubmitted: row.stripe_details_submitted,
    chargesEnabled: row.stripe_charges_enabled,
    payoutsEnabled: row.stripe_payouts_enabled,
    transfersStatus: row.stripe_transfers_status,
    purchaseReady: row.stripe_details_submitted && row.stripe_payouts_enabled && row.stripe_transfers_status === 'active',
    requirements: row.stripe_requirements ?? {},
    syncedAt: row.stripe_account_synced_at,
  }
}

export class ConnectService {
  constructor(private readonly database: Database, private readonly secretKey: string) {}

  private async provider(userId: string, mutate: boolean): Promise<ProviderRow> {
    const row = await this.database.prepare(
      `SELECT p.id, pm.role, p.contact_email, p.country_code, p.stripe_account_id,
        p.stripe_details_submitted, p.stripe_charges_enabled, p.stripe_payouts_enabled,
        p.stripe_transfers_status, p.stripe_requirements, p.stripe_account_synced_at
       FROM provider_members pm JOIN provider_profiles p ON p.id = pm.provider_profile_id
       WHERE pm.user_id = ?1 LIMIT 1`,
    ).bind(userId).first<ProviderRow>()
    if (!row) throw new MarketplaceError(404, 'provider_not_found', 'Provider profile was not found')
    if (mutate && row.role !== 'owner' && row.role !== 'admin') {
      throw new MarketplaceError(403, 'provider_admin_required', 'Provider owner or admin access is required')
    }
    return row
  }

  async getStatus(userId: string, refresh = true): Promise<ConnectStatus> {
    let provider = await this.provider(userId, false)
    if (refresh && provider.stripe_account_id) {
      const account = await stripeRequest<StripeAccount>({
        secretKey: this.secretKey,
        path: `/v1/accounts/${encodeURIComponent(provider.stripe_account_id)}`,
      })
      await this.syncAccount(account)
      provider = await this.provider(userId, false)
    }
    return status(provider)
  }

  async createOnboardingLink(userId: string, frontendOrigin: string): Promise<{url: string; status: ConnectStatus}> {
    let provider = await this.provider(userId, true)
    if (!provider.stripe_account_id) {
      const params = new URLSearchParams()
      // Controller properties equivalent to an Express account (Stripe's current guidance; `type` is
      // legacy). The platform carries negative-balance liability and fees, Stripe collects
      // requirements, and the artist gets the Express Dashboard. Only new accounts are affected.
      params.set('controller[losses][payments]', 'application')
      params.set('controller[fees][payer]', 'application')
      params.set('controller[requirement_collection]', 'stripe')
      params.set('controller[stripe_dashboard][type]', 'express')
      params.set('capabilities[transfers][requested]', 'true')
      params.set('metadata[providerId]', provider.id)
      if (provider.country_code) params.set('country', provider.country_code)
      // Cross-border payouts: providers outside the platform's country can only receive
      // transfers under the recipient service agreement (Stripe rejects the default one).
      if (provider.country_code && provider.country_code.toUpperCase() !== 'US') {
        params.set('tos_acceptance[service_agreement]', 'recipient')
      }
      if (provider.contact_email) params.set('email', provider.contact_email)
      const account = await stripeRequest<StripeAccount>({
        secretKey: this.secretKey,
        method: 'POST',
        path: '/v1/accounts',
        params,
        idempotencyKey: `marketplace-connect-account-${provider.id}`,
      })
      await this.database.prepare(
        `UPDATE provider_profiles SET stripe_account_id = ?1, stripe_account_synced_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?2 AND stripe_account_id IS NULL`,
      ).bind(account.id, provider.id).run()
      await this.audit(provider.id, userId, account.id, 'stripe_account.created')
      await this.syncAccount(account)
      provider = await this.provider(userId, true)
    }

    const params = new URLSearchParams()
    params.set('account', provider.stripe_account_id!)
    params.set('type', 'account_onboarding')
    params.set('refresh_url', `${frontendOrigin}/app/artist?section=payout&connect=refresh`)
    params.set('return_url', `${frontendOrigin}/app/artist?section=payout&connect=return`)
    const link = await stripeRequest<{url?: string}>({secretKey: this.secretKey, method: 'POST', path: '/v1/account_links', params})
    if (!link.url) throw new MarketplaceError(502, 'stripe_invalid_response', 'Stripe did not return an onboarding link')
    await this.audit(provider.id, userId, provider.stripe_account_id!, 'stripe_account.onboarding_started')
    return {url: link.url, status: status(provider)}
  }

  async createDashboardLink(userId: string): Promise<{url: string}> {
    const provider = await this.provider(userId, true)
    if (!provider.stripe_account_id) throw new MarketplaceError(409, 'connect_not_started', 'Connect Stripe before opening the payout dashboard')
    const link = await stripeRequest<{url?: string}>({
      secretKey: this.secretKey,
      method: 'POST',
      path: `/v1/accounts/${encodeURIComponent(provider.stripe_account_id)}/login_links`,
      params: new URLSearchParams(),
    })
    if (!link.url) throw new MarketplaceError(502, 'stripe_invalid_response', 'Stripe did not return a dashboard link')
    return {url: link.url}
  }

  async syncAccount(account: StripeAccount): Promise<void> {
    const transferState = account.capabilities?.transfers
    const transfersStatus = transferState === 'active' ? 'active' : transferState === 'pending' ? 'pending' : 'inactive'
    const before = await this.database.prepare(
      `SELECT id, stripe_details_submitted, stripe_charges_enabled, stripe_payouts_enabled,
        stripe_transfers_status, stripe_requirements FROM provider_profiles WHERE stripe_account_id = ?1`,
    ).bind(account.id).first<Record<string, unknown> & {id: string}>()
    await this.database.prepare(
      `UPDATE provider_profiles SET stripe_details_submitted = ?1, stripe_charges_enabled = ?2,
        stripe_payouts_enabled = ?3, stripe_transfers_status = ?4, stripe_requirements = ?5,
        stripe_account_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE stripe_account_id = ?6`,
    ).bind(
      account.details_submitted === true,
      account.charges_enabled === true,
      account.payouts_enabled === true,
      transfersStatus,
      JSON.stringify(account.requirements ?? {}),
      account.id,
    ).run()
    if (before) {
      const statusOf = (data: Record<string, unknown>) => connectOnboardingStatus({
        stripe_account_id: account.id,
        stripe_details_submitted: data.stripe_details_submitted === true,
        stripe_payouts_enabled: data.stripe_payouts_enabled === true,
        stripe_transfers_status: data.stripe_transfers_status as ProviderRow['stripe_transfers_status'],
        stripe_requirements: (typeof data.stripe_requirements === 'object' && data.stripe_requirements !== null
          ? data.stripe_requirements : {}) as Record<string, unknown>,
      })
      const after = {
        stripe_details_submitted: account.details_submitted === true,
        stripe_charges_enabled: account.charges_enabled === true,
        stripe_payouts_enabled: account.payouts_enabled === true,
        stripe_transfers_status: transfersStatus,
        stripe_requirements: account.requirements ?? {},
      }
      const previousStatus = statusOf(before)
      const nextStatus = statusOf(after)
      const action = previousStatus === nextStatus ? 'stripe_account.synced'
        : nextStatus === 'payouts_enabled' ? 'stripe_account.connected'
          : nextStatus === 'restricted' ? 'stripe_account.restricted'
            : 'stripe_account.synced'
      await this.database.prepare(
        `INSERT INTO marketplace_audit_events
          (id, provider_profile_id, entity_type, entity_id, action, before_data, after_data, metadata)
         VALUES (?1, ?2, 'stripe_account', ?3, ?4, ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(), before.id, account.id, action, JSON.stringify(before), JSON.stringify(after),
        JSON.stringify({previousStatus, status: nextStatus}),
      ).run()
    }
  }

  private async audit(providerId: string, actorUserId: string, accountId: string, action: string): Promise<void> {
    await this.database.prepare(
      `INSERT INTO marketplace_audit_events (id, provider_profile_id, actor_user_id, entity_type, entity_id, action, metadata)
       VALUES (?1, ?2, ?3, 'stripe_account', ?4, ?5, '{}'::jsonb)`,
    ).bind(crypto.randomUUID(), providerId, actorUserId, accountId, action).run()
  }

  async handlePayoutFailed(accountId: string | null, payout: {id?: string; failure_code?: string; failure_message?: string}, stripeEventId: string): Promise<void> {
    if (!accountId) return
    const provider = await this.database.prepare(
      'SELECT id FROM provider_profiles WHERE stripe_account_id = ?1',
    ).bind(accountId).first<{id: string}>()
    if (!provider) return
    await this.database.prepare(
      `INSERT INTO marketplace_operational_incidents
        (id, provider_profile_id, stripe_event_id, incident_type, external_reference, details)
       VALUES (?1, ?2, ?3, 'payout_failed', ?4, ?5)
       ON CONFLICT (stripe_event_id, incident_type) DO NOTHING`,
    ).bind(
      crypto.randomUUID(), provider.id, stripeEventId, payout.id ?? null,
      JSON.stringify({failureCode: payout.failure_code ?? null, failureMessage: payout.failure_message ?? null}),
    ).run()
  }
}