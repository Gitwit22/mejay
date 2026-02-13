import {useEffect, useMemo, useState} from 'react'
import {useLocation, useNavigate, type NavigateOptions} from 'react-router-dom'
import {ChevronDown, LogOut, Settings as SettingsIcon, X} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {Button} from '@/components/ui/button'
import {Badge} from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {Checkbox} from '@/components/ui/checkbox'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Separator} from '@/components/ui/separator'
import {cn} from '@/lib/utils'
import {useDJStore} from '@/stores/djStore'
import {appStatus} from '@/appStatus'
import {toast} from '@/hooks/use-toast'
import {usePlanStore} from '@/stores/planStore'
import {useLicenseStore} from '@/licensing/licenseStore'
import {getNextRequiredCheckBy} from '@/licensing/licensePolicy'
import {openBillingPortal} from '@/lib/checkout'
import {getSettingsEntryNavigateOptions} from '@/app/navigation/settingsReturnTo'
import {DownloadPacksModal} from '@/components/DownloadPacksModal'

type TopRightSettingsMenuProps = {
  className?: string
}

export function TopRightSettingsMenu({className}: TopRightSettingsMenuProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [panelMaxHeightPx, setPanelMaxHeightPx] = useState<number | null>(null)
  const [licenseKey, setLicenseKey] = useState('')
  const [resetAlsoClearLicense, setResetAlsoClearLicense] = useState(false)
  const [downloadPacksModalOpen, setDownloadPacksModalOpen] = useState(false)

  const keepImportsOnDevice = useDJStore((s) => s.settings.keepImportsOnDevice)
  const updateUserSettings = useDJStore((s) => s.updateUserSettings)

  const {plan, authStatus} = usePlanStore()

  const {
    token,
    plan: licensePlan,
    deviceId,
    derivedStatus,
    derivedReason,
    activatedAt,
    expiresAt,
    lastSuccessfulCheckAt,
    lastAttemptAt,
    activateWithKey,
    forceRefresh,
    clearLicense,
  } = useLicenseStore()

  const nextRequiredCheckBy = useMemo(
    () => getNextRequiredCheckBy(lastSuccessfulCheckAt),
    [lastSuccessfulCheckAt],
  )

  const planLabel = useMemo(() => {
    if (plan === 'full_program') return 'Full Program'
    if (plan === 'pro') return 'Pro'
    return 'Free'
  }, [plan])

  const hasPaidPlan = authStatus === 'authenticated' && plan !== 'free'

  const logoutButtonClassName = useMemo(
    () =>
      cn(
        'w-full justify-start',
        // Subtle destructive styling: red text + light red hover.
        'text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive',
      ),
    [],
  )

  const handleLogout = async () => {
    // Close modal first (per UX requirement).
    setOpen(false)

    // Optional in-memory UI state reset (no persistent storage changes).
    // Stop Party Mode to ensure playback + timers are cleaned up.
    try {
      useDJStore.getState().stopPartyMode()
    } catch {
      // ignore
    }

    // Call the logout API to clear the server-side session
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'},
      })
      
      if (!res.ok) {
        console.error('Logout API call failed:', res.status)
      }
    } catch (error) {
      console.error('Logout error:', error)
    }

    // Update auth status to anonymous (this clears the session state)
    usePlanStore.setState({authStatus: 'anonymous', user: null})

    // Navigate to home page
    navigate('/', {replace: true})
  }

  const closeAndNavigate = (to: string, options?: NavigateOptions) => {
    setOpen(false)
    navigate(to, options)
  }

  const closeAndNavigateSettings = (to: string, options?: NavigateOptions) => {
    closeAndNavigate(to, getSettingsEntryNavigateOptions(options))
  }

  const from = `${location.pathname}${location.search}`

  const planDestination = hasPaidPlan
    ? `/app/settings/billing?returnTo=${encodeURIComponent(from)}`
    : `/app/settings/pricing?returnTo=${encodeURIComponent(from)}`
  const planLabelInMenu = hasPaidPlan ? 'Manage plan' : 'View pricing'
  const planLabelInSupport = hasPaidPlan ? 'Manage Plan' : 'Pricing'
  const showManageBillingButton = plan !== 'full_program'

  const handleResetLocalData = async () => {
    setOpen(false)

    if (resetAlsoClearLicense) {
      clearLicense()
    }

    await useDJStore.getState().resetLocalData()
    toast({
      title: 'Local data reset',
      description: resetAlsoClearLicense
        ? 'Your local library, playlists, settings, and license were cleared.'
        : 'Your local library, playlists, and settings were cleared. Your license was kept.',
    })
    navigate('/', {replace: true})
    window.location.reload()
  }

  const handleClearLibrary = async () => {
    setOpen(false)
    await useDJStore.getState().clearAllImports()
  }

  const handleInstallStub = () => {
    toast({
      title: 'Install coming soon',
      description: 'PWA/Desktop install will appear here in a future update.',
    })
  }

  useEffect(() => {
    if (!open) return

    const reflow = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      // Match the safe insets we apply (top-3 + bottom-3 = 24px).
      const safeMax = Math.max(0, Math.floor(viewportHeight - 24))
      setPanelMaxHeightPx(safeMax)
    }

    const rafId = window.requestAnimationFrame(reflow)
    window.addEventListener('resize', reflow)
    window.visualViewport?.addEventListener('resize', reflow)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', reflow)
      window.visualViewport?.removeEventListener('resize', reflow)
    }
  }, [open])

  return (
    <div className={cn('fixed top-3 sm:top-16 right-3 z-[120]', className)}>
      <Sheet open={open} onOpenChange={setOpen}>
        {!open && (
          <SheetTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-center h-11 w-11 rounded-xl bg-background/90 backdrop-blur-md border border-border shadow-lg hover:bg-accent transition-colors"
              aria-label="Open settings"
            >
              <SettingsIcon className="h-5 w-5" />
            </button>
          </SheetTrigger>
        )}

        <SheetContent
          side="right"
          style={panelMaxHeightPx ? ({maxHeight: `${panelMaxHeightPx}px`} as React.CSSProperties) : undefined}
          className={cn(
            // Safe container: keep within viewport and allow scrolling even if the app shell is overflow-hidden.
            '!right-3 !top-3 !bottom-3 w-[92vw] sm:w-[420px] sm:max-w-md',
            'flex flex-col min-h-0 overflow-auto',
            'max-h-[calc(100dvh-24px)]',
            'rounded-2xl border',
            'scrollbar-thin',
          )}
        >
          <SheetHeader className="sticky top-0 z-10 shrink-0 bg-background/80 backdrop-blur-md pb-4">
            <SheetTitle>Settings</SheetTitle>
          </SheetHeader>

          <div className="min-h-0 pr-1 pb-6 mt-4 space-y-7">
            {/* A) Status header */}
            <Collapsible>
              <div className="space-y-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex w-full items-center justify-between text-left text-xs font-semibold tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>Status</span>
                    <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-xl border border-border bg-background/60 backdrop-blur-sm">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="text-sm text-muted-foreground">Plan</div>
                      <div className="text-sm font-medium">{planLabel}</div>
                
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="text-sm text-muted-foreground">Version</div>
                      <div className="text-sm font-medium">{appStatus.version}</div>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
              
            </Collapsible>

            {/* B) Account */}
            <Collapsible>
              <div className="space-y-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex w-full items-center justify-between text-left text-xs font-semibold tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>Account</span>
                    <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-xl border border-border bg-background/60 backdrop-blur-sm">
                    <div className="p-4 space-y-3">
                      {showManageBillingButton && (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={async () => {
                            try {
                              await openBillingPortal()
                            } catch (e) {
                              const msg = e instanceof Error ? e.message : 'Could not open billing portal.'
                              toast({
                                title: 'Billing',
                                description: msg,
                                variant: 'destructive',
                              })
                            }
                          }}
                        >
                          Manage billing
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => closeAndNavigateSettings(planDestination, {state: {from}})}
                      >
                        {planLabelInMenu}
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* C) License & Device */}
            <Collapsible>
              <div className="space-y-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex w-full items-center justify-between text-left text-xs font-semibold tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>License & Device</span>
                    <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-xl border border-border bg-background/60 backdrop-blur-sm">
                    <div className="p-4 space-y-4">
                      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                        <div className="text-sm font-medium text-muted-foreground mb-2">License Keys & Device Install</div>
                        <Badge variant="outline" className="mb-3">Coming Soon</Badge>
                        <p className="text-xs text-muted-foreground">
                          Device-based licensing and PWA install will be available in a future update.
                        </p>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* D) Settings */}
            <Collapsible>
              <div className="space-y-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex w-full items-center justify-between text-left text-xs font-semibold tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>Settings</span>
                    <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-xl border border-border bg-background/60 backdrop-blur-sm">
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">Keep imported songs on this device</div>
                          <div className="text-xs text-muted-foreground">Keeps your imports after refresh (recommended)</div>
                        </div>
                        <Checkbox
                          id="keep-imports-on-device"
                          checked={keepImportsOnDevice !== false}
                          onCheckedChange={(v) => {
                            void updateUserSettings({keepImportsOnDevice: Boolean(v)})
                              .catch(() => {
                                toast({
                                  title: 'Could not save setting',
                                  description: 'Your browser blocked saving device settings.',
                                  variant: 'destructive',
                                })
                              })
                          }}
                        />
                      </div>

                      <div className="h-4" />

                      <Button 
                        type="button" 
                        variant="outline" 
                        className="w-full"
                        onClick={() => setDownloadPacksModalOpen(true)}
                      >
                        Download Starter Packs
                      </Button>

                      <div className="h-4" />

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="outline" className="w-full">
                            Clear Library (Imports + Playlists)
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Clear library?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes all imported tracks and clears all playlists on this device. Your settings and license are kept.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={handleClearLibrary}
                            >
                              Clear
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      <div className="h-3" />

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                          >
                            Reset Local Data
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Reset local data?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This clears your local library, playlists, and settings on this device. Your license stays unless you choose to remove it.
                            </AlertDialogDescription>
                          </AlertDialogHeader>

                          <div className="flex items-start gap-3 py-2">
                            <Checkbox
                              id="reset-also-clear-license"
                              checked={resetAlsoClearLicense}
                              onCheckedChange={(v) => setResetAlsoClearLicense(Boolean(v))}
                            />
                            <label htmlFor="reset-also-clear-license" className="text-sm leading-tight text-muted-foreground">
                              Also remove license & activation info
                            </label>
                          </div>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={handleResetLocalData}
                            >
                              Reset
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* E) Support */}
            <Collapsible>
              <div className="space-y-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex w-full items-center justify-between text-left text-xs font-semibold tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>Support</span>
                    <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-xl border border-border bg-background/60 backdrop-blur-sm p-4 space-y-2">
                    <Button type="button" variant="outline" className="w-full justify-start" onClick={() => closeAndNavigateSettings('/app/settings/about')}>
                      About MEJay
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => closeAndNavigateSettings(planDestination, {state: {from}})}
                    >
                      {planLabelInSupport}
                    </Button>
                    <Button type="button" variant="outline" className="w-full justify-start" onClick={() => closeAndNavigateSettings('/app/settings/terms')}>
                      Terms of Service
                    </Button>
                    <Button type="button" variant="outline" className="w-full justify-start" onClick={() => closeAndNavigateSettings('/app/settings/privacy')}>
                      Privacy Policy
                    </Button>
                    <Button type="button" variant="outline" className="w-full justify-start" onClick={() => closeAndNavigateSettings('/app/settings/contact')}>
                      Contact & Support
                    </Button>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            <div className="pt-1">
              <Separator className="my-2" />
              <Button type="button" variant="outline" className={logoutButtonClassName} onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <DownloadPacksModal 
        open={downloadPacksModalOpen} 
        onOpenChange={setDownloadPacksModalOpen} 
      />    </div>
  )
}
