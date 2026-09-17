import {apiFetch, apiUrl} from './api'

export type StoreRelease = {
  id: string
  title: string
  release_type: 'single' | 'ep' | 'album'
  genre: string | null
  original_release_date: string | null
  published_at: string
  artist_id: string
  artist_name: string
  artwork_asset_id: string | null
  product_id: string
  amount_minor: number
  currency: string
  purchase_available: boolean
  track_count: number
  preview_asset_id: string | null
}

export type StoreTrack = {
  id: string
  title: string
  version_title: string | null
  disc_number: number
  track_number: number
  duration_ms: number | null
  explicit: boolean
  preview_asset_id: string | null
}

export type StoreReleaseDetail = {
  release: StoreRelease & {
    version_title: string | null
    subgenre: string | null
    label_name: string | null
  }
  tracks: StoreTrack[]
}

type Envelope<T> = {ok: true; data: T} | {ok: false; error: string; message?: string}

async function request<T>(path: string): Promise<T> {
  const response = await apiFetch(path, {cache: 'no-store'})
  const payload = await response.json().catch(() => null) as Envelope<T> | null
  if (!payload) throw new Error(`Store request failed (${response.status})`)
  if ('error' in payload) throw new Error(payload.message || payload.error)
  if (!response.ok) throw new Error(`Store request failed (${response.status})`)
  return payload.data
}

export function listStoreReleases(): Promise<StoreRelease[]> {
  return request('/api/store/releases')
}

export function getStoreRelease(releaseId: string): Promise<StoreReleaseDetail> {
  return request(`/api/store/releases/${encodeURIComponent(releaseId)}`)
}

export function storeAssetUrl(assetId: string | null | undefined): string | null {
  return assetId ? apiUrl(`/api/store/assets/${encodeURIComponent(assetId)}`) : null
}