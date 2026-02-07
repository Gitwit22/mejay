import {usePlanStore, type Plan} from '@/stores/planStore'

// NOTE: Only `startCheckout` + `getCheckoutStatus` are used by the app.

export type CheckoutStatus = {
  accessType: 'free' | 'pro' | 'full_program'
  hasFullAccess: boolean
}

export class CheckoutStatusError extends Error {
  status: number
  bodyText?: string
  constructor(message: string, status: number, bodyText?: string) {
    super(message)
    this.name = 'CheckoutStatusError'
    this.status = status
    this.bodyText = bodyText
  }
}

export async function startCheckout(plan: 'pro' | 'full_program') {
  const {billingEnabled, setDevPlan} = usePlanStore.getState()
  if (!billingEnabled) {
    setDevPlan(plan)
    return
  }

  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan }),
  })

  if (!res.ok) {
    let details = ''
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const data = (await res
        .clone()
        .json()
        .catch(() => null)) as null | {error?: unknown; message?: unknown}
      const msg =
        typeof data?.error === 'string'
          ? data.error
          : typeof data?.message === 'string'
            ? data.message
            : ''
      details = msg
    }
    if (!details) details = await res.text().catch(() => '')

    throw new Error(`Checkout failed (${res.status}). ${details}`.trim())
  }

  const data = (await res.json()) as { url?: string }
  if (!data.url) throw new Error('Checkout failed: missing url')

  window.location.href = data.url
}

export async function getCheckoutStatus(sessionId: string): Promise<CheckoutStatus> {
  const url = new URL('/api/checkout-status', window.location.origin)
  url.searchParams.set('session_id', sessionId)

  const res = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'accept': 'application/json',
    },
  })

  const contentType = res.headers.get('content-type') ?? ''
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = text || `Status check failed (${res.status})`
    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(text) as {error?: unknown; message?: unknown}
        const parsedMessage =
          typeof parsed?.message === 'string'
            ? parsed.message
            : typeof parsed?.error === 'string'
              ? parsed.error
              : ''
        if (parsedMessage) message = parsedMessage
      } catch {
        // ignore
      }
    }
    throw new CheckoutStatusError(message, res.status, text)
  }

  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Status check failed: non-JSON response')
  }

  const data = (await res.json()) as Partial<CheckoutStatus>
  if (!data.accessType) throw new Error('Status check failed: missing accessType')
  if (typeof data.hasFullAccess !== 'boolean') throw new Error('Status check failed: missing hasFullAccess')

  return {accessType: data.accessType as CheckoutStatus['accessType'], hasFullAccess: data.hasFullAccess}
}
