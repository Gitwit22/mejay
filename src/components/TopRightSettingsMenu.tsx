import {useMemo, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {ChevronDown, LogOut, Settings as SettingsIcon} from 'lucide-react'

import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {Button} from '@/components/ui/button'
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
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible'
import {Separator} from '@/components/ui/separator'
import {cn} from '@/lib/utils'
import {useDJStore} from '@/stores/djStore'
import {appStatus, getDeviceStatusLabel} from '@/appStatus'
import {toast} from '@/hooks/use-toast'

type TopRightSettingsMenuProps = {
  className?: string
}

export function TopRightSettingsMenu({className}: TopRightSettingsMenuProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [activateOpen, setActivateOpen] = useState(false)
  const [licenseInfoOpen, setLicenseInfoOpen] = useState(false)

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
    await useDJStore.getState().resetLocalData()
    toast({
      title: 'Local data reset',
      description: 'Your local library, playlists, and settings were cleared.',
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
                      <div className="text-sm font-medium">{appStatus.plan}</div>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="text-sm text-muted-foreground">Device</div>
                      <div className="text-sm font-medium">{getDeviceStatusLabel()}</div>
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
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="text-sm text-muted-foreground">License status</div>
                      <div className="text-sm font-medium">{appStatus.licenseStatus}</div>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="text-sm text-muted-foreground">Device installs used</div>
                      <div className="text-sm font-medium">
                        {appStatus.installsUsed} of {appStatus.installsTotal}
                      </div>
                    </div>
                    <Separator />
                    <div className="flex gap-2 p-4">
                      <Button type="button" className="flex-1" onClick={() => setActivateOpen(true)}>
                        Activate License
                      </Button>
                      <Button type="button" variant="outline" className="flex-1" onClick={() => setLicenseInfoOpen(true)}>
                        License Info
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
                    <div className="flex items-center justify-between px-4 py-3 opacity-60">
                      <div>
                        <div className="text-sm font-medium">Default Volume</div>
                        <div className="text-xs text-muted-foreground">Coming soon</div>
                      </div>
                      <Button type="button" variant="outline" disabled>
                        Edit
                      </Button>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between px-4 py-3 opacity-60">
                      <div>
                        <div className="text-sm font-medium">Audio Output</div>
                        <div className="text-xs text-muted-foreground">Coming soon</div>
                      </div>
                      <Button type="button" variant="outline" disabled>
                        Select
                      </Button>
                    </div>
                    <Separator />
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
                              This clears your local library, playlists, and settings on this device. This can’t be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
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

          {/* Activate License modal */}
          <Dialog open={activateOpen} onOpenChange={setActivateOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Activate License</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Activation flow is coming soon.</p>
                <Button type="button" className="w-full" onClick={() => closeAndNavigate('/app')}>
                  Back to App
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* License Info modal */}
          <Dialog open={licenseInfoOpen} onOpenChange={setLicenseInfoOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>License Info</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">License info and device management will live here.</p>
                <Button type="button" variant="outline" className="w-full" onClick={() => setLicenseInfoOpen(false)}>
                  Close
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* About modal */}
        </SheetContent>
      </Sheet>
    </div>
  )
}
