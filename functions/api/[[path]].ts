type Env = {
  API_ORIGIN?: string
  /** Shared with the API's API_PROXY_SECRET so it can trust the forwarded client IP. */
  API_PROXY_SECRET?: string
}

export const onRequest: PagesFunction<Env> = async ({request, env}) => {
  const apiOrigin = (env.API_ORIGIN || 'https://mejay-api.onrender.com').replace(/\/$/, '')
  const incomingUrl = new URL(request.url)
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, apiOrigin)

  const headers = new Headers(request.headers)
  headers.delete('host')
  // Never forward client-supplied proxy headers; only this function may set them.
  headers.delete('x-forwarded-host')
  headers.delete('x-mejay-proxy-secret')
  headers.delete('x-mejay-proxy-client-ip')
  headers.delete('x-mejay-client-ip')
  const clientIp = request.headers.get('cf-connecting-ip')
  if (env.API_PROXY_SECRET && clientIp) {
    headers.set('x-mejay-proxy-secret', env.API_PROXY_SECRET)
    headers.set('x-mejay-proxy-client-ip', clientIp)
  }

  const upstreamResponse = await fetch(
    new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    }),
  )

  const responseHeaders = new Headers(upstreamResponse.headers)
  const sessionCookie = responseHeaders.get('set-cookie')
  if (sessionCookie?.startsWith('mejay_session=')) {
    responseHeaders.set('set-cookie', sessionCookie.replace(/SameSite=None/i, 'SameSite=Lax'))
  }
  responseHeaders.set(
    'x-mejay-proxy-session',
    request.headers.get('cookie')?.includes('mejay_session=') ? 'present' : 'absent',
  )

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
}