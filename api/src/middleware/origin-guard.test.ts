import {describe, expect, it} from 'vitest'
import {isTrustedMutationOrigin} from './origin-guard'

const allowedOrigins = new Set(['https://mejay2.pages.dev', 'http://localhost:8080'])

describe('isTrustedMutationOrigin', () => {
  it('allows safe methods without an Origin header', () => {
    expect(isTrustedMutationOrigin('GET', undefined, allowedOrigins)).toBe(true)
    expect(isTrustedMutationOrigin('OPTIONS', undefined, allowedOrigins)).toBe(true)
  })

  it('allows a mutation from an exact configured origin', () => {
    expect(isTrustedMutationOrigin('POST', 'https://mejay2.pages.dev', allowedOrigins)).toBe(true)
  })

  it('rejects missing and lookalike mutation origins', () => {
    expect(isTrustedMutationOrigin('POST', undefined, allowedOrigins)).toBe(false)
    expect(isTrustedMutationOrigin('DELETE', 'https://mejay2.pages.dev.attacker.example', allowedOrigins)).toBe(false)
  })
})