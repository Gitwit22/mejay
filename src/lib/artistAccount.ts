import {apiFetch} from './api'
import {parseProviderStatus, type ProviderSummary} from './marketplace'

type ArtistAccountPayload = {
  ok?: boolean
  error?: string
  message?: string
  provider?: {
    id?: unknown
    status?: unknown
    role?: unknown
  }
}

export class ArtistAccountError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function convertToArtistAccount(): Promise<ProviderSummary> {
  const response = await apiFetch('/api/account/artist', {method: 'POST'})
  const payload = await response.json().catch(() => null) as ArtistAccountPayload | null
  const status = parseProviderStatus(payload?.provider?.status)
  if (
    response.ok
    && payload?.ok === true
    && typeof payload.provider?.id === 'string'
    && status
    && typeof payload.provider.role === 'string'
  ) {
    return {id: payload.provider.id, status, role: payload.provider.role}
  }

  throw new ArtistAccountError(
    response.status,
    payload?.error || 'artist_conversion_failed',
    payload?.message || 'The Artist account could not be activated.',
  )
}