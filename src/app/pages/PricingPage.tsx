import {useEffect, useState} from 'react'
import {Link} from 'react-router-dom'

import {toast} from '@/hooks/use-toast'
import {startCheckout} from '@/lib/checkout'
import {usePlanStore} from '@/stores/planStore'
import { MEJAY_LOGO_URL } from '@/lib/branding'

export default function PricingPage() {
  const [isCheckingOut, setIsCheckingOut] = useState<'pro' | 'full_program' | null>(null)
  const {billingEnabled, setDevPlan, authBypassEnabled} = usePlanStore()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const handleCheckout = async (plan: 'pro' | 'full_program') => {
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
      await startCheckout(plan)
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

          <Link to="/" className="back-link">
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
            Back to Home
          </Link>
        </div>
      </header>

      <main className="main-content">
        <section className="hero">
          <h1>Choose Your Plan</h1>
          <p className="hero-subtitle">Start free, upgrade when you're ready. Pro is monthly. Full Program is lifetime.</p>
        </section>

        <div className="pricing-grid">
          <div className="pricing-card">
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
            <Link to="/app" className="plan-cta secondary">
              Try MEJay Free
            </Link>
          </div>

          <div className="pricing-card featured">
            <span className="plan-badge">Most Popular</span>
            <div className="plan-name">MEJay Pro</div>
            <div className="plan-description">Advanced features while you subscribe</div>
            <div className="plan-price">
              <span className="price-amount">$5</span>
              <span className="price-period">/month</span>
            </div>
            <ul className="plan-features">
              <li>All Pro DJ features unlocked</li>
              <li>Auto volume matching</li>
              <li>Smooth transitions & advanced timing</li>
              <li>Tempo control + BPM tools</li>
            </ul>
            <button
              type="button"
              className="plan-cta"
              onClick={() => handleCheckout('pro')}
              disabled={isCheckingOut !== null}
            >
              {isCheckingOut === 'pro' ? 'Starting checkout…' : 'Upgrade to Pro'}
            </button>
          </div>

          <div className="pricing-card">
            <span className="plan-badge">Lifetime</span>
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
              disabled={isCheckingOut !== null}
            >
              {isCheckingOut === 'full_program' ? 'Starting checkout…' : 'Buy Full Program'}
            </button>
          </div>
        </div>

        <div className="license-note" role="note">
          <div className="license-note-title">Need help?</div>
          <div className="license-note-text">
            If checkout fails or you have questions,{' '}
            <Link className="license-note-link" to="/contact">
              contact support
            </Link>
            .
          </div>
        </div>
      </main>
    </div>
  )
}
