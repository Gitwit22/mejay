type Plan = 'pro' | 'full_program'

type Env = {
  STRIPE_SECRET_KEY: string
  STRIPE_PRICE_PRO: string
  STRIPE_PRICE_FULL_PROGRAM: string
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    },
  })

function getRequiredEnv(env: Partial<Env>, key: keyof Env): string {
  const value = env[key]
  if (!value) throw new Error(`Missing env var: ${key}`)
  return value
}

export const onRequestPost = async (context: {request: Request; env: Env}): Promise<Response> => {
  const {request, env} = context
  try {
    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      return json({error: 'Expected application/json'}, {status: 415})
    }

    const payload = (await request.json()) as {plan?: Plan}
    const plan = payload?.plan
    if (plan !== 'pro' && plan !== 'full_program') {
      return json({error: 'Invalid plan'}, {status: 400})
    }

    const secretKey = getRequiredEnv(env, 'STRIPE_SECRET_KEY')

    const priceId =
      plan === 'pro'
        ? getRequiredEnv(env, 'STRIPE_PRICE_PRO')
        : getRequiredEnv(env, 'STRIPE_PRICE_FULL_PROGRAM')

    const mode = plan === 'pro' ? 'subscription' : 'payment'

    const origin = new URL(request.url).origin
    const successUrl = `${origin}/?checkout=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${origin}/pricing?checkout=cancel`

    const params = new URLSearchParams()
    params.set('mode', mode)
    params.set('success_url', successUrl)
    params.set('cancel_url', cancelUrl)
    params.set('line_items[0][price]', priceId)
    params.set('line_items[0][quantity]', '1')

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const stripeText = await stripeRes.text()
    if (!stripeRes.ok) {
      // Avoid leaking secrets; Stripe response is safe but can be verbose.
      return json(
        {
          error: 'Stripe API error',
          status: stripeRes.status,
          details: stripeText.slice(0, 2000),
        },
        {status: 502},
      )
    }

    const session = JSON.parse(stripeText) as {url?: string}
    if (!session.url) {
      return json({error: 'Stripe session missing url'}, {status: 502})
    }

    return json({url: session.url})
  } catch (e) {
    return json(
      {
        error: 'Checkout failed',
        message: e instanceof Error ? e.message : 'Unknown error',
      },
      {status: 500},
    )
  }
}
