/**
 * Dev Admin: List Users
 * GET /api/dev-admin/users
 */

import { requireDevAdmin } from './_guard'

type Env = {
  DB: any
  SESSION_PEPPER?: string
  NODE_ENV?: string
  ALLOW_DEV_ADMIN?: string
  DEV_ADMIN_EMAILS?: string
}

export const onRequest = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx

  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Check dev admin authorization
  const authResult = await requireDevAdmin(request, env)
  if (authResult instanceof Response) {
    return authResult
  }

  try {
    // Fetch all users with basic info (limit to 500 for safety)
    const { results } = await env.DB.prepare(`
      SELECT 
        u.id,
        u.email,
        u.created_at,
        e.access_type,
        e.has_full_access
      FROM users u
      LEFT JOIN entitlements e ON u.id = e.user_id
      ORDER BY u.created_at DESC
      LIMIT 500
    `).all()

    return new Response(JSON.stringify(results || []), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    console.error('Dev admin list users error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch users', details: String(error) }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }
    )
  }
}
