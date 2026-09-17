export class StripeRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message)
  }
}

export async function stripeRequest<T>(args: {
  secretKey: string
  method?: 'GET' | 'POST'
  path: string
  params?: URLSearchParams
  idempotencyKey?: string
}): Promise<T> {
  const method = args.method ?? 'GET'
  const query = method === 'GET' && args.params?.size ? `?${args.params.toString()}` : ''
  const response = await fetch(`https://api.stripe.com${args.path}${query}`, {
    method,
    headers: {
      authorization: `Bearer ${args.secretKey}`,
      ...(method === 'POST' ? {'content-type': 'application/x-www-form-urlencoded'} : {}),
      ...(args.idempotencyKey ? {'idempotency-key': args.idempotencyKey} : {}),
    },
    body: method === 'POST' ? args.params : undefined,
  })
  const text = await response.text()
  let payload: any = null
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }
  if (!response.ok) {
    throw new StripeRequestError(
      response.status,
      typeof payload?.error?.message === 'string' ? payload.error.message : text.slice(0, 500) || 'Stripe request failed',
      typeof payload?.error?.code === 'string' ? payload.error.code : undefined,
    )
  }
  return payload as T
}