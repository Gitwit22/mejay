import {useEffect} from 'react'
import {Link, useLocation, useNavigate} from 'react-router-dom'
import { MEJAY_LOGO_URL } from '@/lib/branding'
import {navigateBackToPartyMode} from '@/app/navigation/settingsReturnTo'

type ContactPageProps = {
  mode?: 'public' | 'app'
}

export default function ContactPage({ mode = 'app' }: ContactPageProps) {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const handleBack = () => {
    if (mode === 'public') {
      navigate('/')
    } else {
      navigateBackToPartyMode(navigate, location.state)
    }
  }

  return (
    <div className="mejay-contact">
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
            Back
          </button>
        </div>
      </header>

      <main className="main-content">
        <div className="hero">
          <h1>Contact &amp; Support</h1>
          <p className="hero-subtitle">We're here to help. Reach out with questions, issues, or feedback.</p>
        </div>

        <div className="contact-grid">
          <div className="contact-card">
            <div className="contact-icon" aria-hidden="true">
              📧
            </div>
            <div className="contact-title">Email Support</div>
            <div className="contact-info">
              <a href="mailto:nxtlvltechllc@gmail.com">nxtlvltechllc@gmail.com</a>
            </div>
          </div>

          <div className="contact-card">
            <div className="contact-icon" aria-hidden="true">
              🌐
            </div>
            <div className="contact-title">Website</div>
            <div className="contact-info">
              <a href="https://nxtlvlts.com" target="_blank" rel="noopener noreferrer">
                nxtlvlts.com
              </a>
            </div>
          </div>
        </div>

        <div className="support-section">
          <h2 className="section-title">What to Expect</h2>
          <div className="info-box">
            <div className="info-box-title">⏱️ Response Times</div>
            <div className="info-box-content">
              <p>
                We aim to respond to all support inquiries as quickly as possible. Most emails receive a response within{' '}
                <strong>1-2 business days</strong>.
              </p>
              <p>
                For urgent issues (license problems, payment issues, critical bugs), we prioritize those and typically
                respond within 24 hours.
              </p>
              <p className="info-box-paragraph--last">
                <strong>Note:</strong> Response times may be longer during weekends and holidays.
              </p>
            </div>
          </div>
        </div>

        <div className="support-section">
          <h2 className="section-title">Help Us Help You</h2>
          <div className="info-box">
            <div className="info-box-title">📋 Include This Information</div>
            <div className="info-box-content">
              <p>To help us resolve your issue quickly, please include the following in your support email:</p>
              <ul className="checklist">
                <li>
                  <strong>Browser and version</strong> (e.g., Chrome 120, Safari 17, Firefox 121)
                </li>
                <li>
                  <strong>Device type</strong> (e.g., Windows 11 laptop, iPhone 15, MacBook Pro)
                </li>
                <li>
                  <strong>What page or feature</strong> you were using when the issue occurred
                </li>
                <li>
                  <strong>Screenshot or screen recording</strong> if applicable
                </li>
                <li>
                  <strong>Steps to reproduce</strong> the problem (what did you click/do?)
                </li>
              </ul>
              <div className="license-issue-box">
                <strong>For licensing issues:</strong> Include the last 4 characters of your license key (never share the
                full key publicly).
              </div>
            </div>
          </div>
        </div>

        <div className="support-section">
          <h2 className="section-title">Common Support Topics</h2>
          <div className="info-box">
            <div className="info-box-title">💡 Quick Help</div>
            <div className="info-box-content">
              <ul>
                <li>
                  <strong>License activation:</strong> Need to move MEJay to a new device or having trouble activating? We
                  can help transfer your license.
                </li>
                <li>
                  <strong>Payment issues:</strong> Didn't receive your license key? Contact us with your transaction
                  details.
                </li>
                <li>
                  <strong>Technical problems:</strong> App not loading, features not working, or experiencing bugs? Let us
                  know the details.
                </li>
                <li>
                  <strong>Feature requests:</strong> Have an idea for MEJay? We'd love to hear it!
                </li>
                <li>
                  <strong>Business inquiries:</strong> Interested in venue licensing or custom solutions? Reach out to
                  discuss.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="highlight-box">
          <div className="highlight-box-title">Ready to Get in Touch?</div>
          <div className="highlight-box-text">
            Send us an email with your question or issue. Include the information above to help us respond quickly and
            effectively.
          </div>
          <a
            href="mailto:nxtlvltechllc@gmail.com?subject=MEJay%20Support%20Request"
            className="email-button"
            aria-label="Email support"
          >
            Email Support
          </a>
        </div>

        <div className="page-footer-note">
          <p>
            Next Level Tech LLC
            <br />
            Building tools that keep the music going.
          </p>
        </div>
      </main>
    </div>
  )
}
