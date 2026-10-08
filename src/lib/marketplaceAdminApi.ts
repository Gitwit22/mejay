import {apiFetch, apiUrl} from './api'

export type AdminRecord = Record<string, string | number | boolean | null>

export type MarketplaceAdminOverview = {
  role: 'reviewer' | 'admin'
  counts: AdminRecord
  pending: AdminRecord[]
  catalog: AdminRecord[]
  providers: AdminRecord[]
  artists: AdminRecord[]
  isrcs: AdminRecord[]
  rights: AdminRecord[]
  pricing: AdminRecord[]
  splits: AdminRecord[]
  takedowns: AdminRecord[]
  discovery: {
    featuredReleases: AdminRecord[]
    featuredArtists: AdminRecord[]
    eligibleReleases: AdminRecord[]
    eligibleArtists: AdminRecord[]
  }
}

export type IsrcRegistryRecord = {
  id: string
  isrc: string
  track: string | null
  artist: string | null
  provider: string | null
  type: 'MEJAY_ASSIGNED' | 'EXTERNAL'
  assigned: string
  status: 'RESERVED' | 'ASSIGNED' | 'REGISTERED' | 'VOIDED'
  year: number
}

export type IsrcRegistryDetail = {
  id: string
  isrc: string
  trackId: string | null
  track: string | null
  artistId: string | null
  artist: string | null
  providerId: string | null
  provider: string | null
  rightsOwnerId: string | null
  rightsOwnerName: string | null
  prefix: string
  countryCode: string | null
  registrantCode: string | null
  assignmentYear: number
  designationCode: string
  assignmentType: 'MEJAY_ASSIGNED' | 'EXTERNAL'
  status: 'RESERVED' | 'ASSIGNED' | 'REGISTERED' | 'VOIDED'
  assignedAt: string
  assignedByUserId: string | null
  rightsCertificationId: string | null
  createdAt: string
  updatedAt: string
}

export type IsrcSequence = {
  prefix: string
  assignmentYear: number
  nextNumber: number
  previewIsrc: string
}

type Envelope<T> = {ok: true; data: T} | {ok: false; error: string; message?: string}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init)
  const payload = await response.json().catch(() => null) as Envelope<T> | null
  if (!payload) throw new Error(`Request failed (${response.status})`)
  if ('error' in payload) throw new Error(payload.message || payload.error)
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return payload.data
}

export function getMarketplaceAdminOverview(): Promise<MarketplaceAdminOverview> {
  return request('/api/marketplace-admin/overview')
}

export function getIsrcRegistry(filters: {
  isrc?: string
  track?: string
  artist?: string
  provider?: string
  year?: string
} = {}): Promise<IsrcRegistryRecord[]> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value?.trim()) params.set(key, value.trim())
  }
  const query = params.toString()
  return request(`/api/isrc${query ? `?${query}` : ''}`)
}

export function getIsrcRegistryRecord(id: string): Promise<IsrcRegistryDetail> {
  return request(`/api/isrc/${encodeURIComponent(id)}`)
}

export function getIsrcSequence(): Promise<IsrcSequence> {
  return request('/api/isrc/sequence')
}

export function getIsrcExportUrl(filters: {
  isrc?: string
  track?: string
  artist?: string
  provider?: string
  year?: string
} = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value?.trim()) params.set(key, value.trim())
  }
  const query = params.toString()
  return apiUrl(`/api/isrc/export${query ? `?${query}` : ''}`)
}

export async function downloadIsrcRegistryExport(filters: {
  isrc?: string
  track?: string
  artist?: string
  provider?: string
  year?: string
} = {}): Promise<void> {
  const response = await fetch(getIsrcExportUrl(filters), {cache: 'no-store', credentials: 'include'})
  if (!response.ok) throw new Error(`Export failed (${response.status})`)
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || 'mejay-isrc-registry.csv'
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export type ReleaseAdminAction = 'start_review' | 'approve' | 'request_changes' | 'reject' | 'publish_now' | 'schedule' | 'publish_due' | 'unpublish' | 'takedown' | 'restore' | 'clear_rights' | 'flag_rights'

export type ProviderAdminAction = 'approve' | 'reject' | 'suspend' | 'reinstate'

export function commandMarketplaceProvider(providerId: string, input: {action: ProviderAdminAction; reason?: string}): Promise<AdminRecord> {
  return request(`/api/marketplace-admin/providers/${encodeURIComponent(providerId)}/commands`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input),
  })
}

export function recordSplitDispute(input: {providerId: string; splitSetId: string; orderId?: string; reason: string}): Promise<{id: string}> {
  return request('/api/marketplace-admin/split-disputes', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input),
  })
}

export function retryMarketplacePayouts(): Promise<{attempted: number; transferred: number; failed: number}> {
  return request('/api/marketplace-admin/payouts/retry', {method: 'POST'})
}

export function commandMarketplaceRelease(releaseId: string, input: {
  action: ReleaseAdminAction
  expectedVersion: number
  note?: string
  scheduledReleaseAt?: string
}): Promise<AdminRecord> {
  return request(`/api/marketplace-admin/releases/${encodeURIComponent(releaseId)}/commands`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input),
  })
}

export function replaceMarketplaceDiscoveryFeatures(input: {releaseIds: string[]; artistIds: string[]}): Promise<typeof input> {
  return request('/api/marketplace-admin/discovery/features', {
    method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(input),
  })
}

export type IndustryReportingDashboard = {
  role: 'reviewer' | 'admin'
  reportDate: string
  counts: {todaySales: number; ready: number; metadataErrors: number; submitted: number; rejected: number}
  events: Array<{
    id: string
    eventType: 'sale' | 'refund'
    isrc: string | null
    upc: string | null
    artistName: string
    releaseTitle: string
    trackTitle: string
    transactionId: string
    ledgerTransactionId: string
    priceMinor: number
    quantity: number
    territory: string | null
    occurredAt: string
    validationStatus: 'pending' | 'ready' | 'metadata_error'
    validationErrors: string[]
    batchId: string | null
  }>
  batches: Array<{
    id: string
    report_date: string
    status: 'exported' | 'submitted' | 'accepted' | 'rejected'
    event_count: number
    export_format: 'csv'
    submitted_at: string | null
    resolved_at: string | null
    rejection_reason: string | null
    created_at: string
  }>
}

export function getIndustryReporting(reportDate: string): Promise<IndustryReportingDashboard> {
  return request(`/api/marketplace-admin/reporting?date=${encodeURIComponent(reportDate)}`)
}

export function validateIndustryReporting(reportDate: string): Promise<{ready: number; metadataErrors: number}> {
  return request('/api/marketplace-admin/reporting/validate', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({reportDate}),
  })
}

export function createIndustryReportingBatch(reportDate: string): Promise<IndustryReportingDashboard['batches'][number]> {
  return request('/api/marketplace-admin/reporting/batches', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({reportDate}),
  })
}

export async function downloadIndustryReportingBatch(batchId: string): Promise<void> {
  const response = await apiFetch(`/api/marketplace-admin/reporting/batches/${encodeURIComponent(batchId)}/export`, {cache: 'no-store'})
  if (!response.ok) throw new Error(`Export failed (${response.status})`)
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `mejay-reporting-${batchId}.csv`
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export function submitIndustryReportingBatch(batchId: string): Promise<void> {
  return request(`/api/marketplace-admin/reporting/batches/${encodeURIComponent(batchId)}/submit`, {method: 'POST'})
}

export function resolveIndustryReportingBatch(batchId: string, status: 'accepted' | 'rejected', reason?: string): Promise<void> {
  return request(`/api/marketplace-admin/reporting/batches/${encodeURIComponent(batchId)}/resolve`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({status, reason}),
  })
}
export type MarketplaceFinanceFilters = {from?: string; to?: string; providerId?: string; releaseId?: string; status?: string}

export type MarketplaceFinanceSummary = {
  currency: 'USD'
  totals: {
    orders: number
    grossSalesMinor: number
    stripeFeesMinor: number
    ordersWithUnknownStripeFee: number
    platformCommissionMinor: number
    processingFeesRecoveredMinor: number
    artistAllocationMinor: number
    artistEarningsAfterAdjustmentsMinor: number
    refundsMinor: number
    refundedOrders: number
    netPlatformRevenueMinor: number
    disputes: {open: number; won: number; lost: number; openAmountMinor: number; lostAmountMinor: number}
    failedPayments: number
    pendingTransfers: {count: number; amountMinor: number}
    failedTransfers: {count: number; amountMinor: number}
  }
  transactions: Array<{
    orderId: string
    paidAt: string
    providerName: string | null
    releaseTitle: string
    songTitle?: string | null
    artistName: string
    grossMinor: number
    platformCommissionMinor: number
    stripeFeeMinor: number | null
    artistAllocationMinor: number
    refundedMinor: number
    paymentStatus: string
    transferStatus: string
    disputeStatus: string
    livemode: boolean | null
  }>
}

/** Read-only marketplace finance totals and transactions (marketplace admins only). */
export function getMarketplaceFinance(filters: MarketplaceFinanceFilters): Promise<MarketplaceFinanceSummary> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
  const query = params.size ? `?${params.toString()}` : ''
  return request(`/api/marketplace-admin/finance${query}`)
}

export type ReleaseReview = {
  role: 'reviewer' | 'admin'
  release: Record<string, unknown> & {
    id: string; title: string; status: string; version: number; rights_status: string; third_party_material: string | null
    release_type: string; provider_name: string; primary_artist_name: string | null; primary_artist_slug: string | null
    artwork_asset_id: string | null; genre: string | null; subgenre: string | null; version_title: string | null
    label_name: string | null; upc: string | null; original_release_date: string | null
    copyright_year: number | null; copyright_holder: string | null; phonographic_copyright_year: number | null; phonographic_copyright_holder: string | null
    distribution_status: string
  }
  tracks: Array<{
    id: string; title: string; version_title: string | null; track_number: number; explicit: boolean; language_code: string | null
    isrc: string | null; isrc_source: string | null; audio_ready: boolean
    contributors: Array<{name: string; role: string; publisherName: string | null}>
    featured_artists: Array<{id: string; name: string}>
  }>
  certifications: Array<{
    id: string; certification_version: string; third_party_material: string; rights_status: string; certified_at: string
    accepted_certifications: Array<{key: string; title: string; text: string}>
  }>
  materials: Array<{id: string; material_type: string; licensor_name: string; description: string; license_type: string; document_asset_id: string | null; document_file_name: string | null}>
  reviewEvents: Array<{decision: string; note: string | null; from_status: string; to_status: string; created_at: string}>
  readiness: {hasMinimumPrice: boolean; stripeReady: boolean}
  warnings: string[]
}

export function getReleaseReview(releaseId: string): Promise<ReleaseReview> {
  return request(`/api/marketplace-admin/releases/${encodeURIComponent(releaseId)}/review`)
}

/** Staff-only private file (artwork or rights document); opened in a new tab with the staff session. */
export function reviewAssetUrl(assetId: string): string {
  return apiUrl(`/api/marketplace-admin/assets/${encodeURIComponent(assetId)}`)
}
