import {usePlanStore, type Plan} from '@/stores/planStore'

// NOTE: Only `startCheckout` + `getCheckoutStatus` are used by the app.

export type CheckoutStatus = {
  accessType: 'free' | 'pro' | 'full_program'
  hasFullAccess: boolean
  stripeCustomerId?: string
  stripeSubscriptionId?: string
}

const CHECKOUT_TOKEN_KEY = 'mejay:checkoutToken'

function getOrCreateCheckoutToken(): string {
  try {
    const existing = localStorage.getItem(CHECKOUT_TOKEN_KEY)
    if (existing && existing.trim()) return existing
  } catch {
    // ignore
  }

  // 128-bit random token, base64url-ish.
  let token = ''
  try {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    token = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  try {
    localStorage.setItem(CHECKOUT_TOKEN_KEY, token)
  } catch {
    // ignore
  }

  return token
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

export async function startCheckout(plan: 'pro' | 'full_program', intent?: 'trial' | 'upgrade') {
  const fullProgramCheckoutEnabled = String(import.meta.env.VITE_ENABLE_FULL_PROGRAM_CHECKOUT || '').toLowerCase() === 'true'
  if (plan === 'full_program' && !fullProgramCheckoutEnabled) {
    throw new Error('Full Program is coming soon.')
  }

  const {billingEnabled, setDevPlan, authBypassEnabled, refreshFromServer} = usePlanStore.getState()
  if (!billingEnabled) {
    setDevPlan(plan)
    return
  }

  if (authBypassEnabled) {
    throw new Error('Checkout is disabled while Login Bypass is enabled. Disable bypass and sign in to upgrade.')
  }

  const checkoutToken = getOrCreateCheckoutToken()

  const res = await fetch('/api/checkout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan, checkoutToken, intent: intent ?? 'upgrade' }),
  })

  if (res.status === 401) {
    void refreshFromServer({reason: 'startCheckout:401'}).catch(() => {})
    throw new Error('Login required to start checkout. Please sign in and try again.')
  }

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

  let checkoutToken: string | null = null
  try {
    checkoutToken = localStorage.getItem(CHECKOUT_TOKEN_KEY)
  } catch {
    checkoutToken = null
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'accept': 'application/json',
      ...(checkoutToken ? { 'x-checkout-token': checkoutToken } : {}),
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

  return {
    accessType: data.accessType as CheckoutStatus['accessType'],
    hasFullAccess: data.hasFullAccess,
    ...(typeof data.stripeCustomerId === 'string' ? {stripeCustomerId: data.stripeCustomerId} : {}),
    ...(typeof data.stripeSubscriptionId === 'string' ? {stripeSubscriptionId: data.stripeSubscriptionId} : {}),
  }
}

export async function openBillingPortal() {
  const {billingEnabled, authBypassEnabled, refreshFromServer} = usePlanStore.getState()
  if (!billingEnabled) {
    throw new Error('Billing disabled (dev).')
  }

  if (authBypassEnabled) {
    throw new Error('Manage billing is disabled while Login Bypass is enabled. Disable bypass and sign in to manage billing.')
  }

  const res = await fetch('/api/billing-portal', {
    method: 'POST',
    credentials: 'include',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({}),
  })

  if (res.status === 401) {
    void refreshFromServer({reason: 'openBillingPortal:401'}).catch(() => {})
    throw new Error('Login required to manage billing. Please sign in and try again.')
  }

  if (!res.ok) {
    let details = ''
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const data = (await res
        .clone()
        .json()
        .catch(() => null)) as null | {error?: unknown; message?: unknown}
      const msg =
        typeof data?.message === 'string'
          ? data.message
          : typeof data?.error === 'string'
            ? data.error
            : ''
      details = msg
    }
    if (!details) details = await res.text().catch(() => '')
    throw new Error(`Billing portal failed (${res.status}). ${details}`.trim())
  }

  const data = (await res.json()) as {url?: string}
  if (!data.url) throw new Error('Billing portal failed: missing url')

  window.location.href = data.url
}
