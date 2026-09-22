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
  const response = await apiFetch(getIsrcExportUrl(filters), {cache: 'no-store'})
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

export type ReleaseAdminAction = 'start_review' | 'approve' | 'request_changes' | 'reject' | 'publish_now' | 'schedule' | 'publish_due' | 'unpublish' | 'takedown'

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