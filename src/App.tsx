import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Outlet, useNavigate } from "react-router-dom";
import { audioEngine } from "@/lib/audioEngine";
import { useDJStore } from "@/stores/djStore";
import { usePlanStore } from "@/stores/planStore";
import { getCheckoutStatus } from "@/lib/checkout";
import { toast } from "@/hooks/use-toast";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import WelcomePage from "./app/pages/WelcomePage";
import AboutPage from "./app/pages/AboutPage";
import PricingPage from "./app/pages/PricingPage";
import TermsPage from "./app/pages/TermsPage";
import ContactPage from "./app/pages/ContactPage";
import PrivacyPage from "./app/pages/PrivacyPage";

const queryClient = new QueryClient();

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

  useEffect(() => {
    // User request: refresh should land on the Welcome page.
    // We only do this on *hard reload* of /app, not normal in-app navigation.
    if (!didRedirectFromAppReloadThisDocument && shouldRedirectToWelcomeOnMount()) {
      didRedirectFromAppReloadThisDocument = true;
      navigate("/", { replace: true });
    }
  }, [navigate]);

  return <Outlet />;
};

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

const STRIPE_SESSION_ID_KEY = 'mejay:stripeSessionId';

const AppBillingBootstrap = () => {
  useEffect(() => {
    const run = async () => {
      try {
        const planState = usePlanStore.getState();
        if (!planState.billingEnabled) return;

        const url = new URL(window.location.href);
        const checkout = url.searchParams.get('checkout');
        const sessionIdFromUrl = url.searchParams.get('session_id');

        const verifyAndApply = async (sessionId: string, showToast: boolean) => {
          try {
            const status = await getCheckoutStatus(sessionId);
            if (status.hasFullAccess && (status.accessType === 'pro' || status.accessType === 'full_program')) {
              usePlanStore.getState().setRuntimePlan(status.accessType);
              try {
                localStorage.setItem(STRIPE_SESSION_ID_KEY, sessionId);
              } catch {
                // ignore
              }
              if (showToast) {
                toast({
                  title: 'Upgrade complete',
                  description: status.accessType === 'pro' ? 'Pro is now active.' : 'Full Program is now active.',
                });
              }
              return;
            }

            // Only downgrade to Free when we have a valid Stripe response.
            usePlanStore.getState().setRuntimePlan('free');
            if (showToast) {
              toast({
                title: 'Upgrade not active',
                description: 'Payment was not completed or subscription is inactive.',
                variant: 'destructive',
              });
            }
          } catch (e) {
            // Missing functions / non-JSON / transient failures should never blank the UI.
            if (showToast) {
              toast({
                title: 'Could not verify purchase',
                description: e instanceof Error ? e.message : 'Status check failed.',
                variant: 'destructive',
              });
            }
          }
        };

        // 1) If we just returned from Stripe, verify with session_id.
        if (checkout === 'success' && sessionIdFromUrl) {
          await verifyAndApply(sessionIdFromUrl, true);

          // Clean URL (remove checkout params) without navigation.
          url.searchParams.delete('checkout');
          url.searchParams.delete('plan');
          url.searchParams.delete('session_id');
          window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
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
          await verifyAndApply(stored, false);
        }
      } catch {
        // Never throw from bootstrap.
      }
    };

    void run();
  }, []);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppLifetimeAudioCleanup />
      <AppBillingBootstrap />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/app" element={<AppShellLayout />}>
            <Route index element={<Index />} />
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
