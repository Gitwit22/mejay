const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const base64UrlDecodeToBytes = (input: string): Uint8Array => {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const binary = atob(b64 + pad)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

const deriveKeyBytes = async (args: {password: string; salt: Uint8Array; iterations: number; lengthBytes: number}) => {
  const {password, salt, iterations, lengthBytes} = args
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt.buffer as ArrayBuffer,
      iterations,
    },
    keyMaterial,
    lengthBytes * 8,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  // Cloudflare Workers CPU time is limited; keep PBKDF2 iterations conservative.
  // Verification reads iterations from stored hashes, so lowering here only affects NEW hashes.
  const iterations = 100_000
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const dk = await deriveKeyBytes({password, salt, iterations, lengthBytes: 32})
  return `pbkdf2_sha256$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(dk)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored || '').split('$')
  if (parts.length !== 4) return false
  const [scheme, iterStr, saltB64, dkB64] = parts
  if (scheme !== 'pbkdf2_sha256') return false

  const iterations = Number(iterStr)
  if (!Number.isFinite(iterations) || iterations <= 0) return false

  try {
    const salt = base64UrlDecodeToBytes(saltB64)
    const expected = base64UrlDecodeToBytes(dkB64)
    const actual = await deriveKeyBytes({password, salt, iterations, lengthBytes: expected.length})
    return constantTimeEqual(actual, expected)
  } catch {
    return false
  }
}
