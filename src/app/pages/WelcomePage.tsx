import {useCallback, useState} from 'react'
import {Link, useNavigate} from 'react-router-dom'
import {motion} from 'framer-motion'

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
      fetchPriority="high"
      decoding="async"
    />
  )
}

export default function WelcomePage() {
  const navigate = useNavigate()
  useGradientParallax()

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="mejay-welcome"
    >
      <style>{`
        @keyframes pulsate-glow {
          0%, 100% {
            box-shadow: 0 0 20px rgba(255, 107, 53, 0.5), 0 0 40px rgba(255, 107, 53, 0.3), 0 0 60px rgba(255, 107, 53, 0.2);
          }
          50% {
            box-shadow: 0 0 30px rgba(255, 107, 53, 0.8), 0 0 60px rgba(255, 107, 53, 0.5), 0 0 90px rgba(255, 107, 53, 0.3);
          }
        }
      `}</style>
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

              <div className="hero-ctas cta-group" style={{ marginTop: '2.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <button
                  type="button"
                  className="cta-primary cta-login cta-button"
                  onClick={() => navigate('/app?tab=library')}
                  style={{
                    animation: 'pulsate-glow 2s ease-in-out infinite',
                  }}
                >
                  <span className="inline-flex items-center justify-center gap-2 w-full">
                    Start the Party
                    <span aria-hidden="true">→</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="cta-secondary cta-button"
                  onClick={() => navigate('/login')}
                  style={{
                    background: 'linear-gradient(135deg, #00d4ff 0%, #0099ff 100%)',
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 0 20px rgba(0, 212, 255, 0.4), 0 0 40px rgba(0, 153, 255, 0.2)',
                    minWidth: '280px',
                    fontWeight: '600',
                  }}
                >
                  <span className="inline-flex items-center justify-center gap-2 w-full">
                    Log In
                  </span>
                </button>
              </div>

            </section>

            <div className="bottom-stack" aria-label="Welcome details">
              <section className="features-panel features" aria-label="Key features">
                <div className="feature-grid">
                  <div className="feature-tile">
                    <div className="feature-icon" aria-hidden="true">
                      ✨
                    </div>
                    <div className="feature-text">
                      <div className="feature-title">What you get</div>
                      <div className="feature-desc">Auto-DJ energy (no dead air) • Clean transitions that feel intentional • Installable (PWA)</div>
                    </div>
                  </div>

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
                <footer className="welcome-footer" aria-label="Footer links" style={{ marginTop: '1rem' }}>
                  <Link className="footer-link" to="/about">About</Link>
                  <span className="footer-sep" aria-hidden="true">•</span>
                  <Link className="footer-link" to="/pricing">Pricing</Link>
                  <span className="footer-sep" aria-hidden="true">•</span>
                  <Link className="footer-link" to="/contact">Contact</Link>
                  <span className="footer-sep" aria-hidden="true">•</span>
                  <Link className="footer-link" to="/terms">Terms</Link>
                  <span className="footer-sep" aria-hidden="true">•</span>
                  <Link className="footer-link" to="/privacy">Privacy</Link>
                </footer>
              </section>

              <section className="copyright-section" style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)', lineHeight: '1.5' }}>
                  <div>© 2025 Nxt Lvl Technology Solutions</div>
                  <div>MEJay™ is a trademark of Nxt Lvl Technology Solutions. All rights reserved.</div>
                </div>
              </section>
            </div>
          </div>
        </section>
      </main>
    </motion.div>
  )
}
