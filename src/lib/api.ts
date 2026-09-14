const DEFAULT_PRODUCTION_API_URL = 'https://mejay-api.onrender.com'
const SAME_ORIGIN_API_HOSTS = new Set(['mejay2.pages.dev'])

export function resolveApiBaseUrl(
  options?: {configuredApiUrl?: string; isProd?: boolean; useSameOriginApi?: boolean; hostname?: string},
): string {
  const configured = String(options?.configuredApiUrl ?? import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
  if (configured) return configured
  if (!(options?.isProd ?? import.meta.env.PROD)) return ''
  const hostname = (options?.hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '')).toLowerCase()
  if ((options?.useSameOriginApi ?? (import.meta.env.VITE_USE_SAME_ORIGIN_API === '1')) || SAME_ORIGIN_API_HOSTS.has(hostname)) return ''
  return DEFAULT_PRODUCTION_API_URL
}

const API_URL = resolveApiBaseUrl()

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