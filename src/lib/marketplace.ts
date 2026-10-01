export type AccountIntent = 'consumer' | 'provider'

export type ProviderStatus =
  | 'pending_profile_completion'
  | 'pending_review'
  | 'approved'
  | 'needs_changes'
  | 'rejected'
  | 'suspended'

export type ProviderSummary = {
  id: string
  status: ProviderStatus
  role: string
}

export function parseAccountIntent(raw: unknown): AccountIntent {
  return raw === 'provider' ? 'provider' : 'consumer'
}

export function parseProviderStatus(raw: unknown): ProviderStatus | null {
  switch (raw) {
    case 'pending_profile_completion':
    case 'pending_review':
    case 'approved':
    case 'needs_changes':
    case 'rejected':
    case 'suspended':
      return raw
    default:
      return null
  }
}

export function getProviderEntryPath(provider: ProviderSummary | null): string {
  if (!provider) return '/app/artist/onboarding'
  return provider.status === 'approved' ? '/app/artist' : '/app/artist/onboarding'
}

export function getProviderStatusLabel(status: ProviderStatus | null): string {
  switch (status) {
    case 'pending_profile_completion':
      return 'Pending profile completion'
    case 'pending_review':
      return 'Pending review'
    case 'approved':
      return 'Approved'
    case 'needs_changes':
      return 'Needs changes'
    case 'rejected':
      return 'Rejected'
    case 'suspended':
      return 'Suspended'
    default:
      return 'Not started'
  }
}
