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
  /** Optional so reports from an older API still render. orderId is an internal reference, never buyer data. */
  transactions?: Array<{orderId: string; saleDate: string; releaseId: string; releaseTitle: string; songTitle?: string | null; priceMinor: number; earningsMinor: number; status: string; payoutStatus: string}>
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
  /** Public URL slug; the page at /artist/:slug is public while live_release_count > 0. */
  slug?: string
  live_release_count?: number
}

export type ArtistLinks = Partial<Record<'website' | 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'x' | 'spotify' | 'appleMusic' | 'soundcloud' | 'bandcamp' | 'tidal' | 'amazonMusic' | 'deezer', string>>

export type ArtistProfile = {
  id: string
  name: string
  slug: string
  tagline: string | null
  bio: string | null
  location: string | null
  genres: string[]
  links: ArtistLinks
  spotify_artist_id: string | null
  apple_music_artist_id: string | null
  profile_photo_asset_id: string | null
  banner_asset_id: string | null
  liveReleaseCount?: number
}

export type ArtistProfileInput = {
  name: string
  slug?: string
  tagline?: string | null
  bio?: string | null
  location?: string | null
  genres: string[]
  links: ArtistLinks
  spotifyArtistId?: string | null
  appleMusicArtistId?: string | null
  profilePhotoAssetId?: string | null
  bannerAssetId?: string | null
}

export function getArtistProfile(artistId: string): Promise<ArtistProfile> {
  return request(`/api/marketplace/artists/${encodeURIComponent(artistId)}/profile`)
}

export function updateArtistProfile(artistId: string, input: ArtistProfileInput): Promise<ArtistProfile> {
  return request(`/api/marketplace/artists/${encodeURIComponent(artistId)}/profile`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(input)})
}

export type ProviderRelease = {
  id: string
  title: string
  release_type: 'single' | 'ep' | 'album'
  status: string
  version: number
  /** Rights review state set at submission (absent from older API responses). */
  rights_status?: RightsStatus
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
  contributors?: TrackContributor[]
  featured_artist_ids?: string[]
}

export type ContributorRole = 'writer' | 'composer' | 'producer' | 'featured_artist' | 'remixer' | 'other'
export type TrackContributor = {name: string; role: ContributorRole; publisherName?: string | null}

export type RightsStatus = 'NOT_CERTIFIED' | 'CERTIFIED_ORIGINAL' | 'RIGHTS_DOCUMENTATION_ATTACHED' | 'RIGHTS_REVIEW_REQUIRED' | 'RIGHTS_CLEARED' | 'RIGHTS_ISSUE_FLAGGED'
export type ThirdPartyMaterial = 'none' | 'licensed' | 'unsure'
export type RightsMaterialType = 'sample' | 'interpolation' | 'leased_beat' | 'licensed_beat' | 'purchased_instrumental' | 'other'
export type RightsLicenseType = 'exclusive_license' | 'non_exclusive_lease' | 'sample_clearance' | 'work_for_hire' | 'producer_agreement' | 'other'

export type RightsMaterial = {
  id: string
  material_type: RightsMaterialType
  licensor_name: string
  description: string
  license_type: RightsLicenseType
  document_asset_id: string | null
}

export type ReleaseCertificationState = {
  version: string
  policy: string
  statements: Array<{key: string; title: string; text: string}>
  requiredKeys: string[]
  tracksWithoutIsrc: number
  rightsStatus: RightsStatus
  thirdPartyMaterial: ThirdPartyMaterial | null
  draft: {version: string; thirdPartyMaterial: ThirdPartyMaterial; accepted: string[]; savedAt: string} | null
  materials: RightsMaterial[]
  problems: string[]
  history: Array<{id: string; certification_version: string; third_party_material: ThirdPartyMaterial; rights_status: RightsStatus; certified_at: string}>
}

export function replaceTrackCredits(trackId: string, input: {featuredArtistIds: string[]; contributors: TrackContributor[]}): Promise<unknown> {
  return request(`/api/marketplace/tracks/${encodeURIComponent(trackId)}/credits`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(input)})
}

export function getReleaseCertification(releaseId: string): Promise<ReleaseCertificationState> {
  return request(`/api/marketplace/releases/${encodeURIComponent(releaseId)}/certification`)
}

export function saveReleaseCertification(releaseId: string, input: {version: string; thirdPartyMaterial: ThirdPartyMaterial; accepted: string[]}): Promise<unknown> {
  return request(`/api/marketplace/releases/${encodeURIComponent(releaseId)}/certification`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(input)})
}

export function addRightsMaterial(releaseId: string, input: {materialType: RightsMaterialType; licensorName: string; description: string; licenseType: RightsLicenseType; documentAssetId?: string | null}): Promise<RightsMaterial> {
  return request(`/api/marketplace/releases/${encodeURIComponent(releaseId)}/rights-materials`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input)})
}

export function deleteRightsMaterial(materialId: string): Promise<unknown> {
  return request(`/api/marketplace/rights-materials/${encodeURIComponent(materialId)}`, {method: 'DELETE'})
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
  /** Optional single-song offers (absent from older API responses). */
  trackProducts?: Array<{track_id: string; product_id: string; amount_minor: number; currency: string}>
  splits: Array<{id: string; track_id: string; entry_id: string; payee_name: string; payee_email: string | null; role: string | null; share_bps: number}>
  reviewEvents: Array<{decision: string; note: string | null; from_status: string; to_status: string; created_at: string}>
  prerequisites: string[]
}

export type ReleaseDraftStep = 'release-information' | 'artwork' | 'tracks' | 'track-metadata' | 'credits' | 'isrc' | 'rights' | 'pricing' | 'splits' | 'certification' | 'review'

type ApiEnvelope<T> = {ok: true; data: T} | {ok: false; error: string; message?: string}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init)
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null
  if (payload?.ok === false) throw new Error(payload.message || payload.error)
  if (!response.ok || !payload) throw new Error(`Request failed (${response.status})`)
  return payload.data
}

export type ProviderProfileInput = {
  displayName: string
  legalName?: string
  slug: string
  contactEmail: string
  countryCode: string
  bio?: string
}

/** Submit (or resubmit) the provider profile; moves the application into admin review. */
export function submitProviderProfile(input: ProviderProfileInput): Promise<{id: string; status: string}> {
  return request('/api/marketplace/providers', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(input),
  })
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

type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp'
type UploadInput =
  | {kind: 'artwork'; releaseId: string; fileName: string; mimeType: ImageMime; byteSize: number; width: number; height: number}
  | {kind: 'audio'; trackId: string; fileName: string; mimeType: 'audio/wav' | 'audio/x-wav' | 'audio/flac' | 'audio/x-flac'; byteSize: number}
  | {kind: 'artist_photo' | 'artist_banner'; artistId: string; fileName: string; mimeType: ImageMime; byteSize: number; width: number; height: number}
  | {kind: 'rights_document'; releaseId: string; fileName: string; mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'; byteSize: number}

/** Signed upload: start, PUT to private storage, then server-side verification. Returns the ready asset id. */
export async function uploadProviderAsset(input: UploadInput, file: File): Promise<string> {
  const initiated = await request<{asset: {id: string}; upload: {url: string; headers: Record<string, string>}}>('/api/marketplace/uploads', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input),
  })
  const response = await fetch(initiated.upload.url, {method: 'PUT', headers: initiated.upload.headers, body: file})
  if (!response.ok) throw new Error(`Upload failed (${response.status})`)
  await request('/api/marketplace/uploads/finalize', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({assetId: initiated.asset.id}),
  })
  return initiated.asset.id
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

export type MarketplacePricingPolicy = {
  currency: 'USD'
  minimumPriceMinor: number
  platformFeeBps: number
  estimate: {
    grossAmountMinor: number
    platformCommissionMinor: number
    estimatedProcessingFeeMinor: number
    estimatedArtistProceedsMinor: number
  } | null
}

/**
 * The server's marketplace sale policy (minimum price, commission) and, for an amount, the per-sale
 * estimate from the same calculator fulfillment uses. The UI keeps no copy of the fee model.
 */
export function getMarketplacePricingPolicy(amountMinor?: number): Promise<MarketplacePricingPolicy> {
  const query = amountMinor === undefined ? '' : `?amountMinor=${encodeURIComponent(String(amountMinor))}`
  return request(`/api/marketplace/pricing-policy${query}`)
}

/** Create or update the release's price in one atomic request. */
export async function createProviderPricing(releaseId: string, title: string, amountMinor: number): Promise<void> {
  await request(`/api/marketplace/releases/${encodeURIComponent(releaseId)}/price`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({name: title, amountMinor})})
}

/** Sell one song on its own, alongside the release (locked once the release is submitted). */
export async function setProviderTrackPrice(trackId: string, amountMinor: number): Promise<void> {
  await request(`/api/marketplace/tracks/${encodeURIComponent(trackId)}/price`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({amountMinor})})
}

/** Stop selling a song on its own; it stays available as part of the release. */
export async function clearProviderTrackPrice(trackId: string): Promise<void> {
  await request(`/api/marketplace/tracks/${encodeURIComponent(trackId)}/price`, {method: 'DELETE'})
}

export function replaceProviderSplits(trackId: string, entries: Array<{payeeName: string; payeeEmail?: string; role?: string; shareBps: number}>): Promise<unknown> {
  return request(`/api/marketplace/tracks/${encodeURIComponent(trackId)}/revenue-splits`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({entries})})
}

export function submitProviderRelease(releaseId: string, expectedVersion: number): Promise<ProviderRelease> {
  return request(`/api/marketplace/releases/${encodeURIComponent(releaseId)}/submit`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({expectedVersion})})
}