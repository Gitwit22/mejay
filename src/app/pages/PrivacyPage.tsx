import {useEffect} from 'react'
import {Link, useLocation, useNavigate} from 'react-router-dom'
import { MEJAY_LOGO_URL } from '@/lib/branding'
import {navigateBackToPartyMode} from '@/app/navigation/settingsReturnTo'

type PrivacyPageProps = {
  mode?: 'public' | 'app'
}

export default function PrivacyPage({ mode = 'app' }: PrivacyPageProps) {
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
          <button type="button" className="back-link" onClick={handleBack}>
            Back
          </button>
        </div>
      </header>

      <main className="main-content">
        <div className="hero">
          <h1>Privacy Policy</h1>
          <p className="hero-subtitle">How MeJay collects, uses, and protects your information</p>
        </div>

        <div className="last-updated">Effective Date: February 13, 2026</div>

        <section className="section" id="privacy-intro">
          <div className="section-content">
            <p>
              MeJay ("we," "our," or "us") operates the MeJay web platform (the "Service"). This Privacy Policy explains how we collect, use, and protect your information when you use our website.
            </p>
          </div>
        </section>

        <section className="section" id="information-collected">
          <h2 className="section-title">1. Information We Collect</h2>
          <div className="section-content">
            <h3>Information You Provide</h3>
            <p>We may collect:</p>
            <ul>
              <li>Name</li>
              <li>Email address</li>
              <li>Account login credentials</li>
              <li>Messages or support inquiries</li>
            </ul>

            <h3>Automatically Collected Information</h3>
            <p>When you use MeJay, we may collect:</p>
            <ul>
              <li>Browser type</li>
              <li>Device type</li>
              <li>IP address</li>
              <li>Usage data (pages visited, features used)</li>
              <li>Cookies and local storage data</li>
            </ul>

            <h3>Audio Files</h3>
            <p>If you upload audio files:</p>
            <ul>
              <li>Files are processed locally in your browser for playback and mixing functionality.</li>
              <li>We do not claim ownership of your content.</li>
              <li>Files are not shared publicly unless explicitly enabled by you.</li>
              <li>Your audio files are not uploaded to our servers.</li>
            </ul>
          </div>
        </section>

        <section className="section" id="how-we-use">
          <h2 className="section-title">2. How We Use Information</h2>
          <div className="section-content">
            <p>We use collected information to:</p>
            <ul>
              <li>Provide and operate the Service</li>
              <li>Improve functionality</li>
              <li>Communicate with users</li>
              <li>Monitor usage and prevent abuse</li>
              <li>Comply with legal obligations</li>
            </ul>
            <div className="info-box">
              <p><strong>We do not sell your personal information.</strong></p>
            </div>
          </div>
        </section>

        <section className="section" id="cookies-tracking">
          <h2 className="section-title">3. Cookies & Tracking</h2>
          <div className="section-content">
            <p>MeJay may use cookies or similar technologies to:</p>
            <ul>
              <li>Maintain login sessions</li>
              <li>Store preferences</li>
              <li>Analyze usage trends</li>
            </ul>
            <p>
              You can disable cookies in your browser settings, but some features may not function properly.
            </p>
          </div>
        </section>

        <section className="section" id="third-party">
          <h2 className="section-title">4. Third-Party Services</h2>
          <div className="section-content">
            <p>We may use trusted third-party services such as:</p>
            <ul>
              <li>Hosting providers (Cloudflare)</li>
              <li>Payment processors (e.g., Stripe)</li>
              <li>Analytics providers</li>
            </ul>
            <p>These providers process information in accordance with their own privacy policies.</p>
          </div>
        </section>

        <section className="section" id="data-security">
          <h2 className="section-title">5. Data Security</h2>
          <div className="section-content">
            <p>
              We implement reasonable technical and organizational safeguards to protect your information. However, no online service can guarantee absolute security.
            </p>
          </div>
        </section>

        <section className="section" id="your-rights">
          <h2 className="section-title">6. Your Rights</h2>
          <div className="section-content">
            <p>Depending on your location, you may have the right to:</p>
            <ul>
              <li>Access your data</li>
              <li>Request correction</li>
              <li>Request deletion</li>
              <li>Withdraw consent</li>
            </ul>
            <p>
              To make a request, contact us at: <a href="mailto:nxtlvltechllc@gmail.com">nxtlvltechllc@gmail.com</a>
            </p>
          </div>
        </section>

        <section className="section" id="childrens-privacy">
          <h2 className="section-title">7. Children's Privacy</h2>
          <div className="section-content">
            <p>
              MeJay is not intended for individuals under 13 years of age. We do not knowingly collect personal information from children.
            </p>
          </div>
        </section>

        <section className="section" id="policy-changes">
          <h2 className="section-title">8. Changes to This Policy</h2>
          <div className="section-content">
            <p>
              We may update this Privacy Policy periodically. Continued use of the Service after updates constitutes acceptance of the revised policy.
            </p>
          </div>
        </section>

        <section className="section" id="contact">
          <h2 className="section-title">9. Contact</h2>
          <div className="section-content">
            <p>If you have questions about this Privacy Policy, contact:</p>
            <div className="info-box">
              <p><strong>Nxt Lvl Technology Solutions</strong></p>
              <p>Email: <a href="mailto:nxtlvltechllc@gmail.com">nxtlvltechllc@gmail.com</a></p>
              <p>Website: <a href="https://nxtlvlts.com" target="_blank" rel="noopener noreferrer">nxtlvlts.com</a></p>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
