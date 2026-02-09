type D1Database = any

export type EnvWithDb = {
  DB: D1Database
  AUTH_CODE_PEPPER?: string
  SESSION_PEPPER?: string
  /** Optional dedicated secret for verified token signing. Falls back to SESSION_PEPPER. */
  AUTH_TOKEN_SECRET?: string
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

export function nowMs() {
  return Date.now()
}

export function addMs(ms: number) {
  return Date.now() + ms
}

export function addMsIso(ms: number) {
  return new Date(Date.now() + ms).toISOString()
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecodeToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const binary = atob(b64 + pad)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function hmacSha256Bytes(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return new Uint8Array(sig)
}

export type VerifiedPurpose = 'signup_verify' | 'password_reset'

export type VerifiedTokenPayload = {
  email: string
  purpose: VerifiedPurpose
  exp: number
}

function getAuthTokenSecret(env: Pick<EnvWithDb, 'AUTH_TOKEN_SECRET' | 'SESSION_PEPPER'>): string {
  return (env.AUTH_TOKEN_SECRET || env.SESSION_PEPPER || 'dev-session-pepper').trim()
}

export async function signVerifiedToken(args: {
  env: Pick<EnvWithDb, 'AUTH_TOKEN_SECRET' | 'SESSION_PEPPER'>
  email: string
  purpose: VerifiedPurpose
  expMs: number
}): Promise<string> {
  const {env, email, purpose, expMs} = args
  const payload: VerifiedTokenPayload = {email: normalizeEmail(email), purpose, exp: expMs}
  const payloadJson = JSON.stringify(payload)
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(payloadJson))
  const secret = getAuthTokenSecret(env)
  const sigBytes = await hmacSha256Bytes(secret, payloadB64)
  const sigB64 = base64UrlEncode(sigBytes)
  return `${payloadB64}.${sigB64}`
}

export async function verifyVerifiedToken(args: {
  env: Pick<EnvWithDb, 'AUTH_TOKEN_SECRET' | 'SESSION_PEPPER'>
  token: string
  expectedPurpose?: VerifiedPurpose
}): Promise<{ok: true; payload: VerifiedTokenPayload} | {ok: false; error: 'invalid' | 'expired'}> {
  const {env, token, expectedPurpose} = args
  const trimmed = (token || '').trim()
  const parts = trimmed.split('.')
  if (parts.length !== 2) return {ok: false, error: 'invalid'}

  const [payloadB64, sigB64] = parts
  if (!payloadB64 || !sigB64) return {ok: false, error: 'invalid'}

  try {
    const secret = getAuthTokenSecret(env)
    const expectedSigBytes = await hmacSha256Bytes(secret, payloadB64)
    const expectedSigB64 = base64UrlEncode(expectedSigBytes)
    if (expectedSigB64 !== sigB64) return {ok: false, error: 'invalid'}

    const payloadBytes = base64UrlDecodeToBytes(payloadB64)
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as VerifiedTokenPayload
    if (!payload || typeof payload.email !== 'string' || typeof payload.purpose !== 'string' || typeof payload.exp !== 'number') {
      return {ok: false, error: 'invalid'}
    }

    if (expectedPurpose && payload.purpose !== expectedPurpose) return {ok: false, error: 'invalid'}
    if (payload.exp < nowMs()) return {ok: false, error: 'expired'}

    return {
      ok: true,
      payload: {
        email: normalizeEmail(payload.email),
        purpose: payload.purpose as VerifiedPurpose,
        exp: payload.exp,
      },
    }
  } catch {
    return {ok: false, error: 'invalid'}
  }
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
