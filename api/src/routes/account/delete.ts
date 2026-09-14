import {AccountDeletionError, AccountDeletionService} from '../../account/deletion'
import {cookieHeaderForLogout, getSessionUserId, readJson} from '../_auth'

type Env = {
  DB: any
  SESSION_PEPPER?: string
  COOKIE_SAME_SITE?: 'lax' | 'none' | 'strict'
}

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
  ...init,
  headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0', ...(init?.headers ?? {})},
})

export const onRequest = async ({request, env}: {request: Request; env: Env}): Promise<Response> => {
  if (request.method !== 'DELETE') return json({ok: false, error: 'method_not_allowed'}, {status: 405})
  const userId = await getSessionUserId(request, env)
  if (!userId) return json({ok: false, error: 'unauthorized'}, {status: 401})

  const body = await readJson(request) as {email?: unknown; forfeitFullProgram?: unknown}
  const email = typeof body.email === 'string' ? body.email : ''
  if (!email.trim()) return json({ok: false, error: 'confirmation_required', message: 'Enter the current account email'}, {status: 400})

  try {
    await new AccountDeletionService(env.DB).deleteCurrentUser({
      userId,
      email,
      forfeitFullProgram: body.forfeitFullProgram === true,
    })
    const secure = new URL(request.url).protocol === 'https:'
    return json({ok: true}, {headers: {'set-cookie': cookieHeaderForLogout({secure, sameSite: env.COOKIE_SAME_SITE})}})
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      return json({ok: false, error: error.code, message: error.message}, {status: error.status})
    }
    const errorId = crypto.randomUUID()
    console.error('[account-delete] failed', {errorId, error})
    return json({ok: false, error: 'deletion_failed', errorId}, {status: 500})
  }
}