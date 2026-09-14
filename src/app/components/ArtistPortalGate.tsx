import {useState} from 'react'
import {Outlet, useLocation, useNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {toast} from '@/hooks/use-toast'
import {convertToArtistAccount} from '@/lib/artistAccount'
import {usePlanStore} from '@/stores/planStore'

export default function ArtistPortalGate() {
  const navigate = useNavigate()
  const location = useLocation()
  const authStatus = usePlanStore((state) => state.authStatus)
  const user = usePlanStore((state) => state.user)
  const providerProfile = usePlanStore((state) => state.providerProfile)
  const artistPortalAccess = usePlanStore((state) => state.artistPortalAccess)
  const [busy, setBusy] = useState(false)

  if (authStatus === 'unknown') {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Checking Artist access...</div>
  }

  if (authStatus !== 'authenticated' || !user) {
    const returnTo = encodeURIComponent(`${location.pathname}${location.search}`)
    return (
      <ArtistAccessMessage
        title="Sign in to the Artist Portal"
        description="Artist accounts require a signed-in MEJay account and an active Pro subscription."
        actionLabel="Sign in"
        onAction={() => navigate(`/login?returnTo=${returnTo}`)}
      />
    )
  }

  if (!artistPortalAccess) {
    return (
      <ArtistAccessMessage
        title={user.accountIntent === 'provider' ? 'Renew Pro to continue' : 'Become a MEJay Artist'}
        description={user.accountIntent === 'provider'
          ? 'Your Artist profile and catalog are preserved. Renew Pro to unlock the portal again.'
          : 'An active Pro subscription is required to create an Artist account and publish music.'}
        actionLabel={user.accountIntent === 'provider' ? 'Renew Pro' : 'View Pro plans'}
        onAction={() => navigate('/app/settings/pricing?artist_upgrade=1')}
      />
    )
  }

  if (user.accountIntent !== 'provider' || !providerProfile) {
    const activate = async () => {
      if (busy) return
      setBusy(true)
      try {
        await convertToArtistAccount()
        await usePlanStore.getState().refreshFromServer({reason: 'artistConversion'})
        navigate('/app/artist/onboarding', {replace: true})
      } catch (error) {
        toast({
          title: 'Artist account not activated',
          description: error instanceof Error ? error.message : 'Please try again.',
          variant: 'destructive',
        })
        setBusy(false)
      }
    }

    return (
      <ArtistAccessMessage
        title="Activate your Artist Account"
        description="Your Pro subscription is active. Finish switching this account to enter Artist onboarding."
        actionLabel={busy ? 'Activating...' : 'Switch to Artist Account'}
        onAction={() => void activate()}
        disabled={busy}
      />
    )
  }

  return <Outlet />
}

function ArtistAccessMessage(props: {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
  disabled?: boolean
}) {
  return (
    <div className="mejay-pricing">
      <main className="main-content">
        <section className="hero">
          <h1>{props.title}</h1>
          <p className="hero-subtitle">{props.description}</p>
        </section>
        <div className="pricing-grid">
          <div className="pricing-card current">
            <Button className="w-full" onClick={props.onAction} disabled={props.disabled}>{props.actionLabel}</Button>
          </div>
        </div>
      </main>
    </div>
  )
}