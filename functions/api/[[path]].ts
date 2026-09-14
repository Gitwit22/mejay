type Env = {
  API_ORIGIN?: string
}

export const onRequest: PagesFunction<Env> = async ({request, env}) => {
  const apiOrigin = (env.API_ORIGIN || 'https://mejay-api.onrender.com').replace(/\/$/, '')
  const incomingUrl = new URL(request.url)
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, apiOrigin)

  const headers = new Headers(request.headers)
  headers.delete('host')

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