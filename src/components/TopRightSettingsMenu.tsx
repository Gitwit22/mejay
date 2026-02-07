import {useMemo, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {ChevronDown, LogOut, Settings as SettingsIcon} from 'lucide-react'
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

type TopRightSettingsMenuProps = {
  className?: string
}

export function TopRightSettingsMenu({className}: TopRightSettingsMenuProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [licenseKey, setLicenseKey] = useState('')
  const [resetAlsoClearLicense, setResetAlsoClearLicense] = useState(false)

  const {plan} = usePlanStore()

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

  const logoutButtonClassName = useMemo(
    () =>
      cn(
        'w-full justify-start',
        // Subtle destructive styling: red text + light red hover.
        'text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive',
      ),
    [],
  )

  const handleLogout = () => {
    // Close modal first (per UX requirement).
    setOpen(false)

    // Optional in-memory UI state reset (no persistent storage changes).
    // Stop Party Mode to ensure playback + timers are cleaned up.
    try {
      useDJStore.getState().stopPartyMode()
    } catch {
      // ignore
    }

    navigate('/')
  }

  const closeAndNavigate = (to: string) => {
    setOpen(false)
    navigate(to)
  }

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

  const handleInstallStub = () => {
    toast({
      title: 'Install coming soon',
      description: 'PWA/Desktop install will appear here in a future update.',
    })
  }

  return (
    <div className={cn('fixed top-3 sm:top-16 right-3 z-[120]', className)}>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-center h-11 w-11 rounded-xl bg-background/90 backdrop-blur-md border border-border shadow-lg hover:bg-accent transition-colors"
            aria-label="Open settings"
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
        </SheetTrigger>

        <SheetContent
          side="right"
          className="w-[92vw] sm:w-[420px] sm:max-w-md flex flex-col h-[100dvh] max-h-[100dvh] min-h-0 overflow-hidden"
        >
          <SheetHeader className="shrink-0 bg-background/80 backdrop-blur-md pb-4">
            <SheetTitle>Setup</SheetTitle>
            <SheetDescription>Account, device, and local settings</SheetDescription>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-scroll pr-1 pb-6 mt-4 space-y-7 scrollbar-thin">
            {/* A) Status header */}
            <Collapsible defaultOpen>
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

            {/* B) Account / License */}
            <Collapsible defaultOpen>
              <div className="space-y-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex w-full items-center justify-between text-left text-xs font-semibold tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>Account / License</span>
                    <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-xl border border-border bg-background/60 backdrop-blur-sm">
                    <div className="p-4 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">License</div>
                          <div className="text-xs text-muted-foreground">Activate on this device</div>
                        </div>
                        <Badge
                          variant={
                            derivedStatus === 'PRO_OK'
                              ? 'default'
                              : derivedStatus === 'PRO_NEEDS_MANDATORY_CHECK'
                                ? 'secondary'
                                : derivedStatus === 'PRO_EXPIRED' || derivedStatus === 'INVALID'
                                  ? 'destructive'
                                  : 'outline'
                          }
                        >
                          {derivedStatus === 'PRO_OK'
                            ? licensePlan === 'full_program'
                              ? 'Full Program'
                              : 'Pro Active'
                            : derivedStatus === 'PRO_NEEDS_MANDATORY_CHECK'
                              ? 'Needs Check'
                              : derivedStatus === 'PRO_EXPIRED'
                                ? 'Expired'
                                : derivedStatus === 'INVALID'
                                  ? 'Invalid'
                                  : 'Free'}
                        </Badge>
                      </div>

                      {derivedStatus === 'PRO_NEEDS_MANDATORY_CHECK' && (
                        <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-muted-foreground">
                          Connect to the internet to verify your license (required every 30 days).
                        </div>
                      )}

                      {derivedStatus === 'INVALID' && derivedReason && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                          {derivedReason}
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label className="text-xs">License key</Label>
                        <div className="flex gap-2">
                          <Input
                            value={licenseKey}
                            onChange={(e) => setLicenseKey(e.target.value)}
                            placeholder="MEJAY-XXXX-XXXX"
                            className="h-9"
                          />
                          <Button
                            type="button"
                            className="h-9"
                            onClick={async () => {
                              try {
                                await activateWithKey(licenseKey)
                                setLicenseKey('')
                                toast({
                                  title: 'License activated',
                                  description: 'Pro features are now enabled on this device.',
                                })
                              } catch (e) {
                                toast({
                                  title: 'Activation failed',
                                  description: e instanceof Error ? e.message : 'Could not activate license.',
                                  variant: 'destructive',
                                })
                              }
                            }}
                            disabled={!licenseKey.trim()}
                          >
                            Activate
                          </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          A check-in is required at least once every 30 days.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Last checked</div>
                          <div className="text-sm font-medium">
                            {lastSuccessfulCheckAt ? new Date(lastSuccessfulCheckAt).toLocaleDateString() : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Next required by</div>
                          <div className="text-sm font-medium">
                            {nextRequiredCheckBy ? new Date(nextRequiredCheckBy).toLocaleDateString() : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Expires</div>
                          <div className="text-sm font-medium">
                            {expiresAt ? new Date(expiresAt).toLocaleDateString() : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Device ID</div>
                          <button
                            type="button"
                            className="text-left text-sm font-medium hover:underline"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(deviceId)
                                toast({title: 'Copied', description: 'Device ID copied to clipboard.'})
                              } catch {
                                toast({title: 'Copy failed', description: deviceId})
                              }
                            }}
                            title="Tap to copy"
                          >
                            {deviceId.slice(0, 8)}…
                          </button>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          onClick={async () => {
                            try {
                              await forceRefresh()
                              toast({title: 'Refreshed', description: 'License check completed.'})
                            } catch {
                              toast({
                                title: 'Refresh failed',
                                description: 'Could not refresh license right now.',
                                variant: 'destructive',
                              })
                            }
                          }}
                          disabled={!token}
                        >
                          Refresh now
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          onClick={() => {
                            clearLicense()
                            toast({title: 'License cleared', description: 'This device is now in Free mode.'})
                          }}
                          disabled={!token}
                        >
                          Deactivate
                        </Button>
                      </div>

                      {lastAttemptAt && (
                        <p className="text-[10px] text-muted-foreground">Last attempt: {new Date(lastAttemptAt).toLocaleString()}</p>
                      )}

                      {activatedAt && (
                        <p className="text-[10px] text-muted-foreground">Activated: {new Date(activatedAt).toLocaleDateString()}</p>
                      )}

                      <Separator />
                      <Button type="button" variant="outline" className="w-full" onClick={() => closeAndNavigate('/pricing')}>
                        View pricing
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* C) Settings */}
            <Collapsible defaultOpen>
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

            {/* D) Device */}
            <Collapsible defaultOpen>
              <div className="space-y-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex w-full items-center justify-between text-left text-xs font-semibold tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>Device</span>
                    <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-xl border border-border bg-background/60 backdrop-blur-sm">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div>
                        <div className="text-sm font-medium">Install MEJay</div>
                        <div className="text-xs text-muted-foreground">Desktop / PWA install</div>
                      </div>
                      <Button type="button" variant="outline" onClick={handleInstallStub}>
                        Install
                      </Button>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="text-sm text-muted-foreground">Installed</div>
                      <div className="text-sm font-medium">Not yet</div>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* E) Support */}
            <Collapsible defaultOpen>
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
                    <Button type="button" variant="outline" className="w-full justify-start" onClick={() => closeAndNavigate('/about')}>
                      About MEJay
                    </Button>
                    <Button type="button" variant="outline" className="w-full justify-start" onClick={() => closeAndNavigate('/pricing')}>
                      Pricing
                    </Button>
                    <Button type="button" variant="outline" className="w-full justify-start" onClick={() => closeAndNavigate('/terms')}>
                      Terms of Service
                    </Button>
                    <Button type="button" variant="outline" className="w-full justify-start" onClick={() => closeAndNavigate('/privacy')}>
                      Privacy Policy
                    </Button>
                    <Button type="button" variant="outline" className="w-full justify-start" onClick={() => closeAndNavigate('/contact')}>
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
    </div>
  )
}
