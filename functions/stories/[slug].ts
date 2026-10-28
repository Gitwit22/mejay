type Env = {
  API_ORIGIN?: string
  ASSETS: {fetch: (request: Request | string) => Promise<Response>}
}

type PublicStory = {title: string; teaser: string | null; slug: string; cover: {url: string} | null; background: {url: string} | null}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Story links shared on social apps: crawlers don't run JavaScript, so the page's title,
 * description and image tags are filled in here from the published story. Anything unexpected
 * (unknown or unpublished story, API down) serves the normal app page unchanged.
 */
export const onRequest: PagesFunction<Env> = async ({request, env, params}) => {
  const page = await env.ASSETS.fetch(new Request(new URL('/', request.url).toString(), request))
  const slug = String(params.slug ?? '').toLowerCase()
  if (!SLUG.test(slug) || slug.length > 80) return page
  try {
    const apiOrigin = (env.API_ORIGIN || 'https://mejay-api.onrender.com').replace(/\/$/, '')
    const response = await fetch(`${apiOrigin}/api/stories/${slug}`, {headers: {accept: 'application/json'}, cf: {cacheTtl: 60}} as RequestInit)
    if (!response.ok) return page
    const payload = await response.json() as {ok: boolean; data?: PublicStory}
    const story = payload.ok ? payload.data : undefined
    if (!story) return page
    const origin = new URL(request.url).origin
    const image = story.cover?.url ?? story.background?.url
    const meta: Record<string, string> = {
      'og:title': story.title,
      'og:description': story.teaser ?? 'A story on MeJay',
      'og:type': 'article',
      'og:url': `${origin}/stories/${story.slug}`,
      ...(image ? {'og:image': `${origin}${image}`, 'twitter:image': `${origin}${image}`} : {}),
      description: story.teaser ?? 'A story on MeJay',
      'twitter:card': image ? 'summary_large_image' : 'summary',
      'twitter:title': story.title,
    }
    const seen = new Set<string>()
    const rewritten = new HTMLRewriter()
      .on('title', {element: (element) => { element.setInnerContent(`${story.title} | MeJay Stories`) }})
      .on('meta', {element: (element) => {
        const key = element.getAttribute('property') ?? element.getAttribute('name')
        if (key && key in meta) {
          element.setAttribute('content', meta[key])
          seen.add(key)
        }
      }})
      .on('head', {element: (element) => {
        element.onEndTag((end) => {
          for (const [key, value] of Object.entries(meta)) {
            if (seen.has(key)) continue
            const attribute = key.startsWith('og:') ? 'property' : 'name'
            end.before(`<meta ${attribute}="${key}" content="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" />`, {html: true})
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
