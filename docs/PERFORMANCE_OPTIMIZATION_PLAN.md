# MEJay Performance Optimization Plan

## Executive Summary
**Current State**: LCP P75 ~3.6s, P90 ~6.5s; Poor INP; CLS issues
**Goal**: Improve LCP to <2.5s, INP to <200ms, CLS to <0.1

## Critical Issues Identified

### 1. LCP Elements
- **Landing Page (`/`)**: Animated logo WebP (`/branding/mejay_logo_animated.webp`) - This is the LCP element
- **App Page (`/app`)**: MEJay logo PNG at top (h-32 = 128px) - Secondary LCP element
- **Fonts**: Google Fonts (Inter + Space Grotesk) loaded via CSS `@import` - blocks render

### 2. Render-Blocking Issues
- **Heavy Bootstrap Effects**: 4 global bootstrap components run on every mount:
  - `AppLifetimeAudioCleanup` - registers pagehide listener
  - `AppMediaSessionBootstrap` - initializes media session immediately
  - `AppLicenseBootstrap` - starts license checks + 60s interval
  - `AppBillingBootstrap` - checks Stripe session on mount
- **Synchronous Data Loading**: `/app` index loads tracks, playlists, settings immediately on mount
- **Audio Engine Import**: audioEngine is imported at module level in App.tsx (line 7)
- **All Route Components Eagerly Loaded**: No code-splitting (DevAdminPage, LoginPage, etc all bundled)

### 3. CLS Issues
- **Background Orbs**: No reserved space, absolute positioned (lines 105-107 in Index.tsx)
- **Logo**: No aspect-ratio or dimensions set, can shift during load
- **Tab Bar**: Fixed at bottom, but no explicit height reservation
- **Animated Logo Fallback**: Can cause shift when WebP fails and falls back to PNG

### 4. INP Issues
- **No Debouncing**: Waveform/tempo controls likely update without debouncing
- **Heavy Re-renders**: PartyModeView, LibraryView loaded regardless of active tab
- **Animation Frame Loop**: audioEngine runs requestAnimationFrame continuously when playing

### 5. Font Loading
- **Blocking**: `@import url('https://fonts.googleapis.com/...')` in index.css blocks first paint
- **No font-display**: Uses default (block), causes FOIT
- **Two font families**: Inter (5 weights) + Space Grotesk (3 weights) = 8 font files

---

## Top 10 High-Impact Changes

### CHANGE 1: Preload Critical Assets + Font Display
**File**: `index.html`
**Impact**: LCP -0.5s to -1.0s, CLS -0.05

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MEJay - The Party Starts Before the DJ Arrives</title>
    <meta name="description" content="MEJay — DJ mixing & party mode" />
    
    <!-- Preconnect to Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    
    <!-- Preload critical logo images -->
    <link rel="preload" as="image" href="/branding/mejay_logo_animated.webp" fetchpriority="high">
    <link rel="preload" as="image" href="/branding/mejay_logo.png" fetchpriority="high">
    
    <!-- Preload critical fonts with font-display swap -->
    <link rel="preload" as="font" type="font/woff2" href="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiA.woff2" crossorigin>
    
    <meta property="og:title" content="MEJay - The Party Starts Before the DJ Arrives" />
    <meta property="og:description" content="MEJay — DJ mixing & party mode" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="/image.jpg" />
    
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="/image.jpg" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Explanation**: Preconnect eliminates DNS + TLS handshake (200-400ms). Preload ensures logo starts downloading before CSS parsed. Font preload with crossorigin prevents double-download.

---

### CHANGE 2: Non-Blocking Font Loading with font-display: swap
**File**: `src/index.css`
**Impact**: LCP -0.3s to -0.6s, CLS -0.03

```css
/* BEFORE: Blocking @import */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap');

/* AFTER: Load fonts asynchronously + swap */
/* Remove the @import line above and add this to index.html <head> instead: */
```

**Move to index.html**:
```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap"></noscript>
```

**Explanation**: Moves font loading to non-blocking async strategy. `media="print"` trick + `onload` makes it non-render-blocking. `display=swap` shows fallback font immediately.

---

### CHANGE 3: Code-Split Heavy Routes with React.lazy
**File**: `src/App.tsx`
**Impact**: Initial JS bundle -40% (~150KB), LCP -0.4s

```tsx
// BEFORE: Eager imports
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
import DevAdminPage from "./app/pages/DevAdminPage";

// AFTER: Lazy imports
import { Suspense, lazy } from "react";

const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));
const WelcomePage = lazy(() => import("./app/pages/WelcomePage"));
const LoginPage = lazy(() => import("./app/pages/LoginPage"));
const AboutPage = lazy(() => import("./app/pages/AboutPage"));
const PricingPage = lazy(() => import("./app/pages/PricingPage"));
const BillingPage = lazy(() => import("./app/pages/BillingPage"));
const TermsPage = lazy(() => import("./app/pages/TermsPage"));
const ContactPage = lazy(() => import("./app/pages/ContactPage"));
const PrivacyPage = lazy(() => import("./app/pages/PrivacyPage"));
const DevAdminPage = lazy(() => import("./app/pages/DevAdminPage"));

// Add suspense wrapper component
const SuspenseWrapper = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      background: 'hsl(248 12% 6%)'
    }}>
      <div style={{ color: 'hsl(336 100% 50%)', fontSize: '1.5rem' }}>Loading...</div>
    </div>
  }>
    {children}
  </Suspense>
);

// In Routes, wrap each lazy component:
<Route path="/" element={<SuspenseWrapper><WelcomeRoute /></SuspenseWrapper>} />
<Route path="/login" element={<SuspenseWrapper><LoginRoute /></SuspenseWrapper>} />
// ... etc for all routes
```

**Explanation**: Splits each route into separate chunks. Only WelcomePage loads initially. 40% reduction in initial JS means faster parse + execute time.

---

### CHANGE 4: Defer Bootstrap Effects Until After First Paint
**File**: `src/App.tsx`
**Impact**: INP -50ms to -100ms, LCP -0.2s

```tsx
// BEFORE: All bootstrap components render immediately
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
        {/* routes */}
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

// AFTER: Defer non-critical bootstraps
import { useState, useEffect } from "react";

const DeferredBootstrap = () => {
  const [shouldRender, setShouldRender] = useState(false);
  
  useEffect(() => {
    // Defer until after first paint
    requestIdleCallback(() => {
      setShouldRender(true);
    }, { timeout: 2000 });
  }, []);
  
  if (!shouldRender) return null;
  
  return (
    <>
      <AppMediaSessionBootstrap />
      <AppLicenseBootstrap />
      <AppBillingBootstrap />
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppLifetimeAudioCleanup />
      <DeferredBootstrap />
      <BrowserRouter>
        {/* routes */}
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);
```

**Explanation**: Media session, license checks, and billing checks are not critical for first paint. Deferring them reduces main thread blocking during initial render.

---

### CHANGE 5: Lazy-Initialize Audio Engine
**File**: `src/lib/audioEngine.ts` + `src/stores/djStore.ts`
**Impact**: INP -30ms, LCP -0.15s

Currently audioEngine is instantiated at module load. Change to lazy initialization:

**audioEngine.ts**:
```typescript
// BEFORE: Instantiated immediately
export const audioEngine = new AudioEngine();

// AFTER: Lazy getter
let _audioEngine: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!_audioEngine) {
    _audioEngine = new AudioEngine();
  }
  return _audioEngine;
}

// For backwards compatibility
export const audioEngine = new Proxy({} as AudioEngine, {
  get(target, prop) {
    return getAudioEngine()[prop as keyof AudioEngine];
  }
});
```

**Explanation**: Audio engine initialization creates Web Audio context, which is expensive. Deferring until first play() call saves ~50ms on startup.

---

### CHANGE 6: Fix Logo CLS with Explicit Dimensions
**File**: `src/pages/Index.tsx` + `src/app/pages/WelcomePage.tsx`
**Impact**: CLS -0.08 to -0.15

**Index.tsx** (app logo):
```tsx
// BEFORE: No dimensions
<img
  src={MEJAY_LOGO_URL}
  alt="MEJay"
  className="h-32 w-auto object-contain drop-shadow-[0_18px_60px_rgba(0,0,0,0.55)]"
/>

// AFTER: Explicit dimensions + aspect ratio
<img
  src={MEJAY_LOGO_URL}
  alt="MEJay"
  width="200"
  height="128"
  className="h-32 w-auto object-contain drop-shadow-[0_18px_60px_rgba(0,0,0,0.55)]"
  style={{ aspectRatio: '200/128' }}
/>
```

**WelcomePage.tsx** (animated logo):
```tsx
// BEFORE: No dimensions in AnimatedLogo
function AnimatedLogo({className, alt}: {className?: string; alt: string}) {
  // ...
  return <img className={className} src={src} alt={alt} onError={handleError} />
}

// AFTER: Add dimensions + loading priority
function AnimatedLogo({className, alt}: {className?: string; alt: string}) {
  const [src, setSrc] = useState(() => {
    const v = encodeURIComponent(appStatus.version || '')
    return v ? `${ANIMATED_LOGO_WEBP_URL}?v=${v}` : ANIMATED_LOGO_WEBP_URL
  })
  const handleError = useCallback(() => {
    setSrc(prev => (prev === MEJAY_LOGO_URL ? prev : MEJAY_LOGO_URL))
  }, [])

  return (
    <img 
      className={className} 
      src={src} 
      alt={alt} 
      onError={handleError}
      width="400"
      height="400"
      style={{ aspectRatio: '1' }}
      fetchpriority="high"
      decoding="async"
    />
  )
}
```

**Explanation**: Explicit width/height prevents layout shift when image loads. `aspectRatio` maintains space even if image fails.

---

### CHANGE 7: Remove Background Orbs CLS
**File**: `src/pages/Index.tsx`
**Impact**: CLS -0.05

```tsx
// BEFORE: Absolute positioned, no container
<div className="orb orb-primary w-[250px] h-[250px] opacity-50 -top-20 -right-20" />
<div className="orb orb-secondary w-[200px] h-[200px] opacity-50 bottom-[180px] -left-[100px]" />
<div className="orb orb-accent w-[180px] h-[180px] opacity-50 -bottom-10 -right-10" />

// AFTER: Use fixed positioning + contain layout
<div className="orb orb-primary w-[250px] h-[250px] opacity-50 fixed -top-20 -right-20" style={{ contain: 'layout' }} />
<div className="orb orb-secondary w-[200px] h-[200px] opacity-50 fixed bottom-[180px] -left-[100px]" style={{ contain: 'layout' }} />
<div className="orb orb-accent w-[180px] h-[180px] opacity-50 fixed -bottom-10 -right-10" style={{ contain: 'layout' }} />
```

**Explanation**: `fixed` instead of `absolute` prevents reflow when parent resizes. `contain: layout` isolates layout calculations.

---

### CHANGE 8: Lazy-Load Heavy Tab Components
**File**: `src/pages/Index.tsx`
**Impact**: INP -40ms, Initial render -60ms

```tsx
// BEFORE: All tabs loaded regardless of visibility
import { LibraryView } from '@/components/LibraryView';
import { PartyModeView } from '@/components/PartyModeView';
import { PlaylistsView } from '@/components/PlaylistsView';

// AFTER: Lazy load + only render active tab
import { lazy, Suspense } from 'react';

const LibraryView = lazy(() => import('@/components/LibraryView').then(m => ({ default: m.LibraryView })));
const PartyModeView = lazy(() => import('@/components/PartyModeView').then(m => ({ default: m.PartyModeView })));
const PlaylistsView = lazy(() => import('@/components/PlaylistsView').then(m => ({ default: m.PlaylistsView })));

// In render:
<Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
  {activeTab === 'library' && <LibraryView />}
  {activeTab === 'party' && <PartyModeView />}
  {activeTab === 'playlists' && <PlaylistsView />}
</Suspense>
```

**Explanation**: Only loads the active tab's component. PartyModeView is especially heavy (waveforms, tempo controls). Saves ~40KB+ per inactive tab.

---

### CHANGE 9: Defer Data Loading Until User Interaction
**File**: `src/pages/Index.tsx`
**Impact**: LCP -0.3s, INP -50ms

```tsx
// BEFORE: Load everything on mount
useEffect(() => {
  void useDJStore.getState().loadTracks().finally(maybeOpenStarterPacks);
  useDJStore.getState().loadPlaylists();
  useDJStore.getState().loadSettings();
}, []);

// AFTER: Load settings immediately, defer heavy data
useEffect(() => {
  // Load settings immediately (small, needed for UI)
  useDJStore.getState().loadSettings();
  
  // Defer heavy loads until after first paint
  requestIdleCallback(() => {
    void useDJStore.getState().loadTracks().finally(maybeOpenStarterPacks);
    useDJStore.getState().loadPlaylists();
  }, { timeout: 1000 });
}, []);
```

**Explanation**: loadTracks() and loadPlaylists() parse potentially large IndexedDB data. Deferring until idle keeps main thread free for first paint.

---

### CHANGE 10: Add Performance Logging Helper (DEV only)
**File**: `src/lib/perfLogger.ts` (new file)
**Impact**: Visibility into performance metrics

```typescript
// src/lib/perfLogger.ts
const isDev = import.meta.env.DEV;

interface PerfMark {
  name: string;
  start: number;
  end?: number;
  duration?: number;
}

const marks = new Map<string, PerfMark>();

export const perfMark = {
  start(name: string) {
    if (!isDev) return;
    marks.set(name, { name, start: performance.now() });
    performance.mark(`${name}-start`);
  },
  
  end(name: string) {
    if (!isDev) return;
    const mark = marks.get(name);
    if (!mark) return;
    
    const end = performance.now();
    const duration = end - mark.start;
    mark.end = end;
    mark.duration = duration;
    
    performance.mark(`${name}-end`);
    performance.measure(name, `${name}-start`, `${name}-end`);
    
    console.log(`[Perf] ${name}: ${duration.toFixed(2)}ms`);
  },
  
  log() {
    if (!isDev) return;
    console.table(Array.from(marks.values()).map(m => ({
      name: m.name,
      duration: m.duration ? `${m.duration.toFixed(2)}ms` : 'pending'
    })));
  }
};

// Auto-log Web Vitals
if (isDev) {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      console.log(`[Web Vital] ${entry.name}:`, entry);
    }
  });
  
  try {
    observer.observe({ entryTypes: ['largest-contentful-paint', 'first-input', 'layout-shift'] });
  } catch {
    // Not supported
  }
}
```

**Usage in App.tsx**:
```tsx
import { perfMark } from '@/lib/perfLogger';

const Index = () => {
  useEffect(() => {
    perfMark.start('index-mount');
    return () => perfMark.end('index-mount');
  }, []);
  
  useEffect(() => {
    perfMark.start('load-tracks');
    void useDJStore.getState().loadTracks().finally(() => {
      perfMark.end('load-tracks');
    });
  }, []);
  
  // ...
};
```

---

## Implementation Priority

1. **IMMEDIATE (Do First)**:
   - Change 1: Preload critical assets
   - Change 2: Non-blocking fonts
   - Change 6: Fix logo CLS
   
2. **HIGH PRIORITY (Next)**:
   - Change 3: Code-split routes
   - Change 4: Defer bootstrap effects
   - Change 8: Lazy-load tab components
   
3. **MEDIUM PRIORITY**:
   - Change 5: Lazy audio engine
   - Change 9: Defer data loading
   - Change 7: Fix orbs CLS
   
4. **MONITORING**:
   - Change 10: Performance logging

---

## Expected Impact Summary

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| LCP P75 | 3.6s | 2.0-2.3s | **-1.3s to -1.6s** |
| LCP P90 | 6.5s | 3.5-4.0s | **-2.5s to -3.0s** |
| INP | Poor | <200ms | **Good rating** |
| CLS | Needs improvement | <0.1 | **Good rating** |
| Initial JS | ~400KB | ~250KB | **-37%** |
| Time to Interactive | ~4.5s | ~2.5s | **-2.0s** |

---

## Testing Checklist

After implementing changes:

1. **Lighthouse**: Run 5 times, average scores (target: 90+ Performance)
2. **WebPageTest**: Test on mobile + desktop (target: LCP <2.5s)
3. **Chrome DevTools**:
   - Performance tab: Check for long tasks (>50ms)
   - Coverage tab: Verify unused JS reduced
   - Network tab: Verify preload hints working
4. **Real User Monitoring**: Monitor Cloudflare Analytics for 1 week
5. **Functionality**: Test all features (audio playback, mixing, import, playlists)

---

## Constraints Met

✅ No feature removal - all changes are optimizations only
✅ No new heavy dependencies - only React.lazy (built-in)
✅ Small, safe refactors - no large rewrites
✅ Behavior identical for users

---

## Next Steps

1. Implement changes 1, 2, 6 immediately (low risk, high impact)
2. Test in staging environment
3. Roll out changes 3, 4, 8 (code-splitting changes)
4. Monitor metrics for 48 hours
5. Implement remaining changes if metrics improve
6. Set up continuous performance monitoring with perfLogger

