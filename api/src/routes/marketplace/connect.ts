import {getSessionUserId} from '../_auth'
import {applyRateLimit} from '../_security'
import {ConnectService} from '../../marketplace/connect-service'
import {MarketplaceError} from '../../marketplace/service'

type Context = {request: Request; env: any}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}})
}

/** Onboarding and dashboard links each create a Stripe object, so cap them per artist account. */
const LINK_REQUESTS_PER_WINDOW = 10
const LINK_WINDOW_SECONDS = 10 * 60

async function handle(
  context: Context,
  action: (service: ConnectService, userId: string) => Promise<unknown>,
  rateLimitKind?: string,
): Promise<Response> {
  try {
    const userId = await getSessionUserId(context.request, context.env)
    if (!userId) return json({ok: false, error: 'unauthorized', message: 'Login required'}, 401)
    const secretKey = String(context.env.STRIPE_SECRET_KEY || '').trim()
    if (!secretKey) return json({ok: false, error: 'stripe_not_configured'}, 503)
    if (rateLimitKind) {
      const limit = await applyRateLimit({
        db: context.env.DB, key: `user:${userId}`, purpose: 'stripe_connect', kind: rateLimitKind,
        maxPerWindow: LINK_REQUESTS_PER_WINDOW, windowSeconds: LINK_WINDOW_SECONDS, lockoutMs: LINK_WINDOW_SECONDS * 1000,
      })
      if (!limit.ok) return json({ok: false, error: 'rate_limited', message: 'Too many Stripe requests. Try again in a few minutes.'}, 429)
    }
    return json({ok: true, data: await action(new ConnectService(context.env.DB, secretKey), userId)})
  } catch (error) {
    if (error instanceof MarketplaceError) return json({ok: false, error: error.code, message: error.message}, error.status)
    // Stripe's raw error text can describe account internals; log it, show a generic message.
    console.error('[marketplace-connect] Request failed', error)
    return json({ok: false, error: 'connect_request_failed', message: 'Stripe could not complete this request. Try again shortly.'}, 502)
  }
}

export const getConnectStatus = (context: Context) => handle(context, (service, userId) => service.getStatus(userId))

export const createConnectOnboarding = (context: Context) => handle(context, async (service, userId) => {
  const origin = String(context.env.FRONTEND_URL || '').split(',')[0]?.trim()
  if (!origin) throw new MarketplaceError(500, 'frontend_url_missing', 'Frontend URL is not configured')
  return service.createOnboardingLink(userId, new URL(origin).origin)
}, 'onboarding_link')

export const createConnectDashboard = (context: Context) => handle(context, (service, userId) => service.createDashboardLink(userId), 'dashboard_link')