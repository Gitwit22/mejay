const DEFAULT_PRODUCTION_API_URL = 'https://mejay-api.onrender.com'

export function resolveApiBaseUrl(
  hostname?: string,
  options?: {configuredApiUrl?: string; isProd?: boolean},
): string {
  const configured = String(options?.configuredApiUrl ?? import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
  if (configured) return configured
  if (!(options?.isProd ?? import.meta.env.PROD)) return ''
  if (hostname?.toLowerCase().endsWith('.pages.dev')) return ''
  return DEFAULT_PRODUCTION_API_URL
}

const API_URL = resolveApiBaseUrl(typeof window !== 'undefined' ? window.location.hostname : undefined)

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_URL}${normalizedPath}`
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    credentials: init.credentials ?? 'include',
  })
}