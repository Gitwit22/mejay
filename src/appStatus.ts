export type PlanLabel = 'Free (Demo)' | 'Licensed' | 'Subscription'

export const appStatus = {
  plan: 'Free (Demo)' as PlanLabel,
  deviceActivated: false,
  version: 'v0.1.0',

  // License placeholders
  licenseStatus: 'Free (Demo)',
  installsUsed: 0,
  installsTotal: 3,

  // Support placeholder
  supportEmail: 'support@mejay.app',
}

export const getDeviceStatusLabel = () => (appStatus.deviceActivated ? 'Activated on this device' : 'Not activated')
