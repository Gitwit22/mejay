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
}

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