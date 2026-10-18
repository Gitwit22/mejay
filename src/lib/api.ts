const DEFAULT_PRODUCTION_API_URL = 'https://mejay-api.onrender.com'
// Frontend hosts served by the Pages project, whose /api Function proxies to the API. Calling the
// API through it keeps the session cookie first-party; a direct cross-site call loses it.
const SAME_ORIGIN_API_HOSTS = new Set(['mejayapp.com', 'www.mejayapp.com'])
export function resolveApiBase(configuredUrl: string, production: boolean, hostname: string): string {
  const normalizedHostname = hostname.toLowerCase()
  if (
    normalizedHostname === 'mejay2.pages.dev' ||
    normalizedHostname.endsWith('.mejay2.pages.dev') ||
    SAME_ORIGIN_API_HOSTS.has(normalizedHostname) ||
    import.meta.env.VITE_USE_SAME_ORIGIN_API === '1'
  ) {
    return ''
  }
  return String(configuredUrl || (production ? DEFAULT_PRODUCTION_API_URL : '')).replace(/\/$/, '')
}

const API_URL = resolveApiBase(
  String(import.meta.env.VITE_API_URL || ''),
  import.meta.env.PROD,
  typeof window === 'undefined' ? '' : window.location.hostname,
)

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