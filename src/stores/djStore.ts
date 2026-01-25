import { create } from 'zustand';
import { Track, Settings, getAllTracks, getSettings, addTrack, updateTrack, deleteTrack, updateSettings, generateId, getAllPlaylists, Playlist, addPlaylist, updatePlaylist, deletePlaylist } from '@/lib/db';
import { audioEngine, DeckId } from '@/lib/audioEngine';
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
  
  // Mixing
  setCrossfade: (value: number) => void;
  setTempo: (deck: DeckId, ratio: number) => void;
  
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

  return {
    tracks: [],
    isLoadingTracks: true,
    playlists: [],
    deckA: { ...initialDeckState },
    deckB: { ...initialDeckState },
    activeDeck: 'A',
    isPartyMode: false,
    queue: [],
    settings: {
      crossfadeSeconds: 8,
      maxTempoPercent: 6,
      energyMode: 'normal',
      shuffleEnabled: false,
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
      const track = get().tracks.find(t => t.id === trackId);
      if (!track?.fileBlob) return;

      const duration = await audioEngine.loadTrack(deck, track.fileBlob);
      
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
        // If queue is empty, stop party mode
        get().stopPartyMode();
        return;
      }

      const nextTrackId = queue[0];
      const nextDeck = activeDeck === 'A' ? 'B' : 'A';
      const currentDeck = activeDeck;

      // Load next track to opposite deck
      get().loadTrackToDeck(nextTrackId, nextDeck).then(() => {
        // Start crossfade
        get().play(nextDeck);
        
        setTimeout(() => {
          get().pause(currentDeck);
          set({ activeDeck: nextDeck, queue: queue.slice(1) });
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
      await get().loadTrackToDeck(firstTrackId, 'A');
      
      set({
        isPartyMode: true,
        queue: queue.slice(1),
        activeDeck: 'A',
        crossfadeValue: 0,
      });
      
      audioEngine.setCrossfade(0);
      get().play('A');
    },

    stopPartyMode: () => {
      get().pause('A');
      get().pause('B');
      set({ isPartyMode: false, queue: [] });
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
