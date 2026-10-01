/**
 * Dev Admin Guard
 * Only allows access in development/staging environments with explicit allowlist
 */

import { getSessionUserId } from '../_auth'

type Env = {
  DB: any
  SESSION_PEPPER?: string
  NODE_ENV?: string
  ALLOW_DEV_ADMIN?: string
  DEV_ADMIN_EMAILS?: string
}

export async function requireDevAdmin(request: Request, env: Env): Promise<string | Response> {
  // 1. Fail closed: dev-admin requires BOTH an explicit opt-in and a non-empty allowlist,
  // in every environment (staging deploys often run without NODE_ENV=production).
  const allowedEmails = (env.DEV_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const optedIn = env.ALLOW_DEV_ADMIN === 'true'
  if (!optedIn || allowedEmails.length === 0) {
    return new Response('Not found', { status: 404 })
  }

  // 2. Require authentication
  const userId = await getSessionUserId(request, env)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  // 3. Get user email
  const userRow = (await env.DB
    .prepare('SELECT email FROM users WHERE id = ?1')
    .bind(userId)
    .first()) as { email: string } | null

  if (!userRow) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  // 4. Check allowlist
  if (!allowedEmails.includes(String(userRow.email ?? '').toLowerCase())) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  }

  // Return the authenticated user's ID if all checks pass
  return userId
}
