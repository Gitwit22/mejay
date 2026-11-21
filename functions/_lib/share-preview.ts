import {metaTagHtml, type ShareMeta} from '../../src/lib/shareMeta'

/**
 * Shared by the link-preview Pages functions. Not a route: Pages only routes files that export
 * an onRequest handler.
 *
 * Serves the normal app page with its title, description and image tags replaced for the shared
 * item. Crawlers (iMessage, WhatsApp, X, Facebook, Slack...) read these; people get the same app
 * page they always did. Anything unexpected (unknown item, API slow or down) serves the normal
 * page unchanged, so a preview problem can never break the page itself.
 */

export type PreviewEnv = {
  API_ORIGIN?: string
  ASSETS: {fetch: (request: Request | string) => Promise<Response>}
}

/** Real visitors wait on this lookup too, so it gives up quickly and falls back to the plain page. */
const LOOKUP_TIMEOUT_MS = 2500

export function apiOriginFor(env: PreviewEnv): string {
  return (env.API_ORIGIN || 'https://mejay-api.onrender.com').replace(/\/$/, '')
}

/** GETs a public `{ok, data}` API endpoint; null on any failure, non-2xx or timeout. */
export async function fetchPublicData<T>(env: PreviewEnv, path: string): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const response = await fetch(`${apiOriginFor(env)}${path}`, {
      headers: {accept: 'application/json'},
      signal: controller.signal,
      cf: {cacheTtl: 60},
    } as RequestInit)
    if (!response.ok) return null
    const payload = await response.json() as {ok?: boolean; data?: T}
    return payload.ok && payload.data ? payload.data : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function servePageWithShareMeta(
  request: Request,
  env: PreviewEnv,
  buildMeta: (origin: string) => Promise<ShareMeta | null>,
): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL('/', request.url).toString(), request))
  try {
    const meta = await buildMeta(new URL(request.url).origin)
    if (!meta) return page
    const seen = new Set<string>()
    const rewritten = new HTMLRewriter()
      .on('title', {element: (element) => { element.setInnerContent(meta.documentTitle) }})
      .on('meta', {element: (element) => {
        const key = element.getAttribute('property') ?? element.getAttribute('name')
        if (key && key in meta.tags) {
          element.setAttribute('content', meta.tags[key])
          seen.add(key)
        }
      }})
      .on('head', {element: (element) => {
        element.onEndTag((end) => {
          for (const [key, value] of Object.entries(meta.tags)) {
            if (!seen.has(key)) end.before(metaTagHtml(key, value), {html: true})
          }
        })
      }})
      .transform(page)
    const headers = new Headers(rewritten.headers)
    headers.set('cache-control', 'public, max-age=60')
    return new Response(rewritten.body, {status: 200, headers})
  } catch {
    return page
  }
}
