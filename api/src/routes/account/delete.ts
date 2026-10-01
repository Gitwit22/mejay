import {AccountDeletionError, AccountDeletionService} from '../../account/deletion'
import type {PrivateBucket} from '../../services/r2'
import {cookieHeaderForLogout, getSessionUserId, readJson, shouldUseSecureCookie} from '../_auth'

type Env = {
  DB: any
  DOWNLOADS?: PrivateBucket
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
    const {storageKeys} = await new AccountDeletionService(env.DB).deleteCurrentUser({
      userId,
      email,
      forfeitFullProgram: body.forfeitFullProgram === true,
    })
    // Best effort: the account is already gone; leftover objects are unreachable and only cost storage.
    if (env.DOWNLOADS && storageKeys.length > 0) {
      const bucket = env.DOWNLOADS
      const results = await Promise.allSettled(storageKeys.map((key) => bucket.delete(key)))
      const failed = results.filter((result) => result.status === 'rejected').length
      if (failed > 0) console.warn('[account-delete] some uploads could not be removed from storage', {failed, total: storageKeys.length})
    }
    const secure = shouldUseSecureCookie(request, env as {COOKIE_SECURE?: string})
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