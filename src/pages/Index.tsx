import { useState, useEffect } from 'react';
import { TabBar } from '@/components/TabBar';
import { LibraryView } from '@/components/LibraryView';
import { PartyModeView } from '@/components/PartyModeView';
import { PlaylistsView } from '@/components/PlaylistsView';
import { useDJStore } from '@/stores/djStore';
import logo from '@/assets/me-jay-logo.png';
import { useSearchParams } from 'react-router-dom';

type TabId = 'library' | 'party' | 'playlists';

const Index = () => {
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(tabFromUrl || 'party');

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

  return (
    <div className="min-h-screen min-h-[100dvh] relative overflow-hidden">
      {/* Background Orbs */}
      <div className="orb orb-primary w-[250px] h-[250px] opacity-50 -top-20 -right-20" />
      <div className="orb orb-secondary w-[200px] h-[200px] opacity-50 bottom-[180px] -left-[100px]" />
      <div className="orb orb-accent w-[180px] h-[180px] opacity-50 -bottom-10 -right-10" />

      {/* Main Content */}
      <div className="relative z-10 px-5 pt-14 pb-[100px] h-screen h-[100dvh] overflow-y-auto">
        {/* Logo Header */}
        <div className="flex justify-center mb-2">
          <img src={logo} alt="ME Jay" className="h-16 w-auto" />
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
