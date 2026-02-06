import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Outlet, useNavigate } from "react-router-dom";
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

const AppShellLayout = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // User request: refresh should land on the Welcome page.
    // We only do this on *hard reload* of /app, not normal in-app navigation.
    if (shouldRedirectToWelcomeOnMount()) {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  return <Outlet />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
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
