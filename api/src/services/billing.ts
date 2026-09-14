export type BillingCadence = 'monthly' | 'yearly'

export type SubscriptionState = {
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  cadence: BillingCadence | null
}

export function subscriptionGrantsPro(status: string): boolean {
  return status === 'active' || status === 'trialing'
}

export function stripeTimestampToIso(timestamp: unknown): string | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null
  return new Date(timestamp * 1000).toISOString()
}

export function cadenceFromPrice(priceId: unknown, monthlyPriceId: string, yearlyPriceId: string): BillingCadence | null {
  if (priceId === monthlyPriceId) return 'monthly'
  if (priceId === yearlyPriceId) return 'yearly'
  return null
}

export async function persistSubscriptionState(args: {
  db: any
  userId: string
  customerId: string | null
  subscriptionId: string | null
  state: SubscriptionState
  eventCreatedAt: string
}): Promise<void> {
  const {db, userId, customerId, subscriptionId, state, eventCreatedAt} = args
  const grantsPro = subscriptionGrantsPro(state.status)

  await db
    .prepare(
      [
        'INSERT INTO entitlements',
        '(user_id, access_type, has_full_access, stripe_customer_id, stripe_subscription_id, subscription_status, billing_cadence, cancel_at_period_end, current_period_end, stripe_event_created_at, updated_at)',
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, CURRENT_TIMESTAMP)',
        'ON CONFLICT(user_id) DO UPDATE SET',
        "access_type=CASE WHEN entitlements.access_type IN ('full', 'full_program') THEN entitlements.access_type ELSE excluded.access_type END,",
        "has_full_access=CASE WHEN entitlements.access_type IN ('full', 'full_program') THEN entitlements.has_full_access ELSE excluded.has_full_access END,",
        'stripe_customer_id=COALESCE(excluded.stripe_customer_id, entitlements.stripe_customer_id),',
        'stripe_subscription_id=excluded.stripe_subscription_id,',
        'subscription_status=excluded.subscription_status,',
        'billing_cadence=excluded.billing_cadence,',
        'cancel_at_period_end=excluded.cancel_at_period_end,',
        'current_period_end=excluded.current_period_end,',
        'stripe_event_created_at=excluded.stripe_event_created_at,',
        'updated_at=excluded.updated_at',
        'WHERE entitlements.stripe_event_created_at IS NULL OR entitlements.stripe_event_created_at <= excluded.stripe_event_created_at',
      ].join(' '),
    )
    .bind(
      userId,
      grantsPro ? 'pro' : 'free',
      grantsPro ? 1 : 0,
      customerId,
      subscriptionId,
      state.status,
      state.cadence,
      state.cancelAtPeriodEnd,
      state.currentPeriodEnd,
      eventCreatedAt,
    )
    .run()
}