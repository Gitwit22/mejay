type D1Database = any

type Env = {
  STRIPE_SECRET_KEY: string
  DB: D1Database
  SESSION_PEPPER?: string
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
      expires: '0',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  })
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

async function getSessionUserId(req: Request, env: Pick<Env, 'DB' | 'SESSION_PEPPER'>) {
  const cookies = parseCookies(req)
  const token = cookies['mejay_session']
  if (!token) return null

  const pepper = env.SESSION_PEPPER || 'dev-session-pepper'
  const sessionHash = await sha256Hex(`session:${token}:${pepper}`)
  const row = (await env.DB
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?1')
    .bind(sessionHash)
    .first()) as {user_id: string; expires_at: string} | null

  if (!row) return null
  if (row.expires_at < new Date().toISOString()) return null
  return row.user_id
}

async function stripePost(secretKey: string, path: string, body: URLSearchParams): Promise<any> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const text = await res.text()
  if (!res.ok) {
    let message = text.slice(0, 500)
    try {
      const parsed = JSON.parse(text) as any
      const parsedMessage = parsed?.error?.message
      if (typeof parsedMessage === 'string' && parsedMessage.trim()) {
        message = parsedMessage
      }
    } catch {
      // ignore
    }

    throw new Error(message)
  }
  return JSON.parse(text)
}

export const onRequest = async (ctx: {request: Request; env: Env}) => {
  const {request, env} = ctx

  if (request.method === 'OPTIONS') return json({ok: true}, 200)
  if (request.method !== 'POST') return json({error: 'Method not allowed'}, 405)

  const secretKey = env.STRIPE_SECRET_KEY?.trim()
  if (!secretKey) {
    return json({error: 'Missing env var: STRIPE_SECRET_KEY'}, 500)
  }
  if (!secretKey.startsWith('sk_')) {
    return json({error: 'Invalid STRIPE_SECRET_KEY'}, 500)
  }

  if (!env.DB) {
    return json({error: 'DB not configured'}, 500)
  }

  const userId = await getSessionUserId(request, env)
  if (!userId) {
    return json({error: 'Login required'}, 401)
  }

  const row = (await env.DB
    .prepare('SELECT stripe_customer_id FROM entitlements WHERE user_id = ?1 LIMIT 1')
    .bind(userId)
    .first()) as {stripe_customer_id: string | null} | null

  const customerId = (row?.stripe_customer_id ?? '').trim()
  if (!customerId) {
    return json(
      {
        error: 'No billing profile found',
        message: 'No Stripe customer found for this account. If you just purchased, refresh and try again.',
      },
      409,
    )
  }

  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`
  const returnUrl = `${origin}/app/pricing?portal=return`

  try {
    const params = new URLSearchParams()
    params.set('customer', customerId)
    params.set('return_url', returnUrl)

    const session = await stripePost(secretKey, '/v1/billing_portal/sessions', params)
    const redirectUrl: string | undefined = session?.url
    if (!redirectUrl) return json({error: 'No billing portal URL returned'}, 500)

    return json({url: redirectUrl}, 200)
  } catch (err: any) {
    return json({error: err?.message ?? 'Stripe error'}, 500)
  }
}
