import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Outlet, useNavigate, Navigate } from "react-router-dom";
import { audioEngine } from "@/lib/audioEngine";
import { useDJStore } from "@/stores/djStore";
import { usePlanStore } from "@/stores/planStore";
import { CheckoutStatusError, getCheckoutStatus } from "@/lib/checkout";
import { toast } from "@/hooks/use-toast";
import { handleBecameOnline, periodicPolicyTick, startupCheck } from "@/licensing/licenseService";
import { useLicenseStore } from "@/licensing/licenseStore";
import { initMediaSession } from "@/lib/mediaSession";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import WelcomePage from "./app/pages/WelcomePage";
import LoginPage from "./app/pages/LoginPage";
import AboutPage from "./app/pages/AboutPage";
import PricingPage from "./app/pages/PricingPage";
import BillingPage from "./app/pages/BillingPage";
import TermsPage from "./app/pages/TermsPage";
import ContactPage from "./app/pages/ContactPage";
import PrivacyPage from "./app/pages/PrivacyPage";

const queryClient = new QueryClient();

const DEFAULT_AUTH_REDIRECT_PATH = '/app?tab=party';

const INITIAL_PATH_SESSION_KEY = "mejay:initialPath";

// Capture the initial URL for this document load so we can distinguish:
// - Reload on /app  -> bounce back to /
// - Reload on /     -> allow user to enter /app normally
if (typeof window !== "undefined") {
  try {
    sessionStorage.setItem(
      INITIAL_PATH_SESSION_KEY,
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
  } catch {
    // Ignore storage failures (private mode, disabled storage, etc)
  }
}

const shouldRedirectToWelcomeOnMount = () => {
  if (typeof window === "undefined") return false;

  const entries = window.performance?.getEntriesByType?.("navigation") as
    | PerformanceNavigationTiming[]
    | undefined;
  const entry = entries?.[0];

  // eslint-disable-next-line deprecation/deprecation
  const legacyType = (window.performance as any)?.navigation?.type;
  const isReload = entry?.type === "reload" || legacyType === 1;
  if (!isReload) return false;

  // Prefer the URL of the navigation entry (represents where the reload happened).
  const initialUrl = entry?.name;
  if (initialUrl) {
    try {
      return new URL(initialUrl).pathname.startsWith("/app");
    } catch {
      return initialUrl.includes("/app");
    }
  }

  // Fallback: use the initial path we captured at module-load time.
  try {
    const initialPath = sessionStorage.getItem(INITIAL_PATH_SESSION_KEY) ?? "";
    return initialPath.startsWith("/app");
  } catch {
    return false;
  }
};

// Guard against redirect loops:
// If the app hard-reloads on /app, we bounce to /. After that bounce, the user
// should still be able to navigate to /app in-app without being sent back again.
// This flag resets on the next full document load.
let didRedirectFromAppReloadThisDocument = false;

const AppShellLayout = () => {
  const navigate = useNavigate();
  const authStatus = usePlanStore((s) => s.authStatus)
  const authBypassEnabled = usePlanStore((s) => s.authBypassEnabled)

  useEffect(() => {
    // User request: refresh should land on the Welcome page.
    // We only do this on *hard reload* of /app, not normal in-app navigation.
    if (didRedirectFromAppReloadThisDocument) return
    if (!shouldRedirectToWelcomeOnMount()) return

    const run = async () => {
      const isBypassEnabled = usePlanStore.getState().authBypassEnabled
      // If we have not yet checked the server session, do a best-effort check first.
      // This prevents authenticated users from being bounced to / and thinking they got logged out.
      if (!isBypassEnabled && usePlanStore.getState().authStatus === 'unknown') {
        try {
          await usePlanStore.getState().refreshFromServer({reason: 'reloadGate'})
        } catch {
          // ignore
        }
      }

      // Only redirect to Welcome if the server says we are actually anonymous.
      // If authenticated, keep the user in the app on refresh.
      if (!isBypassEnabled && usePlanStore.getState().authStatus === 'anonymous') {
        didRedirectFromAppReloadThisDocument = true
        navigate('/', {replace: true})
      }
    }

    void run()
  }, [navigate]);

  useEffect(() => {
    // If server auth is anonymous, show login when entering the app shell.
    // (Free/demo features can be revisited later, but checkout must be tied to a user.)
    if (authBypassEnabled) return
    if (authStatus !== 'anonymous') return
    try {
      const path = `${window.location.pathname}${window.location.search}${window.location.hash}`
      if (path.startsWith('/app')) {
        navigate(`/login?returnTo=${encodeURIComponent(path)}`, {replace: true})
      }
    } catch {
      navigate('/login?returnTo=/app', {replace: true})
    }
  }, [authBypassEnabled, authStatus, navigate])

  return <Outlet />;
};

const WelcomeRoute = () => {
  const authStatus = usePlanStore((s) => s.authStatus)
  const authBypassEnabled = usePlanStore((s) => s.authBypassEnabled)
  const didKickoffRefresh = useRef(false)

  useEffect(() => {
    if (authBypassEnabled) return
    if (authStatus !== 'unknown') return
    if (didKickoffRefresh.current) return
    didKickoffRefresh.current = true
    void usePlanStore.getState().refreshFromServer({reason: 'welcomeGate'}).catch(() => undefined)
  }, [authBypassEnabled, authStatus])

  if (authBypassEnabled || authStatus === 'authenticated') {
    return <Navigate to={DEFAULT_AUTH_REDIRECT_PATH} replace />
  }

  return <WelcomePage />
}

const LoginRoute = () => {
  const authStatus = usePlanStore((s) => s.authStatus)
  const authBypassEnabled = usePlanStore((s) => s.authBypassEnabled)
  const didKickoffRefresh = useRef(false)

  useEffect(() => {
    if (authBypassEnabled) return
    if (authStatus !== 'unknown') return
    if (didKickoffRefresh.current) return
    didKickoffRefresh.current = true
    void usePlanStore.getState().refreshFromServer({reason: 'loginGate'}).catch(() => undefined)
  }, [authBypassEnabled, authStatus])

  if (authBypassEnabled || authStatus === 'authenticated') {
    return <Navigate to={DEFAULT_AUTH_REDIRECT_PATH} replace />
  }

  return <LoginPage />
}

const AppLifetimeAudioCleanup = () => {
  useEffect(() => {
    const handlePageHide = () => {
      // Do not tie audio lifecycle to route/tab UI mounts.
      // Only shut down on document lifecycle end.
      try {
        useDJStore.getState().stopPartyMode();
      } catch {
        // ignore
      }

      try {
        audioEngine.destroy();
      } catch {
        // ignore
      }
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);

  return null;
};

const AppMediaSessionBootstrap = () => {
  useEffect(() => {
    try {
      initMediaSession();
    } catch {
      // Never throw from bootstrap.
    }
  }, []);

  return null;
};

const STRIPE_SESSION_ID_KEY = 'mejay:stripeSessionId';

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const AppLicenseBootstrap = () => {
  useEffect(() => {
    void startupCheck();

    const onOnline = () => {
      void handleBecameOnline();
    };
    const onVisibility = () => {
      if (!document.hidden) void startupCheck();
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    const intervalId = window.setInterval(() => {
      periodicPolicyTick();
    }, 60_000);

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(intervalId);
    };
  }, []);

  return null;
};

const AppBillingBootstrap = () => {
  const qc = useQueryClient();
  const hasAppliedUpgradeRef = useRef(false);

  useEffect(() => {
    const run = async () => {
      try {
        // If a license token exists, licensing is the source of truth.
        if (useLicenseStore.getState().token) return;

        const planState = usePlanStore.getState();
        if (!planState.billingEnabled) return;

        // 0) Server (cookie session via /api/account/me) is the authority.
        // localStorage is only a fallback for offline/unreachable server.
        try {
          const ok = await usePlanStore.getState().refreshFromServer({reason: 'boot'})
          if (!ok && usePlanStore.getState().authStatus !== 'anonymous') {
            usePlanStore.getState().refreshFromStorage({reason: 'boot:fallback'})
          }
        } catch {
          usePlanStore.getState().refreshFromStorage({reason: 'boot:fallback:error'})
        }

        const url = new URL(window.location.href);
        const checkout = url.searchParams.get('checkout');
        const sessionIdFromUrl = url.searchParams.get('session_id');

        const cleanCheckoutUrl = () => {
          const cleaned = new URL(window.location.href)
          cleaned.searchParams.delete('checkout')
          cleaned.searchParams.delete('plan')
          cleaned.searchParams.delete('session_id')
          window.history.replaceState(null, "", `${cleaned.pathname}${cleaned.search}${cleaned.hash}`)
        }

        const applySuccessfulUpgrade = async (args: {
          sessionId: string
          accessType: 'pro' | 'full_program'
          stripeCustomerId?: string
        }) => {
          if (hasAppliedUpgradeRef.current) return;
          hasAppliedUpgradeRef.current = true;

          // Truth source: refresh from /api/account/me after server persists entitlements.
          try {
            localStorage.setItem(STRIPE_SESSION_ID_KEY, args.sessionId);
          } catch {
            // ignore
          }

          try {
            const ok = await usePlanStore.getState().refreshFromServer({reason: 'postCheckout'})
            if (!ok && usePlanStore.getState().authStatus !== 'anonymous') {
              usePlanStore.getState().refreshFromStorage({emit: false, reason: 'postCheckout:fallback'})
            }
          } catch {
            usePlanStore.getState().refreshFromStorage({emit: false, reason: 'postCheckout:fallback:error'})
          }

          // Best-effort: refresh any cached server data that may depend on entitlements.
          // (This is effectively a no-op today if there are no queries.)
          try {
            void qc.invalidateQueries();
            void qc.refetchQueries({ type: 'active' });
          } catch {
            // ignore
          }

          // Clean URL once activation is confirmed.
          try {
            cleanCheckoutUrl();
          } catch {
            // ignore
          }
        };

        const verifyAndApplyOnce = async (sessionId: string, opts?: {allowDowngrade?: boolean}) => {
          const status = await getCheckoutStatus(sessionId);
          if (status.hasFullAccess && (status.accessType === 'pro' || status.accessType === 'full_program')) {
            await applySuccessfulUpgrade({
              sessionId,
              accessType: status.accessType,
              stripeCustomerId: status.stripeCustomerId,
            });
            return { status, activated: true as const };
          }

          // Only downgrade outside the Stripe-return activation window.
          if (opts?.allowDowngrade) {
            usePlanStore.getState().applyEntitlements({
              accessType: 'free',
              hasFullAccess: false,
              source: 'stripe',
              reason: 'checkout:inactive',
            })
          }
          return { status, activated: false as const };
        };

        // 1) If we just returned from Stripe, verify with session_id (with grace window).
        if (checkout === 'success') {
          const debug = {
            checkout,
            hadSessionId: !!sessionIdFromUrl,
            verifyRan: false,
            attempts: 0,
            lastStatus: null as null | { accessType: string; hasFullAccess: boolean },
            lastError: null as null | { name: string; message: string; status?: number },
          };

          const activatingToast = toast({
            title: 'Activating your upgrade…',
            description: 'This can take a few seconds. Please keep this tab open.',
          });

          if (!sessionIdFromUrl) {
            console.warn('[Billing] Stripe return missing session_id', debug);
            activatingToast.update({
              title: 'Could not verify purchase',
              description: 'Missing Stripe session id. Please contact support.',
              variant: 'destructive',
            });
          } else {
            const sessionId = sessionIdFromUrl;

            // 1a) Fast-path activation: ask the server to sync+persist from Stripe once.
            // This updates D1 so the subsequent refreshFromServer() reflects the new plan immediately.
            try {
              const syncRes = await fetch('/api/billing/sync', {
                method: 'POST',
                credentials: 'include',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({sessionId}),
              })
              if (syncRes.ok) {
                const payload = (await syncRes.json().catch(() => null)) as null | {accessType?: unknown; hasFullAccess?: unknown}
                const accessType = payload?.accessType
                const hasFullAccess = payload?.hasFullAccess
                if ((accessType === 'pro' || accessType === 'full_program') && hasFullAccess === true) {
                  await applySuccessfulUpgrade({
                    sessionId,
                    accessType: accessType as 'pro' | 'full_program',
                  })
                  activatingToast.update({
                    title: 'Upgrade complete',
                    description: accessType === 'pro' ? 'Pro is now active.' : 'Full Program is now active.',
                  })
                  window.setTimeout(() => activatingToast.dismiss(), 2500)
                  return
                }
              }
            } catch {
              // ignore; fall back to checkout-status verification loop
            }

            const activationDeadline = Date.now() + 10_000;
            const delaysMs = [1000, 1000, 1500, 1500, 2000, 2000];
            const maxAttempts = delaysMs.length;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              debug.verifyRan = true;
              debug.attempts = attempt;

              try {
                const result = await verifyAndApplyOnce(sessionId, {allowDowngrade: false});
                debug.lastStatus = result.status;
                debug.lastError = null;

                if (result.activated) {
                  activatingToast.update({
                    title: 'Upgrade complete',
                    description: result.status.accessType === 'pro' ? 'Pro is now active.' : 'Full Program is now active.',
                  });
                  window.setTimeout(() => activatingToast.dismiss(), 2500);
                  break;
                }

                try {
                  await usePlanStore.getState().refreshFromServer({reason: 'activation:retry'})
                } catch {
                  usePlanStore.getState().refreshFromStorage({emit: false, reason: 'activation:retry:fallback'})
                }

                // Stop retrying once we’re past the activation window.
                if (Date.now() >= activationDeadline) {
                  throw new Error('Activation window elapsed')
                }
              } catch (e) {
                const err = e instanceof Error ? e : new Error('Status check failed.');
                debug.lastError = {
                  name: err.name,
                  message: err.message,
                  status: err instanceof CheckoutStatusError ? err.status : undefined,
                };

                // Stop early on non-retryable client errors (except 429).
                const status = err instanceof CheckoutStatusError ? err.status : undefined;
                const retryable = status === 429 || (typeof status === 'number' && status >= 500);
                if (typeof status === 'number' && status >= 400 && status < 500 && !retryable) {
                  activatingToast.dismiss();
                  console.warn('[Billing] Verification stopped (non-retryable)', debug);
                  toast({
                    title: 'Could not verify purchase',
                    description: err.message,
                    variant: 'destructive',
                  });
                  break;
                }
              }

              if (attempt < maxAttempts) {
                activatingToast.update({
                  title: 'Activating your upgrade…',
                  description: `Checking purchase status… (${attempt}/${maxAttempts})`,
                });
                await sleep(delaysMs[attempt - 1] ?? 1000);
              } else {
                activatingToast.dismiss();

                // Only show the scary toast after we tried verify + grace window.
                if (debug.lastError) {
                  console.warn('[Billing] Verification failed after grace window', debug);
                  toast({
                    title: 'Could not verify purchase',
                    description: debug.lastError.message,
                    variant: 'destructive',
                  });
                } else {
                  console.warn('[Billing] Upgrade not active after grace window', debug);
                  toast({
                    title: 'Upgrade not active',
                    description: 'Payment was not completed or subscription is inactive.',
                    variant: 'destructive',
                  });
                }
              }
            }
          }
          return;
        }

        // 2) Otherwise, restore from stored session id if present.
        let stored: string | null = null;
        try {
          stored = localStorage.getItem(STRIPE_SESSION_ID_KEY);
        } catch {
          stored = null;
        }
        if (stored) {
          try {
            await verifyAndApplyOnce(stored, {allowDowngrade: true});
          } catch {
            // Silent background check.
          }
        }
      } catch {
        // Never throw from bootstrap.
      }
    };

    void run();
  }, [qc]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppLifetimeAudioCleanup />
      <AppMediaSessionBootstrap />
      <AppLicenseBootstrap />
      <AppBillingBootstrap />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<WelcomeRoute />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/about" element={<Navigate to="/app/settings/about" replace />} />
          <Route path="/pricing" element={<Navigate to="/app/settings/pricing" replace />} />
          <Route path="/billing" element={<Navigate to="/app/settings/billing" replace />} />
          <Route path="/terms" element={<Navigate to="/app/settings/terms" replace />} />
          <Route path="/privacy" element={<Navigate to="/app/settings/privacy" replace />} />
          <Route path="/contact" element={<Navigate to="/app/settings/contact" replace />} />
          <Route path="/app" element={<AppShellLayout />}>
            <Route index element={<Index />} />
            <Route path="pricing" element={<Navigate to="/app/settings/pricing" replace />} />
            <Route path="billing" element={<Navigate to="/app/settings/billing" replace />} />
            <Route path="settings">
              <Route path="about" element={<AboutPage />} />
              <Route path="pricing" element={<PricingPage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="terms" element={<TermsPage />} />
              <Route path="privacy" element={<PrivacyPage />} />
              <Route path="contact" element={<ContactPage />} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
