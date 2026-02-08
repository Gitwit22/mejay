type D1Database = any

export type EnvWithDb = {
  DB: D1Database
  AUTH_CODE_PEPPER?: string
  SESSION_PEPPER?: string
}

export type AccessType = 'free' | 'pro' | 'full_program'

export const CODE_TTL_MS = 10 * 60 * 1000
export const MAX_ATTEMPTS = 5
export const LOCKOUT_MS = 15 * 60 * 1000
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function random6DigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input)
  const hashBuf = await crypto.subtle.digest('SHA-256', enc)
  return [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function nowIso() {
  return new Date().toISOString()
}

export function addMsIso(ms: number) {
  return new Date(Date.now() + ms).toISOString()
}

export function parseCookies(req: Request) {
  const raw = req.headers.get('cookie') || ''
  const out: Record<string, string> = {}
  raw.split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=')
    if (!k) return
    out[k] = decodeURIComponent(v.join('=') || '')
  })
  return out
}

export function cookieHeaderForLogout(isSecure: boolean): string {
  return [
    `mejay_session=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isSecure ? 'Secure' : '',
    'Max-Age=0',
  ]
    .filter(Boolean)
    .join('; ')
}

export function makeSessionCookie(token: string, opts: {secure: boolean; maxAgeSeconds: number}): string {
  return [
    `mejay_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    opts.secure ? 'Secure' : '',
    `Max-Age=${Math.floor(opts.maxAgeSeconds)}`,
  ]
    .filter(Boolean)
    .join('; ')
}

export function normalizeAccessType(raw: unknown): AccessType {
  if (raw === 'pro') return 'pro'
  if (raw === 'full') return 'full_program'
  if (raw === 'full_program') return 'full_program'
  return 'free'
}

export function toDbAccessType(accessType: AccessType): 'free' | 'pro' | 'full' {
  if (accessType === 'pro') return 'pro'
  if (accessType === 'full_program') return 'full'
  return 'free'
}

export async function readJson(req: Request) {
  return req.json().catch(() => ({}))
}

export async function getSessionUserId(req: Request, env: EnvWithDb): Promise<string | null> {
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
  if (row.expires_at < nowIso()) return null
  return row.user_id
}

export async function requireSessionUserId(request: Request, env: EnvWithDb): Promise<string | null> {
  return getSessionUserId(request, env)
}

export async function deleteSession(req: Request, env: EnvWithDb): Promise<void> {
  const cookies = parseCookies(req)
  const token = cookies['mejay_session']
  if (!token) return
  const pepper = env.SESSION_PEPPER || 'dev-session-pepper'
  const sessionHash = await sha256Hex(`session:${token}:${pepper}`)
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(sessionHash).run()
}

export async function ensureUserIdForEmail(args: {db: D1Database; userId: string; email: string | null}) {
  const {db, userId, email} = args

  // If user already exists by id, we're good.
  const byId = (await db
    .prepare('SELECT id FROM users WHERE id = ?1')
    .bind(userId)
    .first()) as {id: string} | null
  if (byId?.id) return userId

  // If email exists, reuse that user id to satisfy UNIQUE(email) + FK(user_id).
  if (email) {
    const byEmail = (await db
      .prepare('SELECT id FROM users WHERE email = ?1')
      .bind(email)
      .first()) as {id: string} | null
    if (byEmail?.id) return byEmail.id
  }

  // Otherwise create the user.
  await db.prepare('INSERT INTO users (id, email) VALUES (?1, ?2)')
    .bind(userId, email ?? `unknown+${userId}@example.invalid`)
    .run()

  return userId
}
