import {Link, useNavigate} from 'react-router-dom'

import {Globe, Infinity, Sparkles, ArrowUpRight} from 'lucide-react'

import {useGradientParallax} from '../hooks/useGradientParallax'
import {appStatus} from '@/appStatus'
import { MEJAY_LOGO_URL } from '@/lib/branding'

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
              <img className="welcome-logo" src={MEJAY_LOGO_URL} alt="MEJay" />
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

          <div className="hero-ctas">
            <button type="button" className="cta-primary" onClick={() => navigate('/app')}>
              Enter MEJay
            </button>
            <button type="button" className="cta-secondary" onClick={() => navigate('/login?returnTo=/app')}>
              Login
            </button>
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

        <section className="features" aria-label="Key features">
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
        </section>

        <footer className="welcome-footer" aria-label="Footer links">
          <Link className="footer-link" to="/about">About</Link>
          <span className="footer-sep" aria-hidden="true">•</span>
          <Link className="footer-link" to="/pricing">Pricing</Link>
          <span className="footer-sep" aria-hidden="true">•</span>
          <Link className="footer-link" to="/contact">Contact</Link>
          <span className="footer-sep" aria-hidden="true">•</span>
          <Link className="footer-link" to="/terms">Terms</Link>
        </footer>
      </main>
    </div>
  )
}
