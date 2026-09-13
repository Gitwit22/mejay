type Env = {
  API_ORIGIN?: string
}

export const onRequest: PagesFunction<Env> = async ({request, env}) => {
  const apiOrigin = (env.API_ORIGIN || 'https://mejay-api.onrender.com').replace(/\/$/, '')
  const incomingUrl = new URL(request.url)
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, apiOrigin)

  const headers = new Headers(request.headers)
  headers.delete('host')

  return fetch(
    new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    }),
  )
}