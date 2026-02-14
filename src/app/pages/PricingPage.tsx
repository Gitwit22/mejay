import {useEffect, useState} from 'react'
import {Link, useLocation, useNavigate} from 'react-router-dom'

import {toast} from '@/hooks/use-toast'
import {startCheckout} from '@/lib/checkout'
import {usePlanStore} from '@/stores/planStore'
import { MEJAY_LOGO_URL } from '@/lib/branding'
import {navigateBackToPartyMode} from '@/app/navigation/settingsReturnTo'

type PricingPageProps = {
  mode?: 'public' | 'app'
}

export default function PricingPage({ mode = 'app' }: PricingPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [isCheckingOut, setIsCheckingOut] = useState<'pro' | 'full_program' | null>(null)
  const [cadence, setCadence] = useState<'monthly' | 'yearly'>('monthly')
  const fullProgramCheckoutEnabled = String(import.meta.env.VITE_ENABLE_FULL_PROGRAM_CHECKOUT || '').toLowerCase() === 'true'
  const billingEnabled = usePlanStore((s) => s.billingEnabled)
  const setDevPlan = usePlanStore((s) => s.setDevPlan)
  const authBypassEnabled = usePlanStore((s) => s.authBypassEnabled)
  const authStatus = usePlanStore((s) => s.authStatus)
  const plan = usePlanStore((s) => s.plan)

  const currentPlanId = authStatus === 'authenticated' ? plan : null
  const hasFullProgram = currentPlanId === 'full_program'
  const isFullProgramComingSoon = currentPlanId !== 'full_program' && !fullProgramCheckoutEnabled

  const handleBack = () => {
    if (mode === 'public') {
      navigate('/')
    } else {
      navigateBackToPartyMode(navigate, location.state)
    }
  }

  const contactPath = mode === 'public' ? '/contact' : '/app/settings/contact'

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const handleCheckout = async (plan: 'pro' | 'full_program', intent?: 'trial' | 'upgrade') => {
    if (plan === 'full_program' && !fullProgramCheckoutEnabled) {
      toast({title: 'Coming soon', description: 'Full Program is not available yet.'})
      return
    }
    if (!billingEnabled) {
      setDevPlan(plan === 'pro' ? 'pro' : 'full_program')
      toast({title: 'Billing disabled (dev)', description: 'Unlocked locally.'})
      return
    }

    if (authBypassEnabled) {
      toast({
        title: 'Login bypass is enabled',
        description: 'Disable bypass and sign in to use checkout.',
        variant: 'destructive',
      })
      return
    }
    try {
      setIsCheckingOut(plan)
      await startCheckout(plan, intent, cadence)
    } catch (e) {
      toast({
        title: 'Checkout unavailable',
        description: e instanceof Error ? e.message : 'Could not start checkout right now.',
        variant: 'destructive',
      })
    } finally {
      setIsCheckingOut(null)
    }
  }

  return (
    <div className="mejay-pricing">
      <div className="bg-gradient gradient-1" aria-hidden="true" />
      <div className="bg-gradient gradient-2" aria-hidden="true" />

      <header className="header">
        <div className="header-content">
          <Link to="/" className="logo-link" aria-label="MEJay home">
            <div className="logo-small" aria-hidden="true">
              <img className="site-logo" src={MEJAY_LOGO_URL} alt="MEJay" />
            </div>
            <span className="logo-text">MEJay</span>
          </Link>

          <button type="button" className="back-link" onClick={handleBack}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="hero">
          <h1>Choose Your Plan</h1>
          <p className="hero-subtitle">Start free, upgrade when you're ready. Pro is monthly. Full Program is coming soon.</p>
        </section>

        <div style={{display: 'flex', justifyContent: 'center', marginBottom: '2rem'}}>
          <div style={{
            display: 'inline-flex',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            padding: '4px',
            gap: '4px'
          }}>
            <button
              type="button"
              onClick={() => setCadence('monthly')}
              style={{
                padding: '0.5rem 1.5rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: cadence === 'monthly' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                color: cadence === 'monthly' ? '#fff' : 'rgba(255, 255, 255, 0.6)',
                fontWeight: cadence === 'monthly' ? '600' : '400',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                fontSize: '0.95rem'
              }}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCadence('yearly')}
              style={{
                padding: '0.5rem 1.5rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: cadence === 'yearly' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                color: cadence === 'yearly' ? '#fff' : 'rgba(255, 255, 255, 0.6)',
                fontWeight: cadence === 'yearly' ? '600' : '400',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                fontSize: '0.95rem'
              }}
            >
              Yearly
              <span style={{
                marginLeft: '0.5rem',
                padding: '0.125rem 0.375rem',
                backgroundColor: 'rgba(34, 197, 94, 0.2)',
                color: '#22c55e',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: '600'
              }}>Save 17%</span>
            </button>
          </div>
        </div>

        <div className="pricing-grid">
          <div className={`pricing-card${currentPlanId === 'free' ? ' current' : ''}`}>
            {currentPlanId === 'free' ? <span className="plan-badge current">Current plan</span> : null}
            <div className="plan-name">Free (Demo)</div>
            <div className="plan-description">Test MEJay in your browser</div>
            <div className="plan-price">
              <span className="price-amount">$0</span>
            </div>
            <ul className="plan-features">
              <li>Play and test MEJay in browser</li>
              <li>Limited sessions</li>
              <li>Import your own music</li>
              <li>Basic playback features</li>
            </ul>
            {currentPlanId === 'free' ? (
              <button type="button" className="plan-cta secondary" disabled>
                You're on this plan
              </button>
            ) : (
              <Link to="/app" className="plan-cta secondary">
                Try MEJay Free
              </Link>
            )}
          </div>

          <div className={`pricing-card featured${currentPlanId === 'pro' ? ' current' : ''}`}>
            {currentPlanId === 'pro' ? <span className="plan-badge current">Current plan</span> : <span className="plan-badge">Most Popular</span>}
            <div className="plan-name">
              Early Access Pro – Limited Time
              <span className="plan-badge" style={{marginLeft: '0.5rem', verticalAlign: 'middle'}}>
                Founders Rate
              </span>
            </div>
            <div className="plan-description">Advanced features while you subscribe</div>
            <div className="plan-price">
              <span className="price-amount">${cadence === 'yearly' ? '50' : '5'}</span>
              <span className="price-period">/{cadence === 'yearly' ? 'year' : 'month'}</span>
            </div>
            <div className="plan-description" style={{marginTop: '-0.5rem'}}>
              Lock in this price before public release.
            </div>
            <ul className="plan-features">
              <li>All Pro DJ features unlocked</li>
              <li>Auto volume matching</li>
              <li>Smooth transitions & advanced timing</li>
              <li>Tempo control + BPM tools</li>
            </ul>
            {currentPlanId === 'pro' || hasFullProgram ? (
              <button
                type="button"
                className="plan-cta"
                disabled
              >
                You're already upgraded
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="plan-cta"
                  onClick={() => handleCheckout('pro', 'trial')}
                  disabled={isCheckingOut !== null}
                >
                  {isCheckingOut === 'pro' ? 'Starting checkout…' : 'Start 3-Day Pro Trial'}
                </button>
                <p className="plan-description" style={{fontSize: '0.875rem', marginTop: '0.5rem'}}>
                  Then ${cadence === 'yearly' ? '$50/year' : '$5/month'}. Cancel anytime.
                </p>
              </>
            )}
          </div>

          <div className={`pricing-card${currentPlanId === 'full_program' ? ' current' : ''}${isFullProgramComingSoon ? ' coming-soon' : ''}`}>
            {isFullProgramComingSoon ? <span className="coming-soon-badge">Coming soon</span> : null}
            {currentPlanId === 'full_program' ? <span className="plan-badge current">Current plan</span> : null}
            <div className="plan-name">Full Program</div>
            <div className="plan-description">One-time purchase, own it forever</div>
            <div className="plan-price">
              <span className="price-amount">$199</span>
              <span className="price-period">one-time</span>
            </div>
            <ul className="plan-features">
              <li>Everything in Pro</li>
              <li>Keep access forever</li>
              <li>Best for long-term use</li>
            </ul>
            <button
              type="button"
              className="plan-cta secondary"
              onClick={() => handleCheckout('full_program')}
              disabled={currentPlanId === 'full_program' || !fullProgramCheckoutEnabled || isCheckingOut !== null}
            >
              {currentPlanId === 'full_program'
                ? "You're on this plan"
                : !fullProgramCheckoutEnabled
                  ? 'Coming soon'
                : isCheckingOut === 'full_program'
                  ? 'Starting checkout…'
                  : 'Buy Full Program'}
            </button>
          </div>
        </div>

        <div className="license-note" role="note">
          <div className="license-note-title">Need help?</div>
          <div className="license-note-text">
            If checkout fails or you have questions,{' '}
            <Link className="license-note-link" to={contactPath}>
              contact support
            </Link>
            .
          </div>
        </div>

        <div style={{marginTop: '2rem', textAlign: 'center', fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)'}}>
          <div>© 2025 Nxt Lvl Technology Solutions</div>
          <div>MEJay™ is a trademark of Nxt Lvl Technology Solutions. All rights reserved.</div>
        </div>
      </main>
    </div>
  )
}
