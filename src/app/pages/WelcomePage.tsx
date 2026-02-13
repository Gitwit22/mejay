import {useCallback, useState} from 'react'
import {Link, useNavigate} from 'react-router-dom'

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

  return (
    <img 
      className={className} 
      src={src} 
      alt={alt} 
      onError={handleError}
      width="400"
      height="400"
      style={{ aspectRatio: '1' }}
      fetchpriority="high"
      decoding="async"
    />
  )
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

      <div className="bg-photo-top" aria-hidden="true" />

      <div className="bg-photo-goodfeels" aria-hidden="true" />

      <div className="bg-photo-onenite" aria-hidden="true" />

      <div className="decorative-circles" aria-hidden="true">
        <div className="circle circle-1" />
        <div className="circle circle-2" />
        <div className="circle circle-3" />
      </div>

      <main className="container">
        <section className="welcome-plane" aria-label="Welcome content">
          <div className="welcome-plane-grid">
            <section className="hero-panel hero" aria-label="MEJay introduction">
              <header className="brand-row">
                <div className="brand">
                  <AnimatedLogo className="welcome-logo" alt="MEJay" />
                  <div className="brand-text">
                    <div className="brand-title">
                      <span className="brand-name">MEJay</span>
                      <span className="beta-badge">BETA</span>
                    </div>
                    <div className="brand-meta">{appStatus.version} • Party Warm-Up Engine</div>
                  </div>
                </div>
              </header>

              <div className="hero-copy">
                <p className="hero-eyebrow">
                  FOR HOSTS • PRE-DJ • NO AWKWARD SILENCE
                </p>

                <h1 className="hero-headline">
                  <span className="block">The party starts</span>
                  <span className="block">before the DJ arrives.</span>
                </h1>
                <p className="hero-sub">
                  Press play and let MEJay hold the vibe down — smooth transitions, no dead air, no commercials.
                  Perfect for the setup window and “DJ’s on the way.”
                </p>
              </div>

              <div className="hero-benefits what-you-get" aria-label="What you get">
                <div className="hero-benefits-title">What you get</div>
                <ul className="hero-benefits-list">
                  <li>• Auto-DJ energy without dead air</li>
                  <li>• Clean transitions that feel intentional</li>
                  <li>• Browser-first + installable (PWA)</li>
                </ul>
              </div>

              <div className="hero-ctas cta-group">
                <button
                  type="button"
                  className="cta-primary cta-login cta-button"
                  onClick={() => navigate('/login?returnTo=/app?tab=party')}
                >
                  <span className="inline-flex items-center justify-center gap-2 w-full">
                    Start the Party
                    <span aria-hidden="true">→</span>
                  </span>
                </button>
              </div>

            </section>

            <div className="bottom-stack" aria-label="Welcome details">
              <section className="features-panel features" aria-label="Key features">
                <div className="feature-grid">
                  <div className="feature-tile">
                    <div className="feature-icon" aria-hidden="true">
                      🔥
                    </div>
                    <div className="feature-text">
                      <div className="feature-title">No Awkward Silence</div>
                      <div className="feature-desc">Auto-mixing keeps the room warm while people arrive.</div>
                    </div>
                  </div>

                  <div className="feature-tile">
                    <div className="feature-icon" aria-hidden="true">
                      🧠
                    </div>
                    <div className="feature-text">
                      <div className="feature-title">Clean Transitions</div>
                      <div className="feature-desc">Smooth crossfades that feel like a real set.</div>
                    </div>
                  </div>

                  <div className="feature-tile">
                    <div className="feature-icon" aria-hidden="true">
                      🎛️
                    </div>
                    <div className="feature-text">
                      <div className="feature-title">DJ-Friendly Handoff</div>
                      <div className="feature-desc">Keep the vibe going, then hand off clean.</div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="support-info" aria-label="Support info">
                <footer className="welcome-footer" aria-label="Footer links">
                  <Link className="footer-link" to="/app/settings/about">About</Link>
                  <span className="footer-sep" aria-hidden="true">•</span>
                  <Link className="footer-link" to="/app/settings/pricing">Pricing</Link>
                  <span className="footer-sep" aria-hidden="true">•</span>
                  <Link className="footer-link" to="/app/settings/contact">Contact</Link>
                  <span className="footer-sep" aria-hidden="true">•</span>
                  <Link className="footer-link" to="/app/settings/terms">Terms</Link>
                </footer>
              </section>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
