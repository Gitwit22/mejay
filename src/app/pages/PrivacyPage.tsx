import {useEffect} from 'react'
import {Link} from 'react-router-dom'
import { MEJAY_LOGO_URL } from '@/lib/branding'

export default function PrivacyPage() {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="mejay-privacy">
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
            Back to Home
          </Link>
        </div>
      </header>

      <main className="main-content">
        <div className="hero">
          <h1>Privacy Policy</h1>
          <p className="hero-subtitle">A simple overview of how MEJay handles data</p>
        </div>

        <div className="last-updated">Last updated: February 2026</div>

        <section className="section" id="privacy-overview">
          <h2 className="section-title">Overview</h2>
          <div className="section-content">
            <div className="info-box">
              <p>
                MEJay is built to be browser-first and local-first. Your imported audio stays on your device and is not
                uploaded to our servers.
              </p>
            </div>
            <p>
              This page is a high-level policy placeholder while the full privacy policy is being finalized. If you have
              questions in the meantime, <Link to="/contact">contact us</Link>.
            </p>
            <ul>
              <li>
                <strong>Local storage:</strong> MEJay may store playlists and settings in your browser storage.
              </li>
              <li>
                <strong>Support:</strong> If you email support, we receive the information you send.
              </li>
              <li>
                <strong>No sale of data:</strong> We do not sell your personal information.
              </li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  )
}
