import {apiFetch, apiUrl} from './api'

type Envelope<T> = {ok: true; data: T} | {ok: false; error: string; message?: string}

/** Derived by the API from Stripe-reported account state; never from the onboarding return URL. */
export type ConnectOnboardingStatus =
  | 'not_connected' | 'onboarding_required' | 'restricted' | 'verification_required' | 'connected' | 'payouts_enabled'

export type ConnectStatus = {
  /** Optional so an older API response still renders. */
  onboardingStatus?: ConnectOnboardingStatus
  connected: boolean
  accountId: string | null
  detailsSubmitted: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  transfersStatus: 'inactive' | 'pending' | 'active'
  purchaseReady: boolean
  requirements: {
    currently_due?: string[]
    eventually_due?: string[]
    past_due?: string[]
    disabled_reason?: string | null
  }
  syncedAt: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, {cache: 'no-store', ...init})
  const payload = await response.json().catch(() => null) as Envelope<T> | null
  if (!payload) throw new Error(`Commerce request failed (${response.status})`)
  if ('error' in payload) throw new Error(payload.message || payload.error)
  if (!response.ok) throw new Error(`Commerce request failed (${response.status})`)
  return payload.data
}

export function getConnectStatus(): Promise<ConnectStatus> {
  return request('/api/marketplace/connect')
}

export async function startConnectOnboarding(): Promise<void> {
  const result = await request<{url: string}>('/api/marketplace/connect/onboarding', {method: 'POST'})
  window.location.assign(result.url)
}

export async function openConnectDashboard(): Promise<void> {
  const result = await request<{url: string}>('/api/marketplace/connect/dashboard', {method: 'POST'})
  window.location.assign(result.url)
}

export type PurchaseFile = {
  id: string
  trackId: string | null
  title: string
  discNumber: number
  trackNumber: number
  fileName: string
  mimeType: string
  byteSize: number
}

export type Purchase = {
  entitlement_id: string
  entitlement_status: 'active' | 'suspended' | 'revoked'
  order_id: string
  paid_at: string
  payment_status: string
  currency: string
  product_id: string
  /** Set for single-song purchases (absent from older API responses). */
  product_name?: string
  track_id?: string | null
  release_title: string
  artist_name: string
  artwork_asset_id: string | null
  unit_amount_minor: number
  files: PurchaseFile[]
}

export type StoreOrderStatus = {
  status: string
  stripe_checkout_session_id: string
  order_id: string | null
  payment_status: string | null
  transfer_status: string | null
}

export async function startStoreCheckout(productId: string): Promise<void> {
  const result = await request<{url: string}>('/api/store/checkout', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({productId}),
  })
  window.location.assign(result.url)
}

export function getStoreOrderStatus(sessionId: string): Promise<StoreOrderStatus> {
  return request(`/api/store/orders/by-session/${encodeURIComponent(sessionId)}`)
}

export function listStorePurchases(): Promise<Purchase[]> {
  return request('/api/store/purchases')
}

/** Buyer-only artwork for a purchase; keeps working after the release leaves the store. */
export function purchaseArtworkUrl(purchase: {entitlement_id: string; artwork_asset_id?: string | null}): string | null {
  return purchase.artwork_asset_id ? apiUrl(`/api/store/purchases/${encodeURIComponent(purchase.entitlement_id)}/artwork`) : null
}

export function purchaseDownloadUrl(entitlementId: string, fileId: string): string {
  return apiUrl(`/api/store/purchases/${encodeURIComponent(entitlementId)}/files/${encodeURIComponent(fileId)}/download`)
}
/**
 * Download a purchase's files with the buyer's session and return them as Files ready for the
 * DJ library. lastModified is pinned to the purchase time so re-adding is detected as a duplicate.
 */
export async function fetchPurchaseFiles(purchase: Purchase): Promise<File[]> {
  const lastModified = Date.parse(purchase.paid_at) || 0
  const files: File[] = []
  for (const file of purchase.files) {
    const response = await apiFetch(`/api/store/purchases/${encodeURIComponent(purchase.entitlement_id)}/files/${encodeURIComponent(file.id)}/download`)
    if (!response.ok) throw new Error(`Couldn't download "${file.title}" (${response.status})`)
    const blob = await response.blob()
    files.push(new File([blob], file.fileName, {type: file.mimeType || blob.type, lastModified}))
  }
  return files
}
