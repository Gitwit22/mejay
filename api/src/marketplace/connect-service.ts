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

export type ConnectStatus = {
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
      params.set('type', 'express')
      params.set('capabilities[transfers][requested]', 'true')
      params.set('metadata[providerId]', provider.id)
      if (provider.country_code) params.set('country', provider.country_code)
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
  }
}