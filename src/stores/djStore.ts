import { create } from 'zustand';
import { Track, Settings, getAllTracks, getSettings, addTrack, updateTrack, deleteTrack, updateSettings, generateId, getAllPlaylists, Playlist, addPlaylist, updatePlaylist, deletePlaylist } from '@/lib/db';
import { audioEngine, DeckId, ScratchType } from '@/lib/audioEngine';
import { analyzeBPM } from '@/lib/bpmDetector';

interface DeckState {
  trackId: string | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
}

interface DJState {
  // Tracks
  tracks: Track[];
  isLoadingTracks: boolean;
  
  // Playlists
  playlists: Playlist[];
  
  // Deck states
  deckA: DeckState;
  deckB: DeckState;
  activeDeck: DeckId;
  
  // Party mode
  isPartyMode: boolean;
  queue: string[];
  history: string[];
  
  // Settings
  settings: Settings;
  
  // Crossfade
  crossfadeValue: number;
  
  // Actions
  loadTracks: () => Promise<void>;
  loadPlaylists: () => Promise<void>;
  loadSettings: () => Promise<void>;
  importTracks: (files: FileList) => Promise<void>;
  deleteTrackById: (id: string) => Promise<void>;
  
  // Playback
  loadTrackToDeck: (trackId: string, deck: DeckId) => Promise<void>;
  play: (deck?: DeckId) => void;
  pause: (deck?: DeckId) => void;
  togglePlayPause: (deck?: DeckId) => void;
  seek: (deck: DeckId, time: number) => void;
  skip: () => void;
  
  // Party mode
  startPartyMode: (trackIds?: string[]) => Promise<void>;
  stopPartyMode: () => void;
  triggerMixNow: () => void;
  
  // Queue management
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  playNext: (trackId: string) => void;
  removeFromQueue: (trackId: string) => void;
  shuffleQueue: () => void;
  clearQueue: () => void;
  
  // Mixing
  setCrossfade: (value: number) => void;
  setTempo: (deck: DeckId, ratio: number) => void;
  
  // Scratching
  performScratch: (type: ScratchType) => void;
  
  // Settings
  updateUserSettings: (updates: Partial<Settings>) => Promise<void>;
  
  // Playlists
  createPlaylist: (name: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  deletePlaylistById: (id: string) => Promise<void>;
}

const initialDeckState: DeckState = {
  trackId: null,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  playbackRate: 1,
};

export const useDJStore = create<DJState>((set, get) => {
  // Set up audio engine callbacks
  audioEngine.setOnTimeUpdate((deck, time) => {
    if (deck === 'A') {
      set(state => ({ deckA: { ...state.deckA, currentTime: time } }));
    } else {
      set(state => ({ deckB: { ...state.deckB, currentTime: time } }));
    }
  });

  audioEngine.setOnTrackEnd((deck) => {
    const state = get();
    if (state.isPartyMode) {
      // Auto-advance to next track
      get().skip();
    } else {
      if (deck === 'A') {
        set(state => ({ deckA: { ...state.deckA, isPlaying: false, currentTime: 0 } }));
      } else {
        set(state => ({ deckB: { ...state.deckB, isPlaying: false, currentTime: 0 } }));
      }
    }
  });

  // Set up mix trigger callback for auto-mixing
  audioEngine.setOnMixTrigger(() => {
    const state = get();
    if (state.isPartyMode && state.queue.length > 0) {
      get().skip();
    }
  });

  return {
    tracks: [],
    isLoadingTracks: true,
    playlists: [],
    deckA: { ...initialDeckState },
    deckB: { ...initialDeckState },
    activeDeck: 'A',
    isPartyMode: false,
    queue: [],
    history: [],
    settings: {
      crossfadeSeconds: 8,
      maxTempoPercent: 6,
      energyMode: 'normal',
      shuffleEnabled: false,
      nextSongStartOffset: 0,
      mixTriggerMode: 'remaining',
      mixTriggerSeconds: 20,
      tempoMode: 'auto',
      lockedBpm: 128,
      scratchQuantize: '1/4',
      scratchIntensity: 0.5,
    },
    crossfadeValue: 0,

    loadTracks: async () => {
      set({ isLoadingTracks: true });
      const tracks = await getAllTracks();
      set({ tracks, isLoadingTracks: false });
    },

    loadPlaylists: async () => {
      const playlists = await getAllPlaylists();
      set({ playlists });
    },

    loadSettings: async () => {
      const settings = await getSettings();
      set({ settings });
    },

    importTracks: async (files: FileList) => {
      const supportedTypes = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-m4a'];
      
      for (const file of Array.from(files)) {
        if (!supportedTypes.some(type => file.type.includes(type.split('/')[1]))) {
          continue;
        }

        const id = generateId();
        const track: Track = {
          id,
          localPath: file.name,
          displayName: file.name.replace(/\.[^/.]+$/, ''),
          duration: 0,
          bpm: undefined,
          hasBeat: false,
          analysisStatus: 'pending',
          fileBlob: file,
          addedAt: Date.now(),
        };

        // Try to get duration
        try {
          const audioContext = new AudioContext();
          const arrayBuffer = await file.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          track.duration = audioBuffer.duration;
          audioContext.close();
        } catch (e) {
          console.error('Failed to decode audio:', e);
        }

        await addTrack(track);
        set(state => ({ tracks: [...state.tracks, track] }));

        // Start BPM analysis in background
        set(state => ({
          tracks: state.tracks.map(t =>
            t.id === id ? { ...t, analysisStatus: 'analyzing' as const } : t
          ),
        }));

        try {
          const { bpm, hasBeat } = await analyzeBPM(file);
          const updates = {
            bpm,
            hasBeat,
            analysisStatus: (hasBeat ? 'ready' : 'basic') as 'ready' | 'basic',
          };
          
          await updateTrack(id, updates);
          set(state => ({
            tracks: state.tracks.map(t =>
              t.id === id ? { ...t, ...updates } : t
            ),
          }));
        } catch (e) {
          console.error('BPM analysis failed:', e);
          await updateTrack(id, { analysisStatus: 'basic' });
          set(state => ({
            tracks: state.tracks.map(t =>
              t.id === id ? { ...t, analysisStatus: 'basic' as const } : t
            ),
          }));
        }
      }
    },

    deleteTrackById: async (id: string) => {
      await deleteTrack(id);
      set(state => ({ tracks: state.tracks.filter(t => t.id !== id) }));
    },

    loadTrackToDeck: async (trackId: string, deck: DeckId) => {
      const state = get();
      const track = state.tracks.find(t => t.id === trackId);
      if (!track?.fileBlob) return;

      const duration = await audioEngine.loadTrack(deck, track.fileBlob, track.bpm);
      
      // Set base BPM for tempo matching
      if (track.bpm) {
        audioEngine.setBaseBpm(deck, track.bpm);
      }
      
      if (deck === 'A') {
        set({ deckA: { ...initialDeckState, trackId, duration } });
      } else {
        set({ deckB: { ...initialDeckState, trackId, duration } });
      }
    },

    play: (deck?: DeckId) => {
      const targetDeck = deck || get().activeDeck;
      audioEngine.play(targetDeck);
      
      if (targetDeck === 'A') {
        set(state => ({ deckA: { ...state.deckA, isPlaying: true }, activeDeck: 'A' }));
      } else {
        set(state => ({ deckB: { ...state.deckB, isPlaying: true }, activeDeck: 'B' }));
      }
    },

    pause: (deck?: DeckId) => {
      const targetDeck = deck || get().activeDeck;
      audioEngine.pause(targetDeck);
      
      if (targetDeck === 'A') {
        set(state => ({ deckA: { ...state.deckA, isPlaying: false } }));
      } else {
        set(state => ({ deckB: { ...state.deckB, isPlaying: false } }));
      }
    },

    togglePlayPause: (deck?: DeckId) => {
      const targetDeck = deck || get().activeDeck;
      const deckState = targetDeck === 'A' ? get().deckA : get().deckB;
      
      if (deckState.isPlaying) {
        get().pause(targetDeck);
      } else {
        get().play(targetDeck);
      }
    },

    seek: (deck: DeckId, time: number) => {
      audioEngine.seek(deck, time);
      if (deck === 'A') {
        set(state => ({ deckA: { ...state.deckA, currentTime: time } }));
      } else {
        set(state => ({ deckB: { ...state.deckB, currentTime: time } }));
      }
    },

    skip: () => {
      const state = get();
      const { queue, settings, activeDeck, tracks } = state;
      
      if (queue.length === 0) {
        get().stopPartyMode();
        return;
      }

      const nextTrackId = queue[0];
      const nextTrack = tracks.find(t => t.id === nextTrackId);
      const nextDeck = activeDeck === 'A' ? 'B' : 'A';
      const currentDeck = activeDeck;
      const currentDeckState = activeDeck === 'A' ? state.deckA : state.deckB;
      const currentTrack = tracks.find(t => t.id === currentDeckState.trackId);

      if (!nextTrack?.fileBlob) return;

      // Calculate target BPM
      let targetBpm: number;
      if (settings.tempoMode === 'locked') {
        targetBpm = settings.lockedBpm;
      } else {
        targetBpm = currentTrack?.bpm || 120;
      }

      // Load next track with offset
      audioEngine.loadTrackWithOffset(
        nextDeck,
        nextTrack.fileBlob,
        settings.nextSongStartOffset,
        nextTrack.bpm
      ).then((duration) => {
        // Match tempo BEFORE the mix is audible
        audioEngine.matchTempo(targetBpm, settings.maxTempoPercent);

        if (nextDeck === 'A') {
          set({ deckA: { ...initialDeckState, trackId: nextTrackId, duration } });
        } else {
          set({ deckB: { ...initialDeckState, trackId: nextTrackId, duration } });
        }

        // Start playback and crossfade
        get().play(nextDeck);
        
        setTimeout(() => {
          get().pause(currentDeck);
          audioEngine.resetMixTrigger();
          set({ 
            activeDeck: nextDeck, 
            queue: queue.slice(1),
            history: [currentDeckState.trackId!, ...state.history].slice(0, 50)
          });
        }, settings.crossfadeSeconds * 1000);
        
        audioEngine.crossfade(settings.crossfadeSeconds);
      });
    },

    startPartyMode: async (trackIds?: string[]) => {
      const state = get();
      let queue = trackIds || state.tracks.map(t => t.id);
      
      if (state.settings.shuffleEnabled) {
        queue = [...queue].sort(() => Math.random() - 0.5);
      }

      if (queue.length === 0) return;

      const firstTrackId = queue[0];
      const firstTrack = state.tracks.find(t => t.id === firstTrackId);
      
      await get().loadTrackToDeck(firstTrackId, 'A');
      
      // Apply locked tempo if set
      if (state.settings.tempoMode === 'locked' && firstTrack?.bpm) {
        const ratio = audioEngine.calculateTempoRatio('A', state.settings.lockedBpm, state.settings.maxTempoPercent);
        audioEngine.setTempo('A', ratio);
      }

      // Configure mix trigger
      audioEngine.setMixTriggerConfig(state.settings.mixTriggerMode, state.settings.mixTriggerSeconds);
      audioEngine.enableMixCheck(state.settings.mixTriggerMode !== 'manual');
      
      set({
        isPartyMode: true,
        queue: queue.slice(1),
        history: [],
        activeDeck: 'A',
        crossfadeValue: 0,
      });
      
      audioEngine.setCrossfade(0);
      get().play('A');
    },

    stopPartyMode: () => {
      get().pause('A');
      get().pause('B');
      audioEngine.enableMixCheck(false);
      set({ isPartyMode: false, queue: [], history: [] });
    },

    triggerMixNow: () => {
      const state = get();
      if (state.isPartyMode && state.queue.length > 0) {
        get().skip();
      }
    },

    // Queue management
    moveQueueItem: (fromIndex: number, toIndex: number) => {
      set(state => {
        const newQueue = [...state.queue];
        const [removed] = newQueue.splice(fromIndex, 1);
        newQueue.splice(toIndex, 0, removed);
        return { queue: newQueue };
      });
    },

    playNext: (trackId: string) => {
      set(state => {
        const newQueue = state.queue.filter(id => id !== trackId);
        return { queue: [trackId, ...newQueue] };
      });
    },

    removeFromQueue: (trackId: string) => {
      set(state => ({
        queue: state.queue.filter(id => id !== trackId)
      }));
    },

    shuffleQueue: () => {
      set(state => ({
        queue: [...state.queue].sort(() => Math.random() - 0.5)
      }));
    },

    clearQueue: () => {
      set({ queue: [] });
    },

    setCrossfade: (value: number) => {
      audioEngine.setCrossfade(value);
      set({ crossfadeValue: value });
    },

    setTempo: (deck: DeckId, ratio: number) => {
      audioEngine.setTempo(deck, ratio);
      if (deck === 'A') {
        set(state => ({ deckA: { ...state.deckA, playbackRate: ratio } }));
      } else {
        set(state => ({ deckB: { ...state.deckB, playbackRate: ratio } }));
      }
    },

    performScratch: (type: ScratchType) => {
      const state = get();
      audioEngine.performScratch(state.activeDeck, type, state.settings.scratchIntensity);
    },

    updateUserSettings: async (updates: Partial<Settings>) => {
      await updateSettings(updates);
      set(state => ({ settings: { ...state.settings, ...updates } }));
    },

    createPlaylist: async (name: string) => {
      const playlist: Playlist = {
        id: generateId(),
        name,
        trackIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await addPlaylist(playlist);
      set(state => ({ playlists: [...state.playlists, playlist] }));
    },

    addTrackToPlaylist: async (playlistId: string, trackId: string) => {
      const playlist = get().playlists.find(p => p.id === playlistId);
      if (!playlist) return;
      
      if (!playlist.trackIds.includes(trackId)) {
        const newTrackIds = [...playlist.trackIds, trackId];
        await updatePlaylist(playlistId, { trackIds: newTrackIds });
        set(state => ({
          playlists: state.playlists.map(p =>
            p.id === playlistId ? { ...p, trackIds: newTrackIds } : p
          ),
        }));
      }
    },

    removeTrackFromPlaylist: async (playlistId: string, trackId: string) => {
      const playlist = get().playlists.find(p => p.id === playlistId);
      if (!playlist) return;
      
      const newTrackIds = playlist.trackIds.filter(id => id !== trackId);
      await updatePlaylist(playlistId, { trackIds: newTrackIds });
      set(state => ({
        playlists: state.playlists.map(p =>
          p.id === playlistId ? { ...p, trackIds: newTrackIds } : p
        ),
      }));
    },

    deletePlaylistById: async (id: string) => {
      await deletePlaylist(id);
      set(state => ({ playlists: state.playlists.filter(p => p.id !== id) }));
    },
  };
});
