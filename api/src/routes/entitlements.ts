type D1Database = any

type Env = {
  DB: D1Database
  SESSION_PEPPER?: string
}

type AccessType = 'free' | 'pro' | 'full_program'

type EntitlementsResponse = {
  accessType: AccessType
  hasFullAccess: boolean
  stripeCustomerId?: string
  updatedAt?: string
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
      expires: '0',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      ...(init?.headers ?? {}),
    },
  })

function normalizeAccessType(raw: unknown): AccessType {
  if (raw === 'pro') return 'pro'
  if (raw === 'full') return 'full_program'
  if (raw === 'full_program') return 'full_program'
  return 'free'
}

async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input)
  const hashBuf = await crypto.subtle.digest('SHA-256', enc)
  return [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function parseCookies(req: Request) {
  const raw = req.headers.get('cookie') || ''
  const out: Record<string, string> = {}
  raw.split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=')
    if (!k) return
    out[k] = decodeURIComponent(v.join('=') || '')
  })
  return out
}

async function getSessionUserId(req: Request, env: Env): Promise<string | null> {
  const cookies = parseCookies(req)
  const token = cookies['mejay_session']
  if (!token) return null

  const pepper = env.SESSION_PEPPER || 'dev-session-pepper'
  const tokenHash = await sha256Hex(`session:${token}:${pepper}`)
  const row = (await env.DB
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?1')
    .bind(tokenHash)
    .first()) as {user_id: string; expires_at: string} | null

  if (!row) return null
  if (row.expires_at < new Date().toISOString()) return null
  return row.user_id
}

export const onRequest = async (context: {request: Request; env: Env}): Promise<Response> => {
  const {request, env} = context

  if (request.method === 'OPTIONS') return json({ok: true}, {status: 200})
  if (request.method !== 'GET') return json({error: 'Method not allowed'}, {status: 405})

  try {
    const userId = await getSessionUserId(request, env)
    if (!userId) return json({error: 'Unauthorized'}, {status: 401})

    const row = (await env.DB.prepare(
      'SELECT access_type, has_full_access, stripe_customer_id, updated_at FROM entitlements WHERE user_id = ?1 LIMIT 1',
    )
      .bind(userId)
      .first()) as
      | {
          access_type: string
          has_full_access: number
          stripe_customer_id: string | null
          updated_at: string | null
        }
      | null

    if (!row) {
      return json({accessType: 'free', hasFullAccess: false} satisfies EntitlementsResponse, {status: 200})
    }

    const accessType = normalizeAccessType(row.access_type)
    const hasFullAccess = !!row.has_full_access

    // Only treat as unlocked when the server says it is fully active.
    const normalized: EntitlementsResponse = hasFullAccess
      ? {
          accessType,
          hasFullAccess: true,
          stripeCustomerId: row.stripe_customer_id ?? undefined,
          updatedAt: row.updated_at ?? undefined,
        }
      : {accessType: 'free', hasFullAccess: false}

    return json(normalized, {status: 200})
  } catch (e) {
    return json(
      {
        error: 'Entitlements lookup failed',
        message: e instanceof Error ? e.message : 'Unknown error',
      },
      {status: 500},
    )
  }
}
