import {getSessionUserId, type EnvWithDb} from '../_auth'
import {estimateSale, resolvePlatformFeeBps} from '../../marketplace/commerce-money'
import {MINIMUM_RELEASE_PRICE_MINOR} from '../../marketplace/sale-policy'

type Context = {request: Request; env: EnvWithDb & {MARKETPLACE_PLATFORM_FEE_BPS?: string}}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}})
}

/**
 * GET /api/marketplace/pricing-policy?amountMinor=300
 * The marketplace sale policy plus an optional per-sale estimate, computed by the same calculator
 * fulfillment uses, so the artist price screen never carries its own copy of the fee model.
 */
export async function getPricingPolicy(context: Context): Promise<Response> {
  const userId = await getSessionUserId(context.request, context.env)
  if (!userId) return json({ok: false, error: 'unauthorized', message: 'Login required'}, 401)
  let platformFeeBps: number
  try {
    platformFeeBps = resolvePlatformFeeBps(context.env)
  } catch (error) {
    console.error('[marketplace-pricing] Invalid platform fee configuration', error)
    return json({ok: false, error: 'platform_fee_invalid', message: 'Marketplace pricing is not configured'}, 500)
  }
  const rawAmount = new URL(context.request.url).searchParams.get('amountMinor')?.trim() ?? ''
  let estimate = null
  if (rawAmount) {
    const amountMinor = Number(rawAmount)
    if (!/^\d+$/.test(rawAmount) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > 100_000_00) {
      return json({ok: false, error: 'invalid_amount', message: 'amountMinor must be a positive whole number of cents'}, 400)
    }
    estimate = estimateSale(amountMinor, platformFeeBps)
  }
  return json({
    ok: true,
    data: {currency: 'USD', minimumPriceMinor: MINIMUM_RELEASE_PRICE_MINOR, platformFeeBps, estimate},
  })
}
