import {useEffect, useState} from 'react'
import {Link, useLocation, useNavigate} from 'react-router-dom'

import {toast} from '@/hooks/use-toast'
import {openBillingPortal} from '@/lib/checkout'
import {MEJAY_LOGO_URL} from '@/lib/branding'
import {usePlanStore} from '@/stores/planStore'
import {navigateBackToPartyMode} from '@/app/navigation/settingsReturnTo'

type BillingPageProps = {
  mode?: 'public' | 'app'
}

export default function BillingPage({ mode = 'app' }: BillingPageProps) {
  const location = useLocation()
  const navigate = useNavigate()

  const plan = usePlanStore((s) => s.plan)
  const authStatus = usePlanStore((s) => s.authStatus)
  const billingEnabled = usePlanStore((s) => s.billingEnabled)
  const authBypassEnabled = usePlanStore((s) => s.authBypassEnabled)
  const stripeCustomerId = usePlanStore((s) => s.stripeCustomerId)
  const billingCadence = usePlanStore((s) => s.billingCadence)
  const cancelAtPeriodEnd = usePlanStore((s) => s.cancelAtPeriodEnd)
  const currentPeriodEnd = usePlanStore((s) => s.currentPeriodEnd)

  const [busy, setBusy] = useState(false)

  const hasPaidPlan = authStatus === 'authenticated' && plan !== 'free'
  const isFullProgramOwner = authStatus === 'authenticated' && plan === 'full_program'
  const canOpenPortal = authStatus === 'authenticated' && (hasPaidPlan || Boolean(stripeCustomerId))
  const periodEndLabel = currentPeriodEnd
    ? new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(new Date(currentPeriodEnd))
    : null

  useEffect(() => {
    if (new URLSearchParams(location.search).get('portal') !== 'return') return
    void usePlanStore.getState().refreshFromServer({reason: 'billingPortalReturn'})
  }, [location.search])

  const handleBack = () => {
    if (mode === 'public') {
      navigate('/')
    } else {
      navigateBackToPartyMode(navigate, location.state)
    }
  }

  const handleManageBilling = async () => {
    setBusy(true)
    try {
      await openBillingPortal()
    } catch (e) {
      toast({
        title: 'Billing',
        description: e instanceof Error ? e.message : 'Could not open billing portal.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleChangePlan = () => {
    const self = `${location.pathname}${location.search}`
    const rt = encodeURIComponent(self)
    navigate(`/app/settings/pricing?returnTo=${rt}`, {replace: true, state: {from: self}})
  }

  return (
    <div className="mejay-pricing">
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
          <h1>Manage Plan</h1>
          <p className="hero-subtitle">
            {isFullProgramOwner
              ? 'Your Full Program is active on this account.'
              : 'View your current plan and manage billing when you’re ready.'}
          </p>
        </section>

        <div className="pricing-grid">
          <div className="pricing-card current">
            <span className="plan-badge current">Current plan</span>
            <div className="plan-name">{hasPaidPlan ? (plan === 'pro' ? 'MEJay Pro' : 'Full Program') : 'Free (Demo)'}</div>
            <div className="plan-description">
              {isFullProgramOwner
                ? 'Permanent access is active on this account.'
                : plan === 'pro'
                  ? cancelAtPeriodEnd && periodEndLabel
                    ? `Your ${billingCadence ?? 'Pro'} subscription cancels on ${periodEndLabel}.`
                    : `Your ${billingCadence ?? 'Pro'} subscription is active.`
                  : 'You’re currently on the Free plan.'}
            </div>

            <ul className="plan-features">
              {hasPaidPlan ? (
                <>
                  <li>Auto volume matching</li>
                  <li>Smooth transitions & advanced timing</li>
                  <li>Tempo control + BPM tools</li>
                </>
              ) : (
                <>
                  <li>Play and test MEJay in browser</li>
                  <li>Basic playback features</li>
                </>
              )}
            </ul>

            <div className="license-note" role="note">
              <div className="license-note-title">{isFullProgramOwner ? 'Account' : 'Billing'}</div>
              <div className="license-note-text">
                {billingEnabled ? (
                  authBypassEnabled ? (
                    'Login bypass is enabled. Disable it and sign in to manage billing.'
                  ) : authStatus !== 'authenticated' ? (
                    'Sign in to manage billing.'
                  ) : (
                    isFullProgramOwner
                      ? 'Everything is unlocked. Open the account portal only if you need receipts or account details.'
                      : plan === 'pro'
                        ? 'Use Stripe’s secure portal to manage or cancel your subscription.'
                        : stripeCustomerId
                          ? 'Open the billing portal for receipts or billing history.'
                          : 'Choose a plan when you’re ready to upgrade.'
                  )
                ) : (
                  'Billing is disabled in this build (dev mode).'
                )}
              </div>
            </div>

            <div style={{display: 'grid', gap: '0.75rem', marginTop: '1.25rem'}}>
              {canOpenPortal && (
                <button type="button" className="plan-cta" onClick={handleManageBilling} disabled={busy || !billingEnabled}>
                  {busy ? 'Opening…' : plan === 'pro' ? 'Manage or cancel subscription' : 'Account portal'}
                </button>
              )}
              {!isFullProgramOwner && (
                <button type="button" className="plan-cta secondary" onClick={handleChangePlan}>
                  Change plan
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={{marginTop: '2rem', textAlign: 'center', fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)'}}>
          <div>© 2025 Nxt Lvl Technology Solutions</div>
          <div>MEJay™ is a trademark of Nxt Lvl Technology Solutions. All rights reserved.</div>
        </div>
      </main>
    </div>
  )
}
