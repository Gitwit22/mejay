import {Link} from 'react-router-dom'

const sections = [
  'Singles-first catalog structure',
  'Search, filters, and product discovery',
  'Preview audio and cover artwork',
  'Secure checkout and order history',
  'Purchased library and re-downloads',
]

export default function MusicStorePage() {
  return (
    <div className="mejay-pricing">
      <div className="bg-gradient gradient-1" aria-hidden="true" />
      <div className="bg-gradient gradient-2" aria-hidden="true" />
      <main className="main-content">
        <section className="hero">
          <h1>Music Store</h1>
          <p className="hero-subtitle">Marketplace structure is in place so store browsing, checkout, and purchased-music flows have a dedicated home.</p>
        </section>

        <div className="pricing-grid">
          <div className="pricing-card current">
            <span className="plan-badge current">Foundation</span>
            <div className="plan-name">Consumer store surface</div>
            <div className="plan-description">This is the app entry point for the marketplace buyer experience.</div>
            <ul className="plan-features">
              {sections.map((section) => (
                <li key={section}>{section}</li>
              ))}
            </ul>
            <div className="license-note" role="note">
              <div className="license-note-title">Next build stages</div>
              <div className="license-note-text">Wire this page to approved catalog products, checkout, and purchased entitlements after the backend catalog and commerce models land.</div>
            </div>
            <div style={{marginTop: '1.25rem'}}>
              <Link to="/app/purchased" className="plan-cta secondary" style={{display: 'inline-flex', justifyContent: 'center', textDecoration: 'none'}}>
                View Purchased Music structure
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
