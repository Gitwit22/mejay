import {Link} from 'react-router-dom'

import {getProviderStatusLabel} from '@/lib/marketplace'
import {usePlanStore} from '@/stores/planStore'

const steps = [
  'Provider profile and business identity',
  'Artist profile setup',
  'Rights declarations and certifications',
  'ISRC / UPC metadata readiness',
  'Pricing tiers and revenue splits',
  'Admin review before anything goes live',
]

export default function ProviderOnboardingPage() {
  const providerProfile = usePlanStore((s) => s.providerProfile)

  return (
    <div className="mejay-pricing">
      <div className="bg-gradient gradient-1" aria-hidden="true" />
      <div className="bg-gradient gradient-2" aria-hidden="true" />
      <main className="main-content">
        <section className="hero">
          <h1>Artist Onboarding</h1>
          <p className="hero-subtitle">Complete your Artist identity, rights, catalog, pricing, and payout setup.</p>
        </section>

        <div className="pricing-grid">
          <div className="pricing-card current">
            <span className="plan-badge current">Application flow</span>
            <div className="plan-name">{getProviderStatusLabel(providerProfile?.status ?? null)}</div>
            <ul className="plan-features">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            <div className="license-note" role="note">
              <div className="license-note-title">Launch rule</div>
              <div className="license-note-text">Provider signup creates an application path. Uploading and selling stay locked until onboarding is complete and admin approval is granted.</div>
            </div>
            <div style={{marginTop: '1.25rem'}}>
              <Link to="/app/artist" className="plan-cta secondary" style={{display: 'inline-flex', justifyContent: 'center', textDecoration: 'none'}}>
                Back to Artist Portal
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
