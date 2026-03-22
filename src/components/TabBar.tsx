import { Music, Play, ListMusic, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

type TabId = 'library' | 'playlists' | 'import' | 'party';

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: typeof Music }[] = [
  { id: 'library', label: 'My Music', icon: Music },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'import', label: 'Import', icon: Upload },
  { id: 'party', label: 'Live Room', icon: Play },
];

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <nav className="tab-bar">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex flex-col items-center gap-1 text-[10px] cursor-pointer transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-muted-foreground/80'
            )}
          >
            <Icon className="w-6 h-6" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
