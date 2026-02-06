import {useEffect} from 'react'
import {Link, useNavigate} from 'react-router-dom'

import {toast} from '@/hooks/use-toast'

export default function PricingPage() {
  const navigate = useNavigate()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const handleLifetimeCta = () => {
    toast({
      title: 'Checkout coming soon',
      description: 'For now, contact support and we’ll get you set up.',
    })
    navigate('/contact')
  }

  return (
    <div className="mejay-pricing">
      <div className="bg-gradient gradient-1" aria-hidden="true" />
      <div className="bg-gradient gradient-2" aria-hidden="true" />

      <header className="header">
        <div className="header-content">
          <Link to="/" className="logo-link" aria-label="MEJay home">
            <div className="logo-small" aria-hidden="true">
              <img className="site-logo" src="/image.jpg" alt="MEJay" />
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
          <p className="hero-subtitle">Start free, upgrade when you're ready. One-time payment, no subscriptions.</p>
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
            <span className="plan-badge">Best Value</span>
            <div className="plan-name">MEJay Lifetime</div>
            <div className="plan-description">Own it forever, one-time payment</div>
            <div className="plan-price">
              <span className="price-amount">$199</span>
              <span className="price-period">one-time</span>
            </div>
            <ul className="plan-features">
              <li>Install on up to 3 devices</li>
              <li>All core features unlocked</li>
              <li>Priority updates</li>
              <li>Offline-ready via PWA install</li>
              <li>Lifetime access</li>
              <li>No recurring fees</li>
            </ul>
            <button type="button" className="plan-cta" onClick={handleLifetimeCta}>
              Get Lifetime Access
            </button>
          </div>

          <div className="pricing-card coming-soon" aria-disabled="true">
            <span className="coming-soon-badge">Coming Soon</span>
            <div className="plan-name">MEJay Pro</div>
            <div className="plan-description">Advanced features for professionals</div>
            <div className="plan-price">
              <span className="price-amount">$5</span>
              <span className="price-period">/month</span>
            </div>
            <ul className="plan-features">
              <li>Everything in Lifetime</li>
              <li>Cloud sync across devices</li>
              <li>Advanced automation</li>
              <li>Business venue features</li>
              <li>Priority support</li>
            </ul>
            <button type="button" className="plan-cta secondary" disabled>
              Notify Me
            </button>
          </div>
        </div>

        <div className="license-note" role="note">
          <div className="license-note-title">📋 License Information</div>
          <div className="license-note-text">
            Lifetime includes up to 3 device activations. Need more due to a device replacement?{' '}
            <Link className="license-note-link" to="/contact">
              Contact us
            </Link>{' '}
            and we'll help.
          </div>
        </div>
      </main>
    </div>
  )
}
