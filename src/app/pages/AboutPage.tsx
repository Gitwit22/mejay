import {Link, useLocation, useNavigate} from 'react-router-dom'

import {useGradientScrollParallax} from '../hooks/useGradientScrollParallax'
import { MEJAY_LOGO_URL } from '@/lib/branding'
import {navigateBackToPartyMode} from '@/app/navigation/settingsReturnTo'

type AboutPageProps = {
  mode?: 'public' | 'app'
}

export default function AboutPage({ mode = 'app' }: AboutPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  useGradientScrollParallax()

  const handleBack = () => {
    if (mode === 'public') {
      navigate('/')
    } else {
      navigateBackToPartyMode(navigate, location.state)
    }
  }

  return (
    <div className="mejay-about">
      <div className="bg-gradient gradient-1" aria-hidden="true" />
      <div className="bg-gradient gradient-2" aria-hidden="true" />
      <div className="bg-gradient gradient-3" aria-hidden="true" />

      <header className="header">
        <div className="header-content">
          <Link to="/" className="logo-link" aria-label="MEJay Home">
            <div className="logo-small" aria-hidden="true">
              <img className="about-logo" src={MEJAY_LOGO_URL} alt="MEJay" />
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
          <h1>About MEJay</h1>
          <p className="hero-subtitle">
            A modern audio playback platform built for moments that shouldn't stop.
          </p>
        </section>

        <section className="section">
          <p className="section-text">
            Whether you're hosting a party, practicing your DJ skills, or setting the vibe for a space,
            MEJay focuses on one core promise:{' '}
            <strong>continuous, intelligent playback without the hassle.</strong>
          </p>
          <p className="section-text">
            Most music apps are built for listeners. <strong>MEJay is built for operators</strong> —
            people who need music to just work.
          </p>
        </section>

        <section className="section">
          <h2 className="section-title">What makes MEJay different</h2>
          <p className="section-text">
            MEJay is designed around reliability and flow, not playlists that suddenly end or volume
            that jumps unexpectedly.
          </p>

          <div className="feature-list">
            <div className="feature-item">
              <div className="feature-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10" />
                  <path fill="white" d="M10 8l6 4-6 4z" />
                </svg>
              </div>
              <div className="feature-title">Always-on playback</div>
              <div className="feature-description">Music keeps going without dead air</div>
            </div>

            <div className="feature-item">
              <div className="feature-icon" aria-hidden="true">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 12h4l3 9 4-18 3 9h4" />
                </svg>
              </div>
              <div className="feature-title">Smooth transitions</div>
              <div className="feature-description">Tracks flow naturally, not abruptly</div>
            </div>

            <div className="feature-item">
              <div className="feature-icon" aria-hidden="true">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v6m0 6v6m5.2-15.8l-4.2 4.2m-1.6 1.6l-4.2 4.2M23 12h-6m-6 0H1m15.8 5.2l-4.2-4.2m-1.6-1.6l-4.2-4.2" />
                </svg>
              </div>
              <div className="feature-title">Smart control</div>
              <div className="feature-description">Fewer distractions, more consistency</div>
            </div>

            <div className="feature-item">
              <div className="feature-icon" aria-hidden="true">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <div className="feature-title">Modern foundation</div>
              <div className="feature-description">
                Built to scale from personal use to professional environments
              </div>
            </div>
          </div>

          <p className="section-text section-text-spaced">
            It's not about pressing play over and over. It's about setting the vibe once and letting
            it run.
          </p>
        </section>

        <section className="section">
          <h2 className="section-title">Built for now — designed for what's next</h2>
          <p className="section-text">MEJay starts simple, but it's engineered with a bigger vision in mind.</p>
          <p className="section-text">The same core technology powering personal sessions is designed to support:</p>

          <div className="capability-list">
            <div className="capability-item">
              <div className="capability-icon" aria-hidden="true">
                🎯
              </div>
              <div className="capability-title">Unattended playback</div>
            </div>
            <div className="capability-item">
              <div className="capability-icon" aria-hidden="true">
                🔒
              </div>
              <div className="capability-title">Locked configurations</div>
            </div>
            <div className="capability-item">
              <div className="capability-icon" aria-hidden="true">
                ⏰
              </div>
              <div className="capability-title">Scheduled transitions</div>
            </div>
            <div className="capability-item">
              <div className="capability-icon" aria-hidden="true">
                ⚡
              </div>
              <div className="capability-title">Business-grade reliability</div>
            </div>
          </div>

          <p className="section-text section-text-spaced">
            That means MEJay can grow from a creative tool into a full operational audio platform —{' '}
            <strong>without being rebuilt from scratch.</strong>
          </p>
        </section>

        <section className="section">
          <h2 className="section-title">Current status</h2>
          <p className="section-text">
            MEJay is actively evolving. You're looking at an early version focused on core playback
            experience.
          </p>
          <p className="section-text">Upcoming phases will introduce:</p>

          <div className="upcoming-list">
            <div className="upcoming-item">
              <div className="upcoming-item-text">Enhanced control modes</div>
            </div>
            <div className="upcoming-item">
              <div className="upcoming-item-text">Business and venue support</div>
            </div>
            <div className="upcoming-item">
              <div className="upcoming-item-text">Device-level reliability</div>
            </div>
            <div className="upcoming-item">
              <div className="upcoming-item-text">Account & licensing layers</div>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">The goal</h2>
          <p className="section-text">MEJay isn't trying to replace every music app.</p>

          <div className="quote-block">
            <div className="quote-text">
              "I need music to run smoothly, consistently, and without babysitting it."
            </div>
          </div>

          <p className="section-text">If that sounds like what you've been missing, you're in the right place.</p>
        </section>

        <section className="cta-section">
          <h2 className="cta-title">Ready to experience MEJay?</h2>
          <p className="cta-text">Join the evolution of always-on music playback.</p>
          <button type="button" className="cta-button" onClick={() => navigate('/app')}>
            Enter MEJay
          </button>
        </section>
      </main>
    </div>
  )
}
