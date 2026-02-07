export type LicensePlan = 'pro' | 'full_program'

export type LicenseTokenPayload = {
  v: 1
  deviceId: string
  plan: LicensePlan
  issuedAt: number
  expiresAt: number
}

export type LicenseTokenVerificationResult =
  | {ok: true; payload: LicenseTokenPayload}
  | {ok: false; reason: string}

const TOKEN_PREFIX = 'MEJAY1'

// NOTE: This is a demo/local-only signing secret so the app can verify tokens offline.
// A production system should verify via a server public key (asymmetric) or online checks.
const DEMO_HMAC_SECRET = 'mejay-demo-hmac-secret-v1'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function getHmacKey(): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    enc.encode(DEMO_HMAC_SECRET),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign', 'verify'],
  )
}

async function hmacSign(message: string): Promise<Uint8Array> {
  const key = await getHmacKey()
  const enc = new TextEncoder()
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return new Uint8Array(sig)
}

async function hmacVerify(message: string, signature: Uint8Array): Promise<boolean> {
  const key = await getHmacKey()
  const enc = new TextEncoder()
  return crypto.subtle.verify('HMAC', key, signature as unknown as BufferSource, enc.encode(message))
}

export async function createLicenseToken(payload: LicenseTokenPayload): Promise<string> {
  if (payload.v !== 1) throw new Error('Unsupported token version')

  const payloadJson = JSON.stringify(payload)
  const payloadB64 = toBase64Url(new TextEncoder().encode(payloadJson))
  const message = `${TOKEN_PREFIX}.${payloadB64}`
  const sig = await hmacSign(message)
  const sigB64 = toBase64Url(sig)
  return `${TOKEN_PREFIX}.${payloadB64}.${sigB64}`
}

export async function verifyAndDecodeLicenseToken(token: string): Promise<LicenseTokenVerificationResult> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return {ok: false, reason: 'Token format invalid'}
    const [prefix, payloadB64, sigB64] = parts
    if (prefix !== TOKEN_PREFIX) return {ok: false, reason: 'Token prefix invalid'}

    const message = `${prefix}.${payloadB64}`
    const signature = fromBase64Url(sigB64)
    const ok = await hmacVerify(message, signature)
    if (!ok) return {ok: false, reason: 'Token signature invalid'}

    const payloadBytes = fromBase64Url(payloadB64)
    const payloadJson = new TextDecoder().decode(payloadBytes)
    const payload = JSON.parse(payloadJson) as LicenseTokenPayload

    if (payload.v !== 1) return {ok: false, reason: 'Token version invalid'}
    if (!payload.deviceId || typeof payload.deviceId !== 'string') return {ok: false, reason: 'Token missing deviceId'}
    if (payload.plan !== 'pro' && payload.plan !== 'full_program') return {ok: false, reason: 'Token plan invalid'}
    if (typeof payload.issuedAt !== 'number' || typeof payload.expiresAt !== 'number') {
      return {ok: false, reason: 'Token timestamps invalid'}
    }

    return {ok: true, payload}
  } catch (e) {
    return {ok: false, reason: e instanceof Error ? e.message : 'Token decode failed'}
  }
}
