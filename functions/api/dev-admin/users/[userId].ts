/**
 * Dev Admin: Delete User
 * DELETE /api/dev-admin/users/[userId]
 *
 * Performs cascading delete in correct order to avoid foreign key constraints:
 * 1. Sessions (references user_id)
 * 2. Entitlements (references user_id)
 * 3. Email codes (references email)
 * 4. Auth codes (references email)
 * 5. User record
 *
 * Uses D1 transaction for atomic operation.
 */

import { requireDevAdmin } from '../_guard'

type Env = {
  DB: any
  SESSION_PEPPER?: string
  NODE_ENV?: string
  ALLOW_DEV_ADMIN?: string
  DEV_ADMIN_EMAILS?: string
}

export const onRequest = async (ctx: { request: Request; env: Env; params: { userId: string } }): Promise<Response> => {
  const { request, env, params } = ctx

  if (request.method !== 'DELETE') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Check dev admin authorization
  const authResult = await requireDevAdmin(request, env)
  if (authResult instanceof Response) {
    return authResult
  }

  const userId = params.userId

  if (!userId) {
    return new Response(JSON.stringify({ ok: false, error: 'User ID required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    // First, get the user's email (needed for email_codes and auth_codes cleanup)
    const userRow = (await env.DB
      .prepare('SELECT email FROM users WHERE id = ?1')
      .bind(userId)
      .first()) as { email: string } | null

    if (!userRow) {
      return new Response(JSON.stringify({ ok: false, error: 'User not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }

    const userEmail = userRow.email

    // D1 supports batch operations - delete child records in order
    // Note: D1 doesn't have traditional transactions, but batch() executes atomically
    const deleteResult = await env.DB.batch([
      // 1. Delete sessions
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(userId),
      
      // 2. Delete entitlements
      env.DB.prepare('DELETE FROM entitlements WHERE user_id = ?1').bind(userId),
      
      // 3. Delete email_codes (by email)
      env.DB.prepare('DELETE FROM email_codes WHERE email = ?1').bind(userEmail),
      
      // 4. Delete auth_codes (by email) - may not exist in newer schemas
      env.DB.prepare('DELETE FROM auth_codes WHERE email = ?1').bind(userEmail),
      
      // 5. Delete auth_ip_rates (cleanup, not blocking)
      // This table doesn't reference user directly, but cleanup is good
      
      // 6. Finally, delete the user
      env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(userId),
    ])

    // Check if user was actually deleted (last statement result)
    const userDeleteResult = deleteResult[deleteResult.length - 1]
    
    if (!userDeleteResult.success) {
      throw new Error('User deletion failed')
    }

    console.log(`✅ Dev admin deleted user: ${userId} (${userEmail})`)

    return new Response(
      JSON.stringify({
        ok: true,
        deletedUserId: userId,
        deletedEmail: userEmail,
      }),
      {
        headers: { 'content-type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Dev admin delete user error:', error)
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Failed to delete user',
        details: String(error),
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }
    )
  }
}
