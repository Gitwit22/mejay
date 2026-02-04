import { create } from 'zustand';
import { Track, Settings, getAllTracks, getSettings, addTrack, updateTrack, deleteTrack, updateSettings, generateId, getAllPlaylists, Playlist, addPlaylist, updatePlaylist, deletePlaylist, PartySource } from '@/lib/db';
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
  partySource: PartySource | null;
  partyTrackIds: string[]; // The full list (doesn't shrink)
  nowPlayingIndex: number; // Current position in partyTrackIds
  pendingNextIndex: number | null; // For "Play Next" without immediate jump
  
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
  startPartyMode: (source: PartySource) => Promise<void>;
  stopPartyMode: () => void;
  triggerMixNow: () => void;
  setPartySource: (source: PartySource | null) => void;
  
  // Queue management (playlist-based)
  moveTrackInParty: (fromIndex: number, toIndex: number) => void;
  playNow: (index: number) => void;
  playNext: (index: number) => void;
  shufflePartyTracks: () => void;
  restartPlaylist: () => void;
  
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
  
  // Helper to get current party tracks
  getPartyTracks: () => Track[];
  getCurrentTrack: () => Track | undefined;
  getUpcomingTracks: () => Track[];
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
    if (state.isPartyMode) {
      const hasMore = state.nowPlayingIndex < state.partyTrackIds.length - 1;
      const canLoop = state.settings.loopPlaylist;
      if (hasMore || canLoop) {
        get().skip();
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
    partySource: null,
    partyTrackIds: [],
    nowPlayingIndex: 0,
    pendingNextIndex: null,
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
      autoVolumeMatch: true,
      targetLoudness: 0.7,
      limiterEnabled: true,
      limiterStrength: 'medium',
      loopPlaylist: true,
    },
    crossfadeValue: 0,

    loadTracks: async () => {
      set({ isLoadingTracks: true });
      try {
        console.log('[DJ Store] Loading tracks from IndexedDB...');
        const tracks = await getAllTracks();
        console.log('[DJ Store] Loaded tracks:', tracks.length);
        set({ tracks, isLoadingTracks: false });
      } catch (error) {
        console.error('[DJ Store] Failed to load tracks:', error);
        set({ isLoadingTracks: false });
      }
    },

    loadPlaylists: async () => {
      const playlists = await getAllPlaylists();
      set({ playlists });
    },

    loadSettings: async () => {
      const settings = await getSettings();
      set({ settings });
      // Apply limiter settings
      audioEngine.setLimiterEnabled(settings.limiterEnabled);
      audioEngine.setLimiterStrength(settings.limiterStrength);
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
          
          // Also analyze loudness if auto volume match is enabled
          let loudnessDb: number | undefined;
          let gainDb: number | undefined;
          
          const settings = get().settings;
          if (settings.autoVolumeMatch) {
            try {
              const loudnessResult = await audioEngine.analyzeLoudness(file);
              loudnessDb = loudnessResult.loudnessDb;
              // Adjust gain based on target loudness setting (0-1 scale)
              // targetLoudness 0 = -20dB, 1 = -8dB
              const targetDb = -20 + (settings.targetLoudness * 12);
              gainDb = audioEngine.calculateGain(loudnessResult.loudnessDb, targetDb);
            } catch (e) {
              console.error('Loudness analysis failed:', e);
            }
          }
          
          const updates = {
            bpm,
            hasBeat,
            analysisStatus: (hasBeat ? 'ready' : 'basic') as 'ready' | 'basic',
            loudnessDb,
            gainDb,
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

      // Apply track gain if auto volume match is enabled
      const gainDb = state.settings.autoVolumeMatch ? track.gainDb : undefined;
      
      const duration = await audioEngine.loadTrack(deck, track.fileBlob, track.bpm, gainDb);
      
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
      const { partyTrackIds, nowPlayingIndex, pendingNextIndex, settings, activeDeck, tracks } = state;
      
      // Determine next index
      let nextIndex: number;
      
      if (pendingNextIndex !== null) {
        nextIndex = pendingNextIndex;
        set({ pendingNextIndex: null });
      } else if (settings.shuffleEnabled) {
        // Random from remaining tracks
        const remaining = partyTrackIds.length - nowPlayingIndex - 1;
        if (remaining <= 0) {
          if (settings.loopPlaylist) {
            nextIndex = 0;
          } else {
            get().stopPartyMode();
            return;
          }
        } else {
          nextIndex = nowPlayingIndex + 1 + Math.floor(Math.random() * remaining);
        }
      } else {
        nextIndex = nowPlayingIndex + 1;
      }
      
      // Check bounds
      if (nextIndex >= partyTrackIds.length) {
        if (settings.loopPlaylist) {
          nextIndex = 0;
        } else {
          get().stopPartyMode();
          return;
        }
      }

      const nextTrackId = partyTrackIds[nextIndex];
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

      // Get track gain for volume matching
      const gainDb = settings.autoVolumeMatch ? nextTrack.gainDb : undefined;

      // Load next track with offset
      audioEngine.loadTrackWithOffset(
        nextDeck,
        nextTrack.fileBlob,
        settings.nextSongStartOffset,
        nextTrack.bpm,
        gainDb
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
            nowPlayingIndex: nextIndex,
          });
        }, settings.crossfadeSeconds * 1000);
        
        audioEngine.crossfade(settings.crossfadeSeconds);
      });
    },

    startPartyMode: async (source: PartySource) => {
      const state = get();
      
      let trackIds: string[];
      if (source.type === 'import') {
        trackIds = state.tracks.map(t => t.id);
      } else if (source.type === 'playlist' && source.playlistId) {
        const playlist = state.playlists.find(p => p.id === source.playlistId);
        trackIds = playlist?.trackIds || [];
      } else {
        return;
      }
      
      if (state.settings.shuffleEnabled) {
        trackIds = [...trackIds].sort(() => Math.random() - 0.5);
      }

      if (trackIds.length === 0) return;

      const firstTrackId = trackIds[0];
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
        partySource: source,
        partyTrackIds: trackIds,
        nowPlayingIndex: 0,
        pendingNextIndex: null,
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
      set({ 
        isPartyMode: false, 
        partyTrackIds: [], 
        nowPlayingIndex: 0,
        pendingNextIndex: null,
      });
    },

    triggerMixNow: () => {
      const state = get();
      if (state.isPartyMode) {
        const hasMore = state.nowPlayingIndex < state.partyTrackIds.length - 1;
        const canLoop = state.settings.loopPlaylist;
        if (hasMore || canLoop) {
          get().skip();
        }
      }
    },

    setPartySource: (source: PartySource | null) => {
      set({ partySource: source });
    },

    // Queue management (playlist-based)
    moveTrackInParty: (fromIndex: number, toIndex: number) => {
      set(state => {
        const newTrackIds = [...state.partyTrackIds];
        const [removed] = newTrackIds.splice(fromIndex, 1);
        newTrackIds.splice(toIndex, 0, removed);
        
        // Adjust nowPlayingIndex if needed
        let newNowPlayingIndex = state.nowPlayingIndex;
        if (fromIndex === state.nowPlayingIndex) {
          newNowPlayingIndex = toIndex;
        } else if (fromIndex < state.nowPlayingIndex && toIndex >= state.nowPlayingIndex) {
          newNowPlayingIndex--;
        } else if (fromIndex > state.nowPlayingIndex && toIndex <= state.nowPlayingIndex) {
          newNowPlayingIndex++;
        }
        
        return { 
          partyTrackIds: newTrackIds,
          nowPlayingIndex: newNowPlayingIndex,
        };
      });
    },

    playNow: (index: number) => {
      const state = get();
      if (index < 0 || index >= state.partyTrackIds.length) return;
      
      // Set pending next and trigger skip immediately
      set({ pendingNextIndex: index });
      get().skip();
    },

    playNext: (index: number) => {
      // Set this track to play after current track ends
      set({ pendingNextIndex: index });
    },

    shufflePartyTracks: () => {
      set(state => {
        // Keep current track, shuffle the rest
        const currentTrackId = state.partyTrackIds[state.nowPlayingIndex];
        const beforeCurrent = state.partyTrackIds.slice(0, state.nowPlayingIndex);
        const afterCurrent = state.partyTrackIds.slice(state.nowPlayingIndex + 1);
        
        const shuffled = [...afterCurrent].sort(() => Math.random() - 0.5);
        
        return {
          partyTrackIds: [...beforeCurrent, currentTrackId, ...shuffled],
        };
      });
    },

    restartPlaylist: () => {
      const state = get();
      if (state.partyTrackIds.length === 0) return;
      
      set({ pendingNextIndex: 0 });
      get().skip();
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
      
      // Apply audio engine settings
      if (updates.limiterEnabled !== undefined) {
        audioEngine.setLimiterEnabled(updates.limiterEnabled);
      }
      if (updates.limiterStrength !== undefined) {
        audioEngine.setLimiterStrength(updates.limiterStrength);
      }
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

    // Helper methods
    getPartyTracks: () => {
      const state = get();
      return state.partyTrackIds
        .map(id => state.tracks.find(t => t.id === id))
        .filter(Boolean) as Track[];
    },

    getCurrentTrack: () => {
      const state = get();
      const currentTrackId = state.partyTrackIds[state.nowPlayingIndex];
      return state.tracks.find(t => t.id === currentTrackId);
    },

    getUpcomingTracks: () => {
      const state = get();
      return state.partyTrackIds
        .slice(state.nowPlayingIndex + 1)
        .map(id => state.tracks.find(t => t.id === id))
        .filter(Boolean) as Track[];
    },
  };
});
