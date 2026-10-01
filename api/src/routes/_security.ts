import {LOCKOUT_MS, addMsIso, nowIso} from './_auth'

/** Header set by adaptRoute from Express' trusted `req.ip`; any client-supplied value is overwritten. */
export const CLIENT_IP_HEADER = 'x-mejay-client-ip'

type DevEnv = {NODE_ENV?: string; ALLOW_DEV_ENDPOINTS?: string}

/**
 * Dev-only behavior (returning login codes, debug details) is gated on the deployment
 * environment only. Never derive this from the request host: Host / X-Forwarded-Host are
 * client-controlled.
 */
export function isDevEnvironment(env: DevEnv): boolean {
  return env.NODE_ENV !== 'production' || env.ALLOW_DEV_ENDPOINTS === 'true'
}

export function getClientIp(request: Request): string {
  return (request.headers.get(CLIENT_IP_HEADER) || '').trim() || 'unknown'
}

type RateLimitDb = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>
      run: () => Promise<unknown>
    }
  }
}

/**
 * Fixed-window limiter backed by auth_ip_rates. `key` is usually the client IP but may be any
 * stable identifier (e.g. `email:<address>`) to enforce per-account limits.
 */
export async function applyRateLimit(args: {
  db: RateLimitDb
  key: string
  purpose: string
  kind: string
  maxPerWindow: number
  windowSeconds?: number
  lockoutMs?: number
}): Promise<{ok: boolean}> {
  const {db, key, purpose, kind, maxPerWindow} = args
  const windowSeconds = args.windowSeconds ?? 10 * 60
  const lockoutMs = args.lockoutMs ?? LOCKOUT_MS
  const now = nowIso()

  const row = await db
    .prepare('SELECT window_start, count, locked_until FROM auth_ip_rates WHERE ip = ?1 AND purpose = ?2 AND kind = ?3')
    .bind(key, purpose, kind)
    .first<{window_start: string; count: number; locked_until: string | null}>()

  if (row?.locked_until && row.locked_until > now) return {ok: false}

  const shouldReset = row?.window_start ? Date.parse(now) - Date.parse(row.window_start) > windowSeconds * 1000 : true
  const nextWindowStart = shouldReset ? now : row!.window_start
  const nextCount = (shouldReset ? 0 : Number(row?.count ?? 0)) + 1
  const lockedUntil = nextCount > maxPerWindow ? addMsIso(lockoutMs) : null

  await db
    .prepare(
      [
        'INSERT INTO auth_ip_rates (ip, purpose, kind, window_start, count, locked_until)',
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
        'ON CONFLICT(ip, purpose, kind) DO UPDATE SET',
        'window_start=excluded.window_start,',
        'count=excluded.count,',
        'locked_until=excluded.locked_until',
      ].join(' '),
    )
    .bind(key, purpose, kind, nextWindowStart, nextCount, lockedUntil)
    .run()

  return {ok: !lockedUntil}
}
