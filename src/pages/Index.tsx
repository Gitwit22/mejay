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

type TabId = 'library' | 'party' | 'playlists';

const LAST_TAB_KEY = 'mejay:lastTab';

const Index = () => {
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (tabFromUrl && ['library', 'party', 'playlists'].includes(tabFromUrl)) return tabFromUrl;
    try {
      const stored = localStorage.getItem(LAST_TAB_KEY) as TabId | null;
      if (stored && ['library', 'party', 'playlists'].includes(stored)) return stored;
    } catch {
      // ignore
    }
    return 'library';
  });

  // Initialize app data on mount only
  useEffect(() => {
    useDJStore.getState().loadTracks();
    useDJStore.getState().loadPlaylists();
    useDJStore.getState().loadSettings();
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
      localStorage.setItem(LAST_TAB_KEY, activeTab);
    } catch {
      // ignore
    }
  }, [activeTab]);

  return (
    <div className="min-h-[100dvh] relative overflow-hidden mejay-viewport">
      {/* Dev Plan Switcher */}
      <DevPlanSwitcher />

      {/* Settings Menu */}
      <TopRightSettingsMenu className="mejay-fixed-right" />

      {/* Upgrade Modal */}
      <UpgradeModal />

      {/* Background Orbs */}
      <div className="orb orb-primary w-[250px] h-[250px] opacity-50 -top-20 -right-20" />
      <div className="orb orb-secondary w-[200px] h-[200px] opacity-50 bottom-[180px] -left-[100px]" />
      <div className="orb orb-accent w-[180px] h-[180px] opacity-50 -bottom-10 -right-10" />

      {/* Main Content */}
      <div className="relative z-10 px-5 pt-14 pb-[100px] h-[100dvh] overflow-y-auto">
        {/* Logo Header */}
        <div className="flex justify-center mb-2">
          <div className="inline-flex rounded-2xl border border-white/10 bg-transparent p-3 shadow-[0_18px_60px_rgba(0,0,0,0.55)]">
            <img src="/image.jpg" alt="MEJay" className="h-16 w-auto object-contain" />
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'library' && <LibraryView />}
        {activeTab === 'party' && <PartyModeView />}
        {activeTab === 'playlists' && <PlaylistsView />}
      </div>

      {/* Tab Bar */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default Index;
