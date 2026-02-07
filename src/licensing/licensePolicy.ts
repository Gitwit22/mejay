// Deprecated: legacy license system removed in favor of Stripe checkout.
export type LicensePolicyResult = {
  status: 'free'
}

export function evaluateLicensePolicy(): LicensePolicyResult {
  return {status: 'free'}
}

