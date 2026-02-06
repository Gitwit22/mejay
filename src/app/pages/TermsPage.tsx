import {useEffect} from 'react'
import {Link} from 'react-router-dom'

export default function TermsPage() {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="mejay-terms">
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
            Back to Home
          </Link>
        </div>
      </header>

      <main className="main-content">
        <div className="hero">
          <h1>Terms of Service</h1>
          <p className="hero-subtitle">Clear, simple terms for using MEJay</p>
        </div>

        <div className="last-updated">Last updated: February 2026</div>

        <nav className="toc" aria-label="Quick navigation">
          <div className="toc-title">Quick Navigation</div>
          <ul className="toc-list">
            <li>
              <a href="#overview">1. Overview</a>
            </li>
            <li>
              <a href="#license">2. License & Device Activations</a>
            </li>
            <li>
              <a href="#music">3. Music Ownership & User Responsibility</a>
            </li>
            <li>
              <a href="#privacy">4. Privacy & Data</a>
            </li>
            <li>
              <a href="#availability">5. Service Availability & Changes</a>
            </li>
            <li>
              <a href="#refunds">6. Refund Policy</a>
            </li>
            <li>
              <a href="#liability">7. Limitation of Liability</a>
            </li>
            <li>
              <a href="#contact">8. Contact</a>
            </li>
          </ul>
        </nav>

        <section className="section" id="overview">
          <h2 className="section-title">1. Overview</h2>
          <div className="section-content">
            <p>
              Welcome to MEJay. By using MEJay, you agree to these terms. MEJay is an audio playback platform designed
              for DJs, parties, and venues. These terms govern your use of the software and services.
            </p>
            <p>
              <strong>Company:</strong> MEJay is produced by <strong>Nxt Lvl Technology Solutions</strong>.
            </p>
            <p>
              <strong>Current Status:</strong> MEJay is actively evolving. You're using an early version focused on
              core playback experience. Features, functionality, and availability may change as we continue to develop
              the platform.
            </p>
            <div className="info-box">
              <p>
                MEJay is provided "as-is" during this beta phase. We're committed to building a reliable platform, but
                we recommend backing up important playlists and configurations.
              </p>
            </div>
          </div>
        </section>

        <section className="section" id="license">
          <h2 className="section-title">2. License & Device Activations</h2>
          <div className="section-content">
            <p>
              <strong>Free Demo:</strong> The free version of MEJay is available for testing and personal use in your
              browser. Demo accounts may have limited sessions or feature restrictions.
            </p>
            <p>
              <strong>MEJay Lifetime:</strong> A one-time purchase that grants you:
            </p>
            <ul>
              <li>
                Installation and activation on up to <strong>3 devices</strong>
              </li>
              <li>All core features unlocked</li>
              <li>Lifetime access to the software</li>
              <li>Priority updates when available</li>
            </ul>
            <div className="highlight-box">
              <p>
                <strong>Device Replacements:</strong> Need to move MEJay to a new device? <Link to="/contact">Contact us</Link>{' '}
                and we'll help you transfer your activation. We understand devices break or get upgraded.
              </p>
            </div>
            <p>
              <strong>License Restrictions:</strong>
            </p>
            <ul>
              <li>Your license is for personal or business use by you or your organization</li>
              <li>You may not resell, redistribute, or share your license</li>
              <li>Commercial venue use is permitted under your license</li>
            </ul>
          </div>
        </section>

        <section className="section" id="music">
          <h2 className="section-title">3. Music Ownership & User Responsibility</h2>
          <div className="section-content">
            <div className="highlight-box">
              <p>
                <strong>Important:</strong> You are responsible for ensuring you have the rights to any audio you upload,
                import, or play using MEJay.
              </p>
            </div>
            <p>MEJay is a playback tool. We do not:</p>
            <ul>
              <li>Provide, host, or distribute music content</li>
              <li>Verify copyright or licensing for your audio files</li>
              <li>Store your music on our servers (local playback only)</li>
            </ul>
            <p>
              <strong>Your Responsibilities:</strong>
            </p>
            <ul>
              <li>Ensure you own or have proper licenses for all music you use</li>
              <li>Obtain appropriate performance licenses for public/commercial use (e.g., BMI, ASCAP)</li>
              <li>Comply with all applicable copyright laws in your jurisdiction</li>
            </ul>
            <p>
              If you're using MEJay in a business or public venue, you may need separate performance rights licenses
              from music licensing organizations. MEJay does not provide these licenses.
            </p>
          </div>
        </section>

        <section className="section" id="privacy">
          <h2 className="section-title">4. Privacy & Data</h2>
          <div className="section-content">
            <p>We respect your privacy. Here's what you need to know:</p>
            <ul>
              <li>
                <strong>Your music stays local:</strong> Audio files are not uploaded to our servers
              </li>
              <li>
                <strong>Minimal data collection:</strong> We collect only what's necessary to provide the service
              </li>
              <li>
                <strong>No selling of data:</strong> We will never sell your personal information
              </li>
              <li>
                <strong>Account info:</strong> If you create an account, we store your email and license details
              </li>
            </ul>
            <p>
              For PWA/offline use, MEJay stores data locally on your device. You can clear this data at any time through
              your browser settings.
            </p>
            <p>
              Privacy policy details are available in <Link to="/privacy">our Privacy Policy</Link>.
            </p>
          </div>
        </section>

        <section className="section" id="availability">
          <h2 className="section-title">5. Service Availability & Changes</h2>
          <div className="section-content">
            <p>
              <strong>Beta Status:</strong> MEJay is actively evolving. We may:
            </p>
            <ul>
              <li>Make changes to features, functionality, or interface</li>
              <li>Experience occasional downtime for maintenance or updates</li>
              <li>Add new features or deprecate experimental ones</li>
            </ul>
            <p>
              We'll do our best to notify users of major changes, but we can't guarantee uninterrupted access during
              this development phase.
            </p>
            <p>
              <strong>Offline Use:</strong> MEJay works offline via PWA installation where supported. Your local data
              remains accessible even without an internet connection.
            </p>
          </div>
        </section>

        <section className="section" id="refunds">
          <h2 className="section-title">6. Refund Policy</h2>
          <div className="section-content">
            <p>
              <strong>Free Demo:</strong> No refunds needed—it's free!
            </p>
            <p>
              <strong>MEJay Lifetime:</strong> We offer a <strong>14-day money-back guarantee</strong>. If you're not
              satisfied within 14 days of purchase, <Link to="/contact">contact us</Link> for a full refund.
            </p>
            <p>
              After 14 days, all sales are final. However, if you experience technical issues that we can't resolve,
              we'll work with you on a case-by-case basis.
            </p>
            <div className="info-box">
              <p>
                <strong>Try before you buy:</strong> Use the free demo to test MEJay before purchasing the lifetime
                license.
              </p>
            </div>
          </div>
        </section>

        <section className="section" id="liability">
          <h2 className="section-title">7. Limitation of Liability</h2>
          <div className="section-content">
            <p>
              MEJay is provided "as-is" without warranties of any kind. We're building the best product we can, but we
              can't guarantee:
            </p>
            <ul>
              <li>Uninterrupted or error-free operation</li>
              <li>Compatibility with all devices or browsers</li>
              <li>That the software will meet your specific needs</li>
            </ul>
            <p>
              To the fullest extent permitted by law, Nxt Lvl Technology Solutions is not liable for:
            </p>
            <ul>
              <li>Loss of data or playlists</li>
              <li>Business interruption or lost profits</li>
              <li>Indirect, incidental, or consequential damages</li>
              <li>Issues arising from copyright violations by users</li>
            </ul>
            <p>
              <strong>Maximum Liability:</strong> Our total liability shall not exceed the amount you paid for your MEJay
              license.
            </p>
          </div>
        </section>

        <section className="section" id="contact">
          <h2 className="section-title">8. Contact</h2>
          <div className="section-content">
            <p>Questions about these terms? Need help with your license? We're here to help.</p>
            <ul>
              <li>
                <strong>Email:</strong> <a href="mailto:nxtlvltechllc@gmail.com">nxtlvltechllc@gmail.com</a>
              </li>
              <li>
                <strong>Website:</strong> <a href="https://nxtlvlts.com">nxtlvlts.com</a>
              </li>
              <li>
                <strong>Support Page:</strong> <Link to="/contact">MEJay Contact</Link>
              </li>
            </ul>
            <div className="info-box">
              <p>
                <strong>Business Inquiries:</strong> Interested in venue licensing or custom solutions? Reach out—we'd
                love to discuss how MEJay can work for your business.
              </p>
            </div>
          </div>
        </section>

        <div className="terms-footer-note">
          <p>By using MEJay, you acknowledge that you have read, understood, and agree to these Terms of Service.</p>
        </div>
      </main>
    </div>
  )
}
