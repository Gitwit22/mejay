import {cookieHeaderForLogout, deleteSession} from '../_auth'

type Env = {
  DB: any
  SESSION_PEPPER?: string
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
      expires: '0',
      ...(init?.headers ?? {}),
    },
  })

export const onRequest = async (ctx: {request: Request; env: Env}): Promise<Response> => {
  const {request, env} = ctx
  if (request.method !== 'POST') return json({ok: false, error: 'Method not allowed'}, {status: 405})

  await deleteSession(request, env)

  const secure = new URL(request.url).protocol === 'https:'
  return new Response(JSON.stringify({ok: true}), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'Set-Cookie': cookieHeaderForLogout(secure),
    },
  })
}
