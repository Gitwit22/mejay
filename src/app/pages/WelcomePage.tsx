import {useCallback, useState} from 'react'
import {Link, useNavigate} from 'react-router-dom'

import {Globe, Infinity, Sparkles, ArrowUpRight} from 'lucide-react'

import {useGradientParallax} from '../hooks/useGradientParallax'
import {appStatus} from '@/appStatus'
import { MEJAY_LOGO_URL } from '@/lib/branding'

const ANIMATED_LOGO_WEBP_URL = '/branding/mejay_logo_animated.webp'

function AnimatedLogo({className, alt}: {className?: string; alt: string}) {
  const [src, setSrc] = useState(() => {
    const v = encodeURIComponent(appStatus.version || '')
    return v ? `${ANIMATED_LOGO_WEBP_URL}?v=${v}` : ANIMATED_LOGO_WEBP_URL
  })
  const handleError = useCallback(() => {
    setSrc(prev => (prev === MEJAY_LOGO_URL ? prev : MEJAY_LOGO_URL))
  }, [])

  return <img className={className} src={src} alt={alt} onError={handleError} />
}

export default function WelcomePage() {
  const navigate = useNavigate()
  useGradientParallax()

  return (
    <div className="mejay-welcome">
      <div className="bg-gradient gradient-1" aria-hidden="true" />
      <div className="bg-gradient gradient-2" aria-hidden="true" />
      <div className="bg-gradient gradient-3" aria-hidden="true" />

      <div className="bg-photo" aria-hidden="true" />

      <div className="decorative-circles" aria-hidden="true">
        <div className="circle circle-1" />
        <div className="circle circle-2" />
        <div className="circle circle-3" />
      </div>

      <main className="container">
        <section className="hero-panel" aria-label="MEJay introduction">
          <header className="brand-row">
            <div className="brand">
              <AnimatedLogo className="welcome-logo" alt="MEJay" />
              <div className="brand-text">
                <div className="brand-title">
                  <span className="brand-name">MEJay</span>
                  <span className="beta-badge">BETA</span>
                </div>
                <div className="brand-meta">{appStatus.version} • Browser-first DJ</div>
              </div>
            </div>
          </header>

          <div className="hero-copy">
            <h1 className="hero-headline">Auto-DJ energy. Clean transitions. Zero hassle.</h1>
            <p className="hero-sub">
              Browser-first DJ playback that keeps the vibe moving — with smart mixing and simple controls.
            </p>
          </div>

          <div className="hero-benefits" aria-label="What you get">
            <div className="hero-benefits-title">What you get</div>
            <ul className="hero-benefits-list">
              <li>• Auto-DJ energy without dead air</li>
              <li>• Clean transitions that feel intentional</li>
              <li>• Browser-first + installable (PWA)</li>
            </ul>
          </div>

          <div className="hero-ctas">
            <button
              type="button"
              className="cta-primary cta-login"
              onClick={() => navigate('/login?returnTo=/app')}
            >
              Login
            </button>

            <div className="cta-alt" aria-label="Create account">
              <span className="cta-alt-label">or</span>
              <button
                type="button"
                className="cta-alt-link"
                onClick={() => navigate('/login?returnTo=/app&intent=signup')}
              >
                create an account
              </button>
            </div>
          </div>

          <div className="trust-row" aria-label="Trust points">
            <div className="trust-item">Email login</div>
            <div className="trust-item">Browser-first</div>
            <div className="trust-item">Installable (PWA)</div>
          </div>

          <div className="brought-by" aria-label="Attribution">
            <span className="brought-by-label">Brought to you by</span>
            <span className="brought-by-name">Nxt Lvl Technology Solutions</span>
          </div>
        </section>

        <section className="features-panel" aria-label="Key features">
          <div className="feature-grid">
            <div className="feature-tile">
              <div className="feature-icon" aria-hidden="true">
                <Infinity className="feature-icon-svg" />
              </div>
              <div className="feature-text">
                <div className="feature-title">Always-On Playback</div>
                <div className="feature-desc">No dead air. Loop and keep it moving.</div>
              </div>
            </div>

            <div className="feature-tile">
              <div className="feature-icon" aria-hidden="true">
                <Sparkles className="feature-icon-svg" />
              </div>
              <div className="feature-text">
                <div className="feature-title">Clean Transitions</div>
                <div className="feature-desc">Smooth mixes that feel intentional.</div>
              </div>
            </div>

            <div className="feature-tile">
              <div className="feature-icon" aria-hidden="true">
                <Globe className="feature-icon-svg" />
              </div>
              <div className="feature-text">
                <div className="feature-title">Browser-First + Installable</div>
                <div className="feature-desc">Use it on the web or install like an app.</div>
              </div>
            </div>

            <div className="feature-tile">
              <div className="feature-icon" aria-hidden="true">
                <ArrowUpRight className="feature-icon-svg" />
              </div>
              <div className="feature-text">
                <div className="feature-title">Free Demo → Upgrade Later</div>
                <div className="feature-desc">Jump in now. Unlock more when ready.</div>
              </div>
            </div>
          </div>

          <footer className="welcome-footer" aria-label="Footer links">
            <Link className="footer-link" to="/about">About</Link>
            <span className="footer-sep" aria-hidden="true">•</span>
            <Link className="footer-link" to="/pricing">Pricing</Link>
            <span className="footer-sep" aria-hidden="true">•</span>
            <Link className="footer-link" to="/contact">Contact</Link>
            <span className="footer-sep" aria-hidden="true">•</span>
            <Link className="footer-link" to="/terms">Terms</Link>
          </footer>
        </section>
      </main>
    </div>
  )
}
