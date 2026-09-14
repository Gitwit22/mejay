import {Link, useNavigate} from 'react-router-dom'

import {getProviderStatusLabel} from '@/lib/marketplace'
import {usePlanStore} from '@/stores/planStore'

const modules = [
  'Provider profile and team access',
  'Artist profiles',
  'Release and track catalog',
  'Rights declarations',
  'Pricing and split setup',
  'Sales, earnings, payouts, and reporting',
]

export default function ProviderPortalPage() {
  const navigate = useNavigate()
  const authStatus = usePlanStore((s) => s.authStatus)
  const isGuestMode = usePlanStore((s) => s.isGuestMode)
  const providerProfile = usePlanStore((s) => s.providerProfile)

  if (authStatus !== 'authenticated') {
    return (
      <div className="mejay-pricing">
        <div className="bg-gradient gradient-1" aria-hidden="true" />
        <main className="main-content">
          <section className="hero">
            <h1>Artist Portal</h1>
            <p className="hero-subtitle">
              {isGuestMode
                ? 'You are browsing in guest mode. Create an account and subscribe to Pro to become an Artist.'
                : 'Sign in or create an account to manage Artist publishing, onboarding, and payouts.'}
            </p>
          </section>
          <div className="pricing-grid">
            <div className="pricing-card current">
              <div style={{display: 'grid', gap: '0.75rem'}}>
                <button
                  type="button"
                  className="plan-cta"
                  onClick={() => navigate('/login?intent=signup&accountIntent=provider&returnTo=/app/artist/onboarding')}
                >
                  Become an Artist
                </button>
                <button type="button" className="plan-cta secondary" onClick={() => navigate('/login?returnTo=/app/artist')}>
                  Sign in
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="mejay-pricing">
      <div className="bg-gradient gradient-1" aria-hidden="true" />
      <div className="bg-gradient gradient-2" aria-hidden="true" />
      <main className="main-content">
        <section className="hero">
          <h1>Artist Portal</h1>
          <p className="hero-subtitle">Manage your Artist profile, catalog, rights, pricing, payouts, and reporting.</p>
        </section>

        <div className="pricing-grid">
          <div className="pricing-card current">
            <span className="plan-badge current">Artist status</span>
            <div className="plan-name">{getProviderStatusLabel(providerProfile?.status ?? null)}</div>
            <div className="plan-description">
              {providerProfile
                ? `Current role: ${providerProfile.role}.`
                : 'No provider profile was found for this account yet.'}
            </div>
            <ul className="plan-features">
              {modules.map((module) => (
                <li key={module}>{module}</li>
              ))}
            </ul>
            <div className="license-note" role="note">
              <div className="license-note-title">Next workflow</div>
              <div className="license-note-text">
                {providerProfile?.status === 'approved'
                  ? 'This account is ready for provider dashboard implementation.'
                  : 'Finish onboarding and admin review before publishing becomes available.'}
              </div>
            </div>
            <div style={{marginTop: '1.25rem', display: 'grid', gap: '0.75rem'}}>
              <Link to="/app/artist/onboarding" className="plan-cta secondary" style={{display: 'inline-flex', justifyContent: 'center', textDecoration: 'none'}}>
                Open Artist onboarding
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
