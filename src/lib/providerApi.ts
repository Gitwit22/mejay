import {apiFetch} from './api'

export type ProviderDashboard = {
  provider: {
    id: string
    display_name: string | null
    status: string
    role: string
  }
  counts: {
    artists: number
    releases: number
    drafts: number
    live_releases: number
    active_isrcs: number
  }
}

export type ReportingRange = '7d' | '30d' | '90d' | 'ytd' | 'all'

export type ReportingPeriod = {range: ReportingRange; startAt: string | null; endAt: string}

export type ProviderSalesReport = {
  period: ReportingPeriod
  currency: 'USD'
  summary: {grossSalesMinor: number; unitsSold: number; earningsMinor: number; pendingMinor: number; paidOutMinor: number; refundsMinor: number; refundCount: number; downloadCount: number}
  topSongs: Array<{trackId: string | null; title: string; units: number; earningsMinor: number}>
  salesByRelease: Array<{releaseId: string; title: string; artistName: string; units: number; grossMinor: number; earningsMinor: number; refundsMinor: number; downloads: number}>
  salesByDay: Array<{date: string; units: number; grossMinor: number; earningsMinor: number; refundsMinor: number}>
  salesByTerritory: Array<{countryCode: string | null; units: number; grossMinor: number; earningsMinor: number}>
  downloads: Array<{release_id: string; release_title: string; track_id: string | null; track_title: string; download_count: number}>
  refunds: Array<{orderId: string; saleDate: string; releaseId: string; releaseTitle: string; amountMinor: number; status: string}>
  recipientLiabilities: Array<{name: string; email: string | null; role: string | null; allocatedMinor: number; refundAdjustmentMinor: number; owedMinor: number}>
}

export type RecipientEarningsReport = {
  period: ReportingPeriod
  currency: 'USD'
  recipientEmail: string
  summary: {allocatedMinor: number; refundAdjustmentMinor: number; owedMinor: number}
  rows: Array<{allocationId: string; orderId: string; saleDate: string; releaseId: string; releaseTitle: string; trackId: string | null; trackTitle: string; role: string | null; allocatedMinor: number; refundAdjustmentMinor: number; owedMinor: number}>
}

export type ProviderArtist = {
  id: string
  name: string
  sort_name: string | null
  country_code: string | null
  release_count: number
  created_at: string
}

export type ProviderRelease = {
  id: string
  title: string
  release_type: 'single' | 'ep' | 'album'
  status: string
  version: number
  primary_artist_id: string
  primary_artist_name: string
  track_count: number
  updated_at: string
  draft_step?: ReleaseDraftStep
}

export type ProviderTrack = {
  id: string
  title: string
  version_title: string | null
  disc_number: number
  track_number: number
  duration_ms: number | null
  explicit: boolean
  language_code: string | null
  primary_artist_name: string | null
  isrc: string | null
  primary_artist_id?: string
  genre?: string | null
  instrumental?: boolean
  recording_year?: number | null
  recording_location?: string | null
}

export type ProviderReleaseDetail = {
  release: ProviderRelease & {
    draft_step: ReleaseDraftStep
    version_title: string | null
    label_name: string | null
    catalog_number: string | null
    genre: string | null
    subgenre: string | null
    upc: string | null
    original_release_date: string | null
    scheduled_release_at: string | null
    copyright_year: number | null
    copyright_holder: string | null
    phonographic_copyright_year: number | null
    phonographic_copyright_holder: string | null
  }
  tracks: ProviderTrack[]
  assets: Array<{id: string; release_id: string | null; track_id: string | null; kind: 'artwork' | 'audio'; processing_status: string; metadata: Record<string, unknown>}>
  rights: Array<{id: string; release_id: string | null; track_id: string | null; declaration_type: 'distribution' | 'master' | 'composition'; rights_holder: string; ownership_bps: number; territories: string[]}>
  product: {id: string; name: string; amount_minor: number | null; currency: string | null} | null
  splits: Array<{id: string; track_id: string; entry_id: string; payee_name: string; payee_email: string | null; role: string | null; share_bps: number}>
  reviewEvents: Array<{decision: string; note: string | null; from_status: string; to_status: string; created_at: string}>
  prerequisites: string[]
}

export type ReleaseDraftStep = 'release-information' | 'artwork' | 'tracks' | 'track-metadata' | 'isrc' | 'rights' | 'pricing' | 'splits' | 'review'

type ApiEnvelope<T> = {ok: true; data: T} | {ok: false; error: string; message?: string}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init)
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null
  if (payload?.ok === false) throw new Error(payload.message || payload.error)
  if (!response.ok || !payload) throw new Error(`Request failed (${response.status})`)
  return payload.data
}

export function getProviderDashboard(): Promise<ProviderDashboard> {
  return request('/api/marketplace/dashboard')
}

export function getProviderReporting(range: ReportingRange): Promise<ProviderSalesReport> {
  return request(`/api/marketplace/reporting?range=${encodeURIComponent(range)}`)
}

export function getRecipientEarnings(range: ReportingRange): Promise<RecipientEarningsReport> {
  return request(`/api/marketplace/recipient-earnings?range=${encodeURIComponent(range)}`)
}

export function listProviderArtists(): Promise<ProviderArtist[]> {
  return request('/api/marketplace/artists')
}

export function createProviderArtist(input: {name: string; sortName?: string; countryCode?: string}): Promise<ProviderArtist> {
  return request('/api/marketplace/artists', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({...input, metadata: {}}),
  })
}

export function listProviderReleases(): Promise<ProviderRelease[]> {
  return request('/api/marketplace/releases')
}

export function createProviderRelease(input: {
  title: string
  releaseType: ProviderRelease['release_type']
  primaryArtistId: string
}): Promise<ProviderRelease> {
  return request('/api/marketplace/releases', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(input),
  })
}

export function getProviderRelease(releaseId: string): Promise<ProviderReleaseDetail> {
  return request(`/api/marketplace/releases/${encodeURIComponent(releaseId)}`)
}

export function updateProviderRelease(releaseId: string, input: {
  expectedVersion: number
  draftStep: ReleaseDraftStep
  title: string
  versionTitle?: string | null
  releaseType: ProviderRelease['release_type']
  primaryArtistId: string
  labelName?: string | null
  catalogNumber?: string | null
  genre?: string | null
  subgenre?: string | null
  upc?: string | null
  originalReleaseDate?: string | null
  scheduledReleaseAt?: string | null
  copyrightYear?: number | null
  copyrightHolder?: string | null
  phonographicCopyrightYear?: number | null
  phonographicCopyrightHolder?: string | null
}): Promise<ProviderReleaseDetail['release']> {
  return request(`/api/marketplace/releases/${encodeURIComponent(releaseId)}`, {
    method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify(input),
  })
}

export function createProviderTrack(releaseId: string, input: {
  title: string
  primaryArtistId: string
  trackNumber: number
  discNumber?: number
  explicit?: boolean
  languageCode?: string
}): Promise<ProviderTrack> {
  return request(`/api/marketplace/releases/${encodeURIComponent(releaseId)}/tracks`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...input, metadata: {}}),
  })
}

type UploadInput =
  | {kind: 'artwork'; releaseId: string; fileName: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; byteSize: number; width: number; height: number}
  | {kind: 'audio'; trackId: string; fileName: string; mimeType: 'audio/wav' | 'audio/x-wav' | 'audio/flac' | 'audio/x-flac'; byteSize: number}

export async function uploadProviderAsset(input: UploadInput, file: File): Promise<void> {
  const initiated = await request<{asset: {id: string}; upload: {url: string; headers: Record<string, string>}}>('/api/marketplace/uploads', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input),
  })
  const response = await fetch(initiated.upload.url, {method: 'PUT', headers: initiated.upload.headers, body: file})
  if (!response.ok) throw new Error(`Upload failed (${response.status})`)
  await request('/api/marketplace/uploads/finalize', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({assetId: initiated.asset.id}),
  })
}

export function assignProviderIsrc(trackId: string, isrc: string): Promise<{isrc: string}> {
  return request(`/api/tracks/${encodeURIComponent(trackId)}/isrc/existing`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({isrc}),
  })
}

export function generateProviderIsrc(trackId: string, input: {
  controlsRecording: true
  neverAssignedIsrc: true
  authorizeAssignment: true
}): Promise<{isrc: string}> {
  return request(`/api/tracks/${encodeURIComponent(trackId)}/isrc/assign`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input),
  })
}

export function updateProviderTrack(trackId: string, input: {
  title: string
  versionTitle?: string | null
  primaryArtistId: string
  discNumber: number
  trackNumber: number
  durationMs?: number | null
  explicit: boolean
  languageCode?: string | null
  genre?: string | null
  instrumental: boolean
  recordingYear?: number | null
  recordingLocation?: string | null
}): Promise<ProviderTrack> {
  return request(`/api/marketplace/tracks/${encodeURIComponent(trackId)}`, {
    method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify(input),
  })
}

export function createProviderRights(input: {releaseId?: string; trackId?: string; declarationType: 'distribution' | 'master' | 'composition'; rightsHolder: string; ownershipBps: number; territories: string[]}): Promise<unknown> {
  return request('/api/marketplace/rights-declarations', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input)})
}

export async function createProviderPricing(releaseId: string, title: string, amountMinor: number): Promise<void> {
  const product = await request<{id: string}>('/api/marketplace/products', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({releaseId, name: title})})
  await request(`/api/marketplace/products/${encodeURIComponent(product.id)}/prices`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({amountMinor, currency: 'USD'})})
}

export function replaceProviderSplits(trackId: string, entries: Array<{payeeName: string; payeeEmail?: string; role?: string; shareBps: number}>): Promise<unknown> {
  return request(`/api/marketplace/tracks/${encodeURIComponent(trackId)}/revenue-splits`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({entries})})
}

export function submitProviderRelease(releaseId: string, expectedVersion: number): Promise<ProviderRelease> {
  return request(`/api/marketplace/releases/${encodeURIComponent(releaseId)}/submit`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({expectedVersion})})
}