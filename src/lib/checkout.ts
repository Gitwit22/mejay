import type {Plan} from '@/stores/planStore'

// NOTE: Only `startCheckout` + `getCheckoutStatus` are used by the app.

export type CheckoutStatus = {
  accessType: 'free' | 'pro' | 'full_program'
  hasFullAccess: boolean
}

export async function startCheckout(plan: 'pro' | 'full_program') {
  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan }),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Checkout failed (${res.status}). ${txt}`)
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
    headers: {
      'accept': 'application/json',
    },
  })

  const contentType = res.headers.get('content-type') ?? ''
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Status check failed (${res.status})`)
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
