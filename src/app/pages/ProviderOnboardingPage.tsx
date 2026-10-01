import {useState, type FormEvent} from 'react'
import {Link} from 'react-router-dom'

import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Textarea} from '@/components/ui/textarea'
import {toast} from '@/hooks/use-toast'
import {getProviderStatusLabel} from '@/lib/marketplace'
import {submitProviderProfile} from '@/lib/providerApi'
import {usePlanStore} from '@/stores/planStore'

const steps = [
  'Provider profile and business identity',
  'Artist profile setup',
  'Rights declarations and certifications',
  'ISRC / UPC metadata readiness',
  'Pricing tiers and revenue splits',
  'Admin review before anything goes live',
]

/** Statuses where the provider can (re)submit their profile for review. */
const EDITABLE_STATUSES = new Set(['pending_profile_completion', 'needs_changes', 'rejected', null, undefined])

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function statusMessage(status: string | null | undefined): string {
  switch (status) {
    case 'pending_review':
      return 'Your profile is with the MEJay team for review. You can keep preparing releases; submitting them for sale unlocks once you are approved.'
    case 'approved':
      return 'You are approved. Set up Stripe payouts in the Artist Portal and submit releases for review.'
    case 'needs_changes':
    case 'rejected':
      return 'Your application needs changes. Update your profile below and resubmit it for review.'
    case 'suspended':
      return 'Your Artist account is suspended. Contact support for details.'
    default:
      return 'Complete your provider profile to apply. Uploading drafts is open; selling unlocks after admin approval.'
  }
}

export default function ProviderOnboardingPage() {
  const providerProfile = usePlanStore((s) => s.providerProfile)
  const userEmail = usePlanStore((s) => s.user?.email ?? '')
  const refreshFromServer = usePlanStore((s) => s.refreshFromServer)
  const status = providerProfile?.status ?? null
  const editable = EDITABLE_STATUSES.has(status)

  const [displayName, setDisplayName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [contactEmail, setContactEmail] = useState(userEmail)
  const [countryCode, setCountryCode] = useState('US')
  const [bio, setBio] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const finalSlug = slug || slugify(displayName)
    if (!displayName.trim() || !finalSlug || !contactEmail.trim() || !/^[A-Za-z]{2}$/.test(countryCode.trim())) {
      setError('Display name, profile URL, contact email and a 2-letter country code are required.')
      return
    }
    setSubmitting(true)
    try {
      await submitProviderProfile({
        displayName: displayName.trim(),
        legalName: legalName.trim() || undefined,
        slug: finalSlug,
        contactEmail: contactEmail.trim(),
        countryCode: countryCode.trim().toUpperCase(),
        bio: bio.trim() || undefined,
      })
      await refreshFromServer({reason: 'provider-profile-submitted'}).catch(() => false)
      toast({title: 'Profile submitted', description: 'The MEJay team will review your application.'})
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit your profile.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mejay-pricing">
      <div className="bg-gradient gradient-1" aria-hidden="true" />
      <div className="bg-gradient gradient-2" aria-hidden="true" />
      <main className="main-content">
        <section className="hero">
          <h1>Artist Onboarding</h1>
          <p className="hero-subtitle">Complete your Artist identity, rights, catalog, pricing, and payout setup.</p>
        </section>

        <div className="pricing-grid">
          <div className="pricing-card current">
            <span className="plan-badge current">Application status</span>
            <div className="plan-name">{getProviderStatusLabel(status)}</div>
            <p className="plan-description">{statusMessage(status)}</p>
            <ul className="plan-features">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            <div style={{marginTop: '1.25rem'}}>
              <Link to="/app/artist" className="plan-cta secondary" style={{display: 'inline-flex', justifyContent: 'center', textDecoration: 'none'}}>
                Back to Artist Portal
              </Link>
            </div>
          </div>

          {editable && (
            <form className="pricing-card" onSubmit={onSubmit} noValidate>
              <span className="plan-badge">Provider profile</span>
              <div className="space-y-4 text-left" style={{marginTop: '1rem'}}>
                <div className="space-y-1.5">
                  <Label htmlFor="provider-display-name">Display name</Label>
                  <Input
                    id="provider-display-name"
                    value={displayName}
                    maxLength={300}
                    required
                    onChange={(event) => {
                      setDisplayName(event.target.value)
                      if (!slugTouched) setSlug(slugify(event.target.value))
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provider-legal-name">Legal / business name (optional)</Label>
                  <Input id="provider-legal-name" value={legalName} maxLength={300} onChange={(event) => setLegalName(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provider-slug">Profile URL</Label>
                  <Input
                    id="provider-slug"
                    value={slug}
                    maxLength={80}
                    required
                    onChange={(event) => {
                      setSlugTouched(true)
                      setSlug(slugify(event.target.value))
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provider-email">Contact email</Label>
                  <Input id="provider-email" type="email" value={contactEmail} required onChange={(event) => setContactEmail(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provider-country">Country (2-letter code)</Label>
                  <Input
                    id="provider-country"
                    value={countryCode}
                    maxLength={2}
                    required
                    onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provider-bio">Bio (optional)</Label>
                  <Textarea id="provider-bio" value={bio} maxLength={2000} rows={4} onChange={(event) => setBio(event.target.value)} />
                </div>
                {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
                <button type="submit" className="plan-cta" disabled={submitting}>
                  {submitting ? 'Submitting…' : status === 'needs_changes' || status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
