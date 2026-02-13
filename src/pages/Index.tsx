import { useState, useEffect } from 'react';
import { TabBar } from '@/components/TabBar';
import { LibraryView } from '@/components/LibraryView';
import { PartyModeView } from '@/components/PartyModeView';
import { PlaylistsView } from '@/components/PlaylistsView';
import { useDJStore } from '@/stores/djStore';
import { useSearchParams } from 'react-router-dom';
import { DevPlanSwitcher } from '@/components/DevPlanSwitcher';
import { UpgradeModal } from '@/components/UpgradeModal';
import { TopRightSettingsMenu } from '@/components/TopRightSettingsMenu';
import { cn } from '@/lib/utils';
import { MEJAY_LOGO_URL } from '@/lib/branding';
import { ENTITLEMENTS_CHANGED_EVENT } from '@/stores/planStore';
import { StarterPacksOnboardingModal } from '@/components/StarterPacksOnboardingModal';
import { consumeStarterPromptPending, readStarterPacksPrefs } from '@/lib/starterPacksPrefs';

type TabId = 'library' | 'party' | 'playlists';

const LAST_TAB_KEY = 'mejay:lastTab';

const Index = () => {
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as TabId | null;
  const [starterPacksOpen, setStarterPacksOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (tabFromUrl && ['library', 'party', 'playlists'].includes(tabFromUrl)) return tabFromUrl;
    try {
      const stored = sessionStorage.getItem(LAST_TAB_KEY) as TabId | null;
      if (stored && ['library', 'party', 'playlists'].includes(stored)) return stored;
    } catch {
      // ignore
    }
    return 'library';
  });

  // Initialize app data on mount only
  useEffect(() => {
    const maybeOpenStarterPacks = () => {
      const pending = consumeStarterPromptPending();
      if (!pending) return;

      const prefs = readStarterPacksPrefs();
      if (prefs.choiceMade) return;

      setStarterPacksOpen(true);
    };

    void useDJStore.getState().loadTracks().finally(maybeOpenStarterPacks);
    useDJStore.getState().loadPlaylists();
    useDJStore.getState().loadSettings();

    // If entitlements/plan changes after initial load (common on reload/login/upgrade),
    // ensure tempo presets/settings are applied to the engine immediately.
    const handleEntitlementsChanged = () => {
      useDJStore.getState().syncTempoNow({ reason: 'entitlements_changed' });
    };

    try {
      window.addEventListener(ENTITLEMENTS_CHANGED_EVENT, handleEntitlementsChanged as EventListener);
    } catch {
      // ignore
    }

    return () => {
      try {
        window.removeEventListener(ENTITLEMENTS_CHANGED_EVENT, handleEntitlementsChanged as EventListener);
      } catch {
        // ignore
      }
    };
  }, []);

  // Sync tab from URL
  useEffect(() => {
    if (tabFromUrl && ['library', 'party', 'playlists'].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  // Persist tab selection so refresh returns you to the same view.
  useEffect(() => {
    try {
      sessionStorage.setItem(LAST_TAB_KEY, activeTab);
    } catch {
      // ignore
    }
  }, [activeTab]);

  return (
    <div className="mejay-screen relative mejay-viewport flex flex-col">
      {/* Dev Plan Switcher */}
      <DevPlanSwitcher />

      {/* Settings Menu */}
      <TopRightSettingsMenu className="mejay-fixed-right" />

      {/* Upgrade Modal */}
      <UpgradeModal />

      {/* Starter Packs Onboarding */}
      <StarterPacksOnboardingModal open={starterPacksOpen} onOpenChange={setStarterPacksOpen} />

      {/* Background Orbs */}
      <div className="orb orb-primary w-[250px] h-[250px] opacity-50 -top-20 -right-20" />
      <div className="orb orb-secondary w-[200px] h-[200px] opacity-50 bottom-[180px] -left-[100px]" />
      <div className="orb orb-accent w-[180px] h-[180px] opacity-50 -bottom-10 -right-10" />

      {/* Main Content */}
      <div
        className={cn(
          'relative z-10 flex flex-col flex-1 min-h-0 px-5',
          // Reserve space for the fixed tab bar.
          activeTab === 'party'
            ? 'pt-3 overflow-visible md:overflow-hidden'
            : 'pt-14 overflow-visible md:overflow-hidden'
        )}
      >
        {/* Logo Header (hide in Party Mode to maximize usable viewport) */}
        {activeTab !== 'party' && (
          <div className="flex justify-center mb-3 flex-shrink-0">
            <img
              src={MEJAY_LOGO_URL}
              alt="MEJay"
              className="h-32 w-auto object-contain drop-shadow-[0_18px_60px_rgba(0,0,0,0.55)]"
            />
          </div>
        )}

        {/* Tab Content */}
        <div
          className={cn(
            'flex-1 min-h-0',
            // On phones, allow full-page scroll; on md+ keep panel-based scrolling.
            activeTab === 'party' ? 'overflow-visible md:overflow-hidden' : 'overflow-visible md:overflow-hidden'
          )}
        >
          {activeTab === 'library' && <LibraryView />}
          {activeTab === 'party' && <PartyModeView />}
          {activeTab === 'playlists' && <PlaylistsView />}
        </div>
      </div>

      {/* Tab Bar */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default Index;
