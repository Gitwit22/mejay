type Env = {
  STRIPE_SECRET_KEY: string
  STRIPE_PRICE_PRO: string
  STRIPE_PRICE_FULL_PROGRAM: string
}

type AccessType = 'free' | 'pro' | 'full_program'

type CheckoutStatusResponse = {
  accessType: AccessType
  hasFullAccess: boolean
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

async function stripeGet(secretKey: string, path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: {
      authorization: `Bearer ${secretKey}`,
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Stripe API error (${res.status}): ${text.slice(0, 500)}`)
  }
  return JSON.parse(text)
}

export const onRequestGet = async (context: {request: Request; env: Env}): Promise<Response> => {
  const {request, env} = context

  try {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('session_id') ?? ''

    if (!sessionId) {
      return json({error: 'Missing session_id'}, {status: 400})
    }

    const secretKey = getRequiredEnv(env, 'STRIPE_SECRET_KEY')
    const pricePro = getRequiredEnv(env, 'STRIPE_PRICE_PRO')
    const priceFull = getRequiredEnv(env, 'STRIPE_PRICE_FULL_PROGRAM')

    const session = await stripeGet(secretKey, `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items&expand[]=subscription`)

    const lineItems = session?.line_items?.data as Array<{price?: {id?: string}}> | undefined
    const priceId = lineItems?.[0]?.price?.id

    const accessType: AccessType = priceId === priceFull ? 'full_program' : priceId === pricePro ? 'pro' : 'free'

    if (accessType === 'free') {
      return json({accessType: 'free', hasFullAccess: false} satisfies CheckoutStatusResponse)
    }

    if (accessType === 'full_program') {
      const paid = session?.payment_status === 'paid'
      return json({accessType: paid ? 'full_program' : 'free', hasFullAccess: !!paid} satisfies CheckoutStatusResponse)
    }

    // pro subscription
    const sub = session?.subscription
    const status: string | undefined = sub?.status
    const active = status === 'active' || status === 'trialing'

    return json({accessType: active ? 'pro' : 'free', hasFullAccess: !!active} satisfies CheckoutStatusResponse)
  } catch (e) {
    return json(
      {
        error: 'Status check failed',
        message: e instanceof Error ? e.message : 'Unknown error',
      },
      {status: 500},
    )
  }
}
