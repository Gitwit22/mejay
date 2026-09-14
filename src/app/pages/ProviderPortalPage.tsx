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
  const providerProfile = usePlanStore((s) => s.providerProfile)

  if (authStatus !== 'authenticated') {
    return (
      <div className="mejay-pricing">
        <div className="bg-gradient gradient-1" aria-hidden="true" />
        <main className="main-content">
          <section className="hero">
            <h1>Provider Portal</h1>
            <p className="hero-subtitle">Sign in to manage provider onboarding, publishing, and payout setup.</p>
          </section>
          <div className="pricing-grid">
            <div className="pricing-card current">
              <button type="button" className="plan-cta" onClick={() => navigate('/login?returnTo=/app/provider')}>
                Sign in
              </button>
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
          <h1>Provider Portal</h1>
          <p className="hero-subtitle">The provider area is scaffolded around onboarding, catalog, rights, payouts, and reporting.</p>
        </section>

        <div className="pricing-grid">
          <div className="pricing-card current">
            <span className="plan-badge current">Provider status</span>
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
              <Link to="/app/provider/onboarding" className="plan-cta secondary" style={{display: 'inline-flex', justifyContent: 'center', textDecoration: 'none'}}>
                Open provider onboarding
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
