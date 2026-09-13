import type {RequestHandler} from 'express'

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isTrustedMutationOrigin(method: string, origin: string | undefined, allowedOrigins: Set<string>): boolean {
  if (safeMethods.has(method.toUpperCase())) return true
  return origin !== undefined && allowedOrigins.has(origin)
}

export function apiOriginGuard(frontendUrl: string, exemptPaths: string[] = []): RequestHandler {
  const allowedOrigins = new Set(frontendUrl.split(',').map((origin) => origin.trim()).filter(Boolean))
  const exemptions = new Set(exemptPaths)

  return (request, response, next) => {
    if (exemptions.has(request.path) || isTrustedMutationOrigin(request.method, request.get('origin'), allowedOrigins)) {
      next()
      return
    }

    response.status(403).json({ok: false, error: 'untrusted_origin'})
  }
}