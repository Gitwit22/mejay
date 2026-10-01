import {apiFetch} from './api'
import type {StoreRelease} from './musicStoreApi'

export type DiscoveryArtist = {
  id: string
  name: string
  artwork_asset_id: string | null
  release_count: number
}

export type MusicDiscovery = {
  newestReleases: StoreRelease[]
  newestSingles: StoreRelease[]
  newestProjects: StoreRelease[]
  mostPurchased: StoreRelease[]
  mostPreviewed: StoreRelease[]
  featuredReleases: StoreRelease[]
  featuredArtists: DiscoveryArtist[]
}

type Envelope<T> = {ok: true; data: T} | {ok: false; error: string; message?: string}

export async function getMusicDiscovery(): Promise<MusicDiscovery> {
  const response = await apiFetch('/api/music/discovery', {cache: 'no-store'})
  const payload = await response.json().catch(() => null) as Envelope<MusicDiscovery> | null
  if (!payload) throw new Error(`Music discovery failed (${response.status})`)
  if ('error' in payload) throw new Error(payload.message || payload.error)
  if (!response.ok) throw new Error(`Music discovery failed (${response.status})`)
  return payload.data
}
