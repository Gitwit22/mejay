import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Track, Settings, getAllTracks, getSettings, addTrack, updateTrack, deleteTrack, updateSettings, generateId, getAllPlaylists, Playlist, addPlaylist, updatePlaylist, deletePlaylist, PartySource, resetLocalDatabase } from '@/lib/db';
import { audioEngine, DeckId } from '@/lib/audioEngine';
import { analyzeBPM } from '@/lib/bpmDetector';
// Note: Energy Mode automation removed; mixing uses manual sliders only.
import { usePlanStore } from '@/stores/planStore';
import { toast } from '@/hooks/use-toast';

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

  // Pending smooth source switch (applied after the mix completes)
  pendingSourceSwitch: { source: PartySource; trackIds: string[] } | null;

  // If user changes source while a mix is running, queue it.
  queuedSourceSwitch: PartySource | null;
  
  // Settings
  settings: Settings;
  
  // Crossfade
  crossfadeValue: number;

  // Internal guard to prevent overlapping mixes
  mixInProgress: boolean;
  
  // Actions
  loadTracks: () => Promise<void>;
  loadPlaylists: () => Promise<void>;
  loadSettings: () => Promise<void>;
  importTracks: (files: FileList) => Promise<void>;
  deleteTrackById: (id: string) => Promise<void>;

  // Removal semantics (Library / Playlist / Current Source)
  removeFromLibrary: (trackId: string, opts?: {reason?: 'user' | 'sync'}) => Promise<void>;
  removeFromPlaylist: (playlistId: string, trackId: string, opts?: {emit?: boolean}) => Promise<void>;
  removeFromCurrentSource: (trackId: string, opts?: {emit?: boolean}) => Promise<void>;
  
  // Playback
  loadTrackToDeck: (trackId: string, deck: DeckId, offsetSeconds?: number) => Promise<void>;
  play: (deck?: DeckId) => void;
  pause: (deck?: DeckId) => void;
  togglePlayPause: (deck?: DeckId) => void;
  seek: (deck: DeckId, time: number) => void;
  restartCurrentTrack: (deck?: DeckId) => void;
  smartBack: (deck?: DeckId) => void;
  playPreviousTrack: (deck?: DeckId) => Promise<void>;
  skip: (reason?: 'user' | 'auto' | 'end' | 'switch') => void;
  
  // Party mode
  startPartyMode: (source: PartySource) => Promise<void>;
  stopPartyMode: () => void;
  triggerMixNow: () => void;
  setPartySource: (source: PartySource | null) => void;
  switchPartySourceSmooth: (source: PartySource) => Promise<void>;
  saveCurrentPartyAsPlaylist: (name: string) => Promise<string | null>;
  
  // Queue management (playlist-based)
  moveTrackInParty: (fromIndex: number, toIndex: number) => void;
  playNow: (index: number) => void;
  playNext: (index: number) => void;
  shufflePartyTracks: () => void;
  restartPlaylist: () => void;
  
  // Mixing
  setCrossfade: (value: number) => void;
  setTempo: (deck: DeckId, ratio: number) => void;

  // Master output
  setMasterVolume: (value: number) => void;
  
  // Settings
  updateUserSettings: (updates: Partial<Settings>) => Promise<void>;

  // Local data reset
  resetLocalData: () => Promise<void>;
  
  // Playlists
  createPlaylist: (name: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderPlaylistTracks: (playlistId: string, fromIndex: number, toIndex: number) => Promise<void>;
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

const getDjSessionStorage = () => {
  try {
    return sessionStorage;
  } catch {
    return undefined;
  }
};

const djStoreNoopStorage = {
  getItem: (_name: string) => null,
  setItem: (_name: string, _value: string) => {
    // noop
  },
  removeItem: (_name: string) => {
    // noop
  },
};

export const useDJStore = create<DJState>()(
  persist(
    (set, get) => {
  let scheduledTimeouts: number[] = [];
  let masterVolumeSaveTimeout: number | null = null;
  let settingsSaveTimeout: number | null = null;
  let queuedSettingsUpdates: Partial<Settings> = {};

  const FREE_UPLOAD_LIMIT_SECONDS = 30 * 60;
  // Allow a little overage for a single additional track.
  const FREE_UPLOAD_OVERAGE_MAX_SECONDS = 8 * 60;

  const clearScheduledTimeouts = () => {
    for (const id of scheduledTimeouts) {
      clearTimeout(id);
    }
    scheduledTimeouts = [];
  };

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const lockTolerancePctToAllowedDriftBpm = (pctRaw: number | undefined | null): number => {
    const pct = clamp(Number.isFinite(pctRaw as number) ? (pctRaw as number) : 10, 0, 100);
    // Piecewise mapping aligned with the product spec examples:
    // 0 -> 0.0 BPM
    // 5 -> 0.2 BPM
    // 10 -> 0.5 BPM
    // 20 -> 1.0 BPM
    // 30 -> 2.0 BPM
    // 100 -> 4.0 BPM
    if (pct <= 0) return 0;
    if (pct <= 5) return (pct / 5) * 0.2;
    if (pct <= 10) return 0.2 + ((pct - 5) / 5) * 0.3;
    if (pct <= 20) return 0.5 + ((pct - 10) / 10) * 0.5;
    if (pct <= 30) return 1.0 + ((pct - 20) / 10) * 1.0;
    return 2.0 + ((pct - 30) / 70) * 2.0;
  };

  const lastLockCorrectionAtCtx: Record<DeckId, number> = { A: -Infinity, B: -Infinity };
  const maybeCorrectTempoLockDrift = (deck: DeckId) => {
    const state = get();
    if (state.settings.tempoMode !== 'locked') return;
    if (!audioEngine.isPlaying(deck)) return;

    const ctxNow = audioEngine.getAudioContextTime();
    if (ctxNow === null) return;

    // Don't fight scheduled ramps (mixing, user actions, etc).
    if (audioEngine.isTempoRamping(deck, ctxNow)) return;

    // Throttle corrections.
    if (ctxNow - lastLockCorrectionAtCtx[deck] < 0.75) return;

    const targetBpm = state.settings.lockedBpm;
    if (!Number.isFinite(targetBpm) || targetBpm <= 0) return;

    const baseBpm = audioEngine.getBaseBpm(deck) || 120;
    const effectiveRate = Math.max(0.25, audioEngine.getEffectiveTempo(deck, ctxNow) || 1);
    const currentBpm = baseBpm * effectiveRate;

    const allowedDrift = lockTolerancePctToAllowedDriftBpm(state.settings.lockTolerancePct);
    const drift = Math.abs(currentBpm - targetBpm);
    if (drift <= allowedDrift) return;

    const targetRatio = audioEngine.calculateTempoRatio(deck, targetBpm, state.settings.maxTempoPercent);

    // Bar-align when possible (4 beats); start slightly in the future for scheduling safety.
    const startCandidate = ctxNow + 0.05;
    const startAt = audioEngine.getNextBeatTimeFrom(deck, startCandidate, 4, effectiveRate) ?? startCandidate;

    // Smooth correction: scale ramp time with how far outside tolerance we are.
    const deltaOutside = Math.max(0, drift - allowedDrift);
    const durationMs = clamp(400 + deltaOutside * 500, state.settings.lockTolerancePct <= 0 ? 150 : 400, 3000);

    lastLockCorrectionAtCtx[deck] = ctxNow;
    audioEngine.rampTempo(deck, targetRatio, startAt, durationMs);
  };

  const stopDeckIfTrackMatches = (trackId: string) => {
    const state = get();
    const toStop: DeckId[] = [];
    if (state.deckA.trackId === trackId) toStop.push('A');
    if (state.deckB.trackId === trackId) toStop.push('B');

    for (const deck of toStop) {
      try {
        audioEngine.pause(deck);
      } catch {
        // ignore
      }

      if (deck === 'A') {
        set(s => ({ deckA: { ...initialDeckState, playbackRate: s.deckA.playbackRate } }));
      } else {
        set(s => ({ deckB: { ...initialDeckState, playbackRate: s.deckB.playbackRate } }));
      }
    }
  };

  const computeQueueAfterRemoval = (state: DJState, trackId: string) => {
    if (!state.isPartyMode || state.partyTrackIds.length === 0) return null;

    const activeDeckState = state.activeDeck === 'A' ? state.deckA : state.deckB;
    const isCurrent = !!activeDeckState.trackId && activeDeckState.trackId === trackId && activeDeckState.isPlaying;

    const oldIds = state.partyTrackIds;
    const oldNow = state.nowPlayingIndex;
    const removedBefore = oldIds.slice(0, oldNow).filter(id => id === trackId).length;
    const nextIds = oldIds.filter(id => id !== trackId);

    let nextNow = Math.max(0, oldNow - removedBefore);
    if (nextIds.length === 0) {
      return { nextIds, nextNow: 0, shouldAdvance: isCurrent };
    }

    if (isCurrent) {
      if (nextNow >= nextIds.length) nextNow = 0;
      return { nextIds, nextNow, shouldAdvance: true };
    }

    if (nextNow >= nextIds.length) nextNow = Math.max(0, nextIds.length - 1);
    return { nextIds, nextNow, shouldAdvance: false };
  };

  const jumpToQueueIndex = async (index: number) => {
    const state = get();
    if (!state.isPartyMode) return;

    const trackId = state.partyTrackIds[index];
    if (!trackId) {
      get().stopPartyMode();
      return;
    }

    const track = state.tracks.find(t => t.id === trackId);
    if (!track?.fileBlob) {
      get().stopPartyMode();
      return;
    }

    clearScheduledTimeouts();
    try {
      audioEngine.enableMixCheck(false);
    } catch {
      // ignore
    }

    // Hard stop both decks to prevent "stuck playing" when deleting current track.
    try {
      audioEngine.stop('A');
      audioEngine.stop('B');
    } catch {
      // ignore
    }

    set({
      mixInProgress: false,
      pendingNextIndex: null,
      nowPlayingIndex: index,
      activeDeck: 'A',
      crossfadeValue: 0,
    });

    try {
      audioEngine.setCrossfade(0);
    } catch {
      // ignore
    }

    const startAt = getEffectiveStartTimeSec(track, get().settings);
    await get().loadTrackToDeck(trackId, 'A', startAt);
    get().play('A');

    // Restore automix trigger.
    const after = get();
    const triggerSecondsTrack = computeAutoMixTriggerSecondsTrack(after);
    audioEngine.setMixTriggerConfig('remaining', triggerSecondsTrack);
    audioEngine.enableMixCheck(true);
  };

  const getEffectiveStartTimeSec = (track: Track | undefined, settings: Settings | undefined) => {
    const base = (settings?.nextSongStartOffset ?? 0);
    const duration = track?.duration;
    if (!duration || !Number.isFinite(duration)) return Math.max(0, base);
    return clamp(base, 0, Math.max(0, duration - 0.25));
  };

  const getDeckState = (state: DJState, deck: DeckId) => (deck === 'A' ? state.deckA : state.deckB);

  const getDeckTrack = (state: DJState, deck: DeckId) => {
    const deckState = getDeckState(state, deck);
    return deckState.trackId ? state.tracks.find(t => t.id === deckState.trackId) : undefined;
  };

  const getDeckCurrentTime = (state: DJState, deck: DeckId) => {
    return audioEngine.getCurrentTime(deck) || getDeckState(state, deck).currentTime || 0;
  };

  const defaultSettings: Settings = {
    crossfadeSeconds: 8,
    maxTempoPercent: 6,
    shuffleEnabled: false,
    masterVolume: 0.9,
    nextSongStartOffset: 15,
    endEarlySeconds: 5,
    tempoMode: 'auto',
    lockedBpm: 128,
    lockTolerancePct: 10,
    autoBaseBpm: null,
    autoOffsetBpm: 0,
    autoVolumeMatch: true,
    targetLoudness: 0.7,
    limiterEnabled: true,
    limiterStrength: 'medium',
    loopPlaylist: true,
  };

  const computeTargetBpm = (settings: Settings) => {
    if (settings.tempoMode === 'locked') return settings.lockedBpm;
    if (settings.tempoMode === 'auto') {
      if (settings.autoBaseBpm === null || !Number.isFinite(settings.autoBaseBpm)) return null;
      const offset = Number.isFinite(settings.autoOffsetBpm) ? settings.autoOffsetBpm : 0;
      return settings.autoBaseBpm + offset;
    }
    return null;
  };

  const computeAutoMixTriggerSecondsTrack = (state: DJState) => {
    const outgoingDeck = state.activeDeck;
    const outgoingDeckState = outgoingDeck === 'A' ? state.deckA : state.deckB;
    const outgoingTrack = state.tracks.find(t => t.id === outgoingDeckState.trackId);

    let nextTrackBpm: number | undefined;
    if (!state.settings.shuffleEnabled) {
      const nextIndex = state.pendingNextIndex ?? state.nowPlayingIndex + 1;
      const nextTrackId = state.partyTrackIds[nextIndex];
      const nextTrack = nextTrackId ? state.tracks.find(t => t.id === nextTrackId) : undefined;
      nextTrackBpm = nextTrack?.bpm;
    }

    const endEarlySeconds = clamp(state.settings.endEarlySeconds ?? 0, 0, 60);
    const effectiveCrossfadeSeconds = clamp(state.settings.crossfadeSeconds ?? 8, 1, 20);

    // Fixed "normal" profile for quantization/ramp/settle math.
    const energy = {
      startQuantBeats: 1,
      fadeQuantBeats: 1,
      tempoRampMs: 500,
      settleBeats: 2,
      stepLargeDeltas: false,
    };

    const outgoingRate = Math.max(0.25, audioEngine.getTempo(outgoingDeck) || 1);

    const targetBpm = computeTargetBpm(state.settings)
      ?? ((outgoingTrack?.bpm ?? audioEngine.getBaseBpm(outgoingDeck) ?? 120) * outgoingRate);

    const beatSec = 60 / Math.max(1, targetBpm);
    const barSec = beatSec * 4;

    // Tempo ramp + settle + quantization window (worst-case) — in REAL seconds.
    const rampSec = clamp(energy.tempoRampMs, 300, 800) / 1000;
    const settleSec = beatSec * energy.settleBeats;
    const quantWindowSec = Math.max(
      energy.startQuantBeats >= 4 ? barSec : beatSec,
      energy.fadeQuantBeats >= 4 ? barSec : beatSec
    );

    // Chill 2-step can include an extra 1-bar wait.
    const bpmDelta = Math.abs((outgoingTrack?.bpm ?? 120) - targetBpm);
    const twoStepExtraSec = energy.stepLargeDeltas && bpmDelta > 6 ? barSec + rampSec : 0;

    const desiredRealSeconds = endEarlySeconds + effectiveCrossfadeSeconds + rampSec + settleSec + quantWindowSec + twoStepExtraSec;
    // Convert from real seconds to track-time seconds for the engine's "remaining" trigger.
    // Engine trigger compares against *track-time* remaining; convert from real seconds.
    return desiredRealSeconds * outgoingRate;
  };

  const applyImmediateTempoToActiveDeck = (state: DJState) => {
    const deck = state.activeDeck;
    const deckState = deck === 'A' ? state.deckA : state.deckB;
    if (!deckState.trackId) return;

    const targetBpm = computeTargetBpm(state.settings);
    if (targetBpm === null) return;
    const ratio = audioEngine.calculateTempoRatio(deck, targetBpm, state.settings.maxTempoPercent);
    get().setTempo(deck, ratio);
  };

  const getTrackIdsForPartySource = (state: DJState, source: PartySource): string[] => {
    if (source.type === 'import') {
      return state.tracks.filter(t => t.fileBlob).map(t => t.id);
    }

    if (source.type === 'playlist' && source.playlistId) {
      const playlist = state.playlists.find(p => p.id === source.playlistId);
      return (playlist?.trackIds || []).filter(id => {
        const track = state.tracks.find(t => t.id === id);
        return track?.fileBlob;
      });
    }

    return [];
  };

  // Set up audio engine callbacks
  audioEngine.setOnTimeUpdate((deck, time) => {
    // Keep playbackRate in sync even when the engine is ramping tempo.
    // (The store's playbackRate is used for UI BPM display.)
    try {
      const effectiveRate = audioEngine.getEffectiveTempo(deck);
      const prevRate = deck === 'A' ? get().deckA.playbackRate : get().deckB.playbackRate;
      if (Math.abs(effectiveRate - prevRate) > 0.001) {
        if (deck === 'A') {
          set(state => ({ deckA: { ...state.deckA, playbackRate: effectiveRate } }));
        } else {
          set(state => ({ deckB: { ...state.deckB, playbackRate: effectiveRate } }));
        }
      }
    } catch {
      // ignore
    }

    try {
      maybeCorrectTempoLockDrift(deck);
    } catch {
      // ignore
    }

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
      get().skip('end');
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
        get().skip('auto');
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
    pendingSourceSwitch: null,
    queuedSourceSwitch: null,
    settings: defaultSettings,
    crossfadeValue: 0,
    mixInProgress: false,

    loadTracks: async () => {
      set({ isLoadingTracks: true });
      try {
        if (import.meta.env.DEV) {
          console.debug('[DJ Store] Loading tracks from IndexedDB...');
        }
        const tracks = await getAllTracks();
        if (import.meta.env.DEV) {
          console.debug('[DJ Store] Loaded tracks:', tracks.length);
        }
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
      audioEngine.setMasterVolume(settings.masterVolume ?? 0.9);
    },

    resetLocalData: async () => {
      // Stop playback + timers first.
      try {
        get().stopPartyMode();
      } catch {
        // ignore
      }
      clearScheduledTimeouts();

      try {
        audioEngine.destroy();
      } catch {
        // ignore
      }

      // Clear persistent storage.
      try {
        await resetLocalDatabase();
      } catch (error) {
        console.error('[DJ Store] Failed to reset local database:', error);
      }

      try {
        sessionStorage.removeItem('mejay:lastTab');
      } catch {
        // ignore
      }

      // Reset in-memory app state to a clean slate.
      set({
        tracks: [],
        isLoadingTracks: false,
        playlists: [],
        deckA: { ...initialDeckState },
        deckB: { ...initialDeckState },
        activeDeck: 'A',
        isPartyMode: false,
        partySource: null,
        partyTrackIds: [],
        nowPlayingIndex: 0,
        pendingNextIndex: null,
        pendingSourceSwitch: null,
        queuedSourceSwitch: null,
        crossfadeValue: 0,
        mixInProgress: false,
        settings: defaultSettings,
      });
    },

    importTracks: async (files: FileList) => {
      const supportedTypes = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-m4a'];

      const planState = usePlanStore.getState();
      const isFree = planState.plan === 'free';

      // Track total imported duration to enforce quota. (Only counts tracks with file blobs.)
      const computeLibrarySeconds = () => {
        const state = get();
        return state.tracks.reduce((sum, t) => sum + (t.fileBlob ? (t.duration || 0) : 0), 0);
      };

      let librarySeconds = isFree ? computeLibrarySeconds() : 0;
      let overageUsed = false;

      const showLimitToast = () => {
        toast({
          title: 'Free plan limit reached',
          description: 'Free mode supports ~30 minutes of imported music. Upgrade to Pro or Full Program to import more.',
          variant: 'destructive',
        });
        usePlanStore.getState().openUpgradeModal();
      };

      if (isFree && librarySeconds >= FREE_UPLOAD_LIMIT_SECONDS) {
        showLimitToast();
        return;
      }
      
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
          // Conservative estimate so duration-less imports can't bypass the quota.
          track.duration = 240;
        }

        if (isFree) {
          const wouldBe = librarySeconds + (track.duration || 0);
          const withinLimit = wouldBe <= FREE_UPLOAD_LIMIT_SECONDS;
          const withinOneTrackOverage = !overageUsed &&
            librarySeconds < FREE_UPLOAD_LIMIT_SECONDS &&
            wouldBe <= (FREE_UPLOAD_LIMIT_SECONDS + FREE_UPLOAD_OVERAGE_MAX_SECONDS);

          if (!withinLimit && !withinOneTrackOverage) {
            showLimitToast();
            break;
          }

          if (!withinLimit && withinOneTrackOverage) {
            overageUsed = true;
          }
        }

        await addTrack(track);
        set(state => {
          const nextTracks = [...state.tracks, track];

          // If Party Mode is currently running on the Import List, auto-append newly imported
          // tracks into the active party queue so they will play without restarting.
          if (state.isPartyMode && state.partySource?.type === 'import') {
            const alreadyQueued = state.partyTrackIds.includes(track.id);
            if (!alreadyQueued) {
              return {
                tracks: nextTracks,
                partyTrackIds: [...state.partyTrackIds, track.id],
              };
            }
          }

          return { tracks: nextTracks };
        });

        if (isFree) {
          librarySeconds += (track.duration || 0);
          if (librarySeconds >= FREE_UPLOAD_LIMIT_SECONDS && overageUsed) {
            // Stop after the allowed overage track.
            toast({
              title: 'Import limit reached',
              description: 'You’ve hit the Free mode import limit. Upgrade to add more tracks.',
            });
            usePlanStore.getState().openUpgradeModal();
            break;
          }
        }

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
      // Back-compat: treat as "remove from library" with full cleanup.
      await get().removeFromLibrary(id, {reason: 'user'});
    },

    removeFromLibrary: async (trackId: string) => {
      const stateBefore = get();

      // 1) Remove from library storage.
      await deleteTrack(trackId);
      set(state => ({ tracks: state.tracks.filter(t => t.id !== trackId) }));

      // 2) Remove from every playlist that contains it.
      const playlistsToUpdate = stateBefore.playlists.filter(p => p.trackIds.includes(trackId));
      if (playlistsToUpdate.length > 0) {
        await Promise.all(
          playlistsToUpdate.map(async (p) => {
            const newTrackIds = p.trackIds.filter(id => id !== trackId);
            await updatePlaylist(p.id, { trackIds: newTrackIds });
          }),
        );

        set(state => ({
          playlists: state.playlists.map(p =>
            p.trackIds.includes(trackId) ? { ...p, trackIds: p.trackIds.filter(id => id !== trackId) } : p,
          ),
        }));
      }

      // 3) Remove from active queue if present + skip/stop if currently playing.
      const stateMid = get();
      const q = computeQueueAfterRemoval(stateMid, trackId);
      if (q) {
        set({ partyTrackIds: q.nextIds, nowPlayingIndex: q.nextNow });
        if (q.nextIds.length === 0) {
          get().stopPartyMode();
        } else if (q.shouldAdvance) {
          await jumpToQueueIndex(q.nextNow);
        }
      }

      // 4) If loaded on a deck outside Party Mode, stop it.
      stopDeckIfTrackMatches(trackId);

      toast({
        title: 'Removed from Library',
        description: 'Track removed from Library, playlists, and queue.',
      });
    },

    removeFromPlaylist: async (playlistId: string, trackId: string) => {
      const stateBefore = get();
      const playlist = stateBefore.playlists.find(p => p.id === playlistId);
      if (!playlist) return;

      const newTrackIds = playlist.trackIds.filter(id => id !== trackId);
      await updatePlaylist(playlistId, { trackIds: newTrackIds });

      set(state => ({
        playlists: state.playlists.map(p =>
          p.id === playlistId ? { ...p, trackIds: newTrackIds } : p,
        ),
      }));

      // If playing from this playlist, remove from queue too.
      const stateMid = get();
      if (stateMid.isPartyMode && stateMid.partySource?.type === 'playlist' && stateMid.partySource.playlistId === playlistId) {
        const q = computeQueueAfterRemoval(stateMid, trackId);
        if (q) {
          set({ partyTrackIds: q.nextIds, nowPlayingIndex: q.nextNow });
          if (q.nextIds.length === 0) {
            get().stopPartyMode();
          } else if (q.shouldAdvance) {
            await jumpToQueueIndex(q.nextNow);
          }
        }
      }

      toast({
        title: 'Removed from Playlist',
        description: `Track removed from "${playlist.name}".`,
      });
    },

    removeFromCurrentSource: async (trackId: string) => {
      const state = get();
      const source = state.partySource;

      if (source?.type === 'playlist' && source.playlistId) {
        await get().removeFromPlaylist(source.playlistId, trackId);
        return;
      }

      // Default: Import List (library)
      await get().removeFromLibrary(trackId, {reason: 'user'});
    },

    loadTrackToDeck: async (trackId: string, deck: DeckId, offsetSeconds?: number) => {
      const state = get();
      const track = state.tracks.find(t => t.id === trackId);
      if (!track?.fileBlob) return;

      // Apply track gain if auto volume match is enabled
      const gainDb = state.settings.autoVolumeMatch ? track.gainDb : undefined;
      
      const duration = offsetSeconds !== undefined
        ? await audioEngine.loadTrackWithOffset(deck, track.fileBlob, offsetSeconds, track.bpm, gainDb)
        : await audioEngine.loadTrack(deck, track.fileBlob, track.bpm, gainDb);
      
      // Set base BPM for tempo matching
      if (track.bpm) {
        audioEngine.setBaseBpm(deck, track.bpm);
      }
      
      if (deck === 'A') {
        set({ deckA: { ...initialDeckState, trackId, duration, currentTime: offsetSeconds ?? 0 } });
      } else {
        set({ deckB: { ...initialDeckState, trackId, duration, currentTime: offsetSeconds ?? 0 } });
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

    restartCurrentTrack: (deck?: DeckId) => {
      const state = get();
      const targetDeck = deck || state.activeDeck;
      const track = getDeckTrack(state, targetDeck);
      if (!track) return;

      const startAt = getEffectiveStartTimeSec(track, state.settings);
      audioEngine.seek(targetDeck, startAt);

      if (targetDeck === 'A') {
        set(s => ({ deckA: { ...s.deckA, currentTime: startAt } }));
      } else {
        set(s => ({ deckB: { ...s.deckB, currentTime: startAt } }));
      }

      toast({
        title: 'Restarted',
        description: `Start: ${Math.floor(startAt / 60)}:${Math.floor(startAt % 60).toString().padStart(2, '0')}`,
      });
    },

    playPreviousTrack: async (deck?: DeckId) => {
      const state = get();
      const targetDeck = deck || state.activeDeck;

      if (!state.isPartyMode || state.partyTrackIds.length === 0) {
        // Non-party mode: no queue context, so just restart.
        get().restartCurrentTrack(targetDeck);
        return;
      }

      if (state.nowPlayingIndex === 0 && !state.settings.loopPlaylist) {
        get().restartCurrentTrack(targetDeck);
        return;
      }

      const previousIndex = state.nowPlayingIndex > 0
        ? state.nowPlayingIndex - 1
        : (state.settings.loopPlaylist ? state.partyTrackIds.length - 1 : 0);

      const previousTrackId = state.partyTrackIds[previousIndex];
      const previousTrack = state.tracks.find(t => t.id === previousTrackId);
      if (!previousTrack?.fileBlob) return;

      clearScheduledTimeouts();

      // Cancel any ongoing mix abruptly (predictable control behavior).
      if (state.mixInProgress) {
        set({ mixInProgress: false });
        try {
          audioEngine.stop('A');
          audioEngine.stop('B');
        } catch {
          // ignore
        }

        set(s => ({
          deckA: { ...s.deckA, isPlaying: false },
          deckB: { ...s.deckB, isPlaying: false },
        }));
      }

      const currentDeckState = getDeckState(state, targetDeck);
      const wasPlaying = audioEngine.isPlaying(targetDeck) || currentDeckState.isPlaying;
      const preservedTempo = Math.max(0.25, audioEngine.getTempo(targetDeck) || currentDeckState.playbackRate || 1);
      const gainDb = state.settings.autoVolumeMatch ? previousTrack.gainDb : undefined;

      const startAt = getEffectiveStartTimeSec(previousTrack, state.settings);
      const duration = await audioEngine.loadTrackWithOffset(targetDeck, previousTrack.fileBlob, startAt, previousTrack.bpm, gainDb);
      if (previousTrack.bpm) audioEngine.setBaseBpm(targetDeck, previousTrack.bpm);
      audioEngine.setTempo(targetDeck, preservedTempo);

      if (targetDeck === 'A') {
        set({ deckA: { ...initialDeckState, trackId: previousTrackId, duration, currentTime: startAt, playbackRate: preservedTempo } });
      } else {
        set({ deckB: { ...initialDeckState, trackId: previousTrackId, duration, currentTime: startAt, playbackRate: preservedTempo } });
      }

      set({
        activeDeck: targetDeck,
        nowPlayingIndex: previousIndex,
        pendingNextIndex: null,
        crossfadeValue: targetDeck === 'A' ? 0 : 1,
      });
      audioEngine.setCrossfade(targetDeck === 'A' ? 0 : 1);

      if (wasPlaying) {
        audioEngine.play(targetDeck);
        if (targetDeck === 'A') set(s => ({ deckA: { ...s.deckA, isPlaying: true } }));
        else set(s => ({ deckB: { ...s.deckB, isPlaying: true } }));
      }

      // Keep automix trigger aligned with the new outgoing track.
      const after = get();
      const triggerSecondsTrack = computeAutoMixTriggerSecondsTrack(after);
      audioEngine.setMixTriggerConfig('remaining', triggerSecondsTrack);
      audioEngine.enableMixCheck(true);
      audioEngine.resetMixTrigger();

      toast({ title: 'Previous Track' });
    },

    smartBack: (deck?: DeckId) => {
      const state = get();
      const targetDeck = deck || state.activeDeck;
      const currentTime = getDeckCurrentTime(state, targetDeck);
      const threshold = 2.5;

      if (currentTime > threshold) {
        get().restartCurrentTrack(targetDeck);
        return;
      }

      void get().playPreviousTrack(targetDeck);
    },

    skip: (reason: 'user' | 'auto' | 'end' | 'switch' = 'user') => {
      const state = get();
      const { partyTrackIds, nowPlayingIndex, pendingNextIndex, settings, activeDeck, tracks } = state;
      
      if (!state.isPartyMode || partyTrackIds.length === 0) return;
      if (state.mixInProgress) return;

      clearScheduledTimeouts();
      
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
      const targetBpm = computeTargetBpm(settings) ?? (currentTrack?.bpm || 120);

      // Get track gain for volume matching
      const gainDb = settings.autoVolumeMatch ? nextTrack.gainDb : undefined;

      const ctxNow = audioEngine.getAudioContextTime();
      if (ctxNow === null) return;

      // DJ Logic timing
      const startOffsetSeconds = clamp(settings.nextSongStartOffset ?? 0, 0, 120);
      const endEarlySeconds = clamp(settings.endEarlySeconds ?? 0, 0, 60);
      const effectiveCrossfadeSeconds = clamp(settings.crossfadeSeconds ?? 8, 1, 20);

      // Fixed "normal" profile for quantization/ramp/settle behavior.
      const energy = {
        startQuantBeats: 1,
        fadeQuantBeats: 1,
        tempoRampMs: 500,
        settleBeats: 2,
        stepLargeDeltas: false,
      };

      // Manual Next should transition immediately (on-beat), not wait until track end.
      const isManualImmediate = reason === 'user' || reason === 'end' || reason === 'switch';

      // Use engine timing for scheduling math to avoid drift between store state and WebAudio.
      const outgoingDurationTrack = audioEngine.getDuration(currentDeck) || currentDeckState.duration || 0;
      const outgoingTimeTrack = audioEngine.getCurrentTime(currentDeck) || currentDeckState.currentTime || 0;
      const outgoingRemainingTrack = Math.max(0, outgoingDurationTrack - outgoingTimeTrack);
      const outgoingRate = Math.max(0.25, audioEngine.getTempo(currentDeck) || currentDeckState.playbackRate || 1);
      const outgoingRemainingReal = outgoingRemainingTrack / outgoingRate;
      const outgoingEndCtx = ctxNow + outgoingRemainingReal;

      // Latest moment we can start crossfade while still respecting End Early (minimum).
      const latestCrossfadeStart = outgoingEndCtx - endEarlySeconds - effectiveCrossfadeSeconds;
      const safeLatestCrossfadeStart = Math.max(ctxNow + 0.05, latestCrossfadeStart);

      const beatSec = 60 / Math.max(1, targetBpm);
      const barSec = beatSec * 4;
      const rampSec = clamp(energy.tempoRampMs, 300, 800) / 1000;
      const settleSec = beatSec * energy.settleBeats;

      const nextBaseBpm = nextTrack?.bpm || 120;
      const bpmDelta = Math.abs(targetBpm - nextBaseBpm);

      // Pre-roll needed to ramp + settle before crossfade begins.
      const preRollSec = energy.stepLargeDeltas && bpmDelta > 6
        ? (rampSec + barSec + rampSec + settleSec)
        : (rampSec + settleSec);

      let incomingStartAt: number;
      let fadeAt: number;

      if (isManualImmediate) {
        const startCandidate = ctxNow + 0.05;
        incomingStartAt = audioEngine.getNextBeatTimeFrom(currentDeck, startCandidate, energy.startQuantBeats) ?? startCandidate;
        fadeAt = audioEngine.getNextBeatTimeFrom(currentDeck, incomingStartAt, energy.fadeQuantBeats) ?? incomingStartAt;
      } else {
        // Incoming can start earlier (muted by crossfade position) to allow ramp+settle.
        const earliestIncomingStart = Math.max(ctxNow + 0.05, safeLatestCrossfadeStart - preRollSec);
        const quantIncomingStart = audioEngine.getNextBeatTimeFrom(currentDeck, earliestIncomingStart, energy.startQuantBeats) ?? earliestIncomingStart;
        incomingStartAt = quantIncomingStart > safeLatestCrossfadeStart ? safeLatestCrossfadeStart : quantIncomingStart;

        // Compute crossfade start as soon as we're "ready" (after pre-roll), but never after latestCrossfadeStart.
        const fadeCandidate = incomingStartAt + preRollSec;
        const quantFade = audioEngine.getNextBeatTimeFrom(currentDeck, fadeCandidate, energy.fadeQuantBeats) ?? fadeCandidate;
        fadeAt = Math.min(quantFade, safeLatestCrossfadeStart);
      }

      set({ mixInProgress: true });

      // Load next track with offset
      audioEngine.loadTrackWithOffset(
        nextDeck,
        nextTrack.fileBlob,
        startOffsetSeconds,
        nextTrack.bpm,
        gainDb
      ).then((duration) => {
        // Tempo ramp + settle scheduling.
        const targetRatio = audioEngine.calculateTempoRatio(nextDeck, targetBpm, settings.maxTempoPercent);
        const baseBpm = nextTrack.bpm || 120;

        // Start incoming early (inaudible until crossfade begins).
        audioEngine.playAt(nextDeck, incomingStartAt);

        // Start at natural tempo (1x) then ramp to target.
        audioEngine.setTempo(nextDeck, 1);

        // Chill 2-step: ramp halfway, wait 1 bar, ramp remainder.
        if (energy.stepLargeDeltas && Math.abs(targetBpm - baseBpm) > 6) {
          const halfwayBpm = baseBpm + (targetBpm - baseBpm) / 2;
          const halfRatio = audioEngine.calculateTempoRatio(nextDeck, halfwayBpm, settings.maxTempoPercent);
          audioEngine.rampTempo(nextDeck, halfRatio, incomingStartAt, energy.tempoRampMs);

          const secondRampAt = incomingStartAt + rampSec + barSec;
          audioEngine.rampTempo(nextDeck, targetRatio, secondRampAt, energy.tempoRampMs);
        } else {
          audioEngine.rampTempo(nextDeck, targetRatio, incomingStartAt, energy.tempoRampMs);
        }

        // Equal-power crossfade.
        audioEngine.scheduleCrossfade(effectiveCrossfadeSeconds, fadeAt);

        const stopAt = fadeAt + effectiveCrossfadeSeconds;
        audioEngine.scheduleStop(currentDeck, stopAt + 0.02);

        const now = audioEngine.getAudioContextTime() ?? ctxNow;
        const startDelayMs = Math.max(0, (incomingStartAt - now) * 1000);
        const stopDelayMs = Math.max(0, (stopAt - now) * 1000);

        scheduledTimeouts.push(window.setTimeout(() => {
          if (nextDeck === 'A') {
            set(s => ({ deckA: { ...s.deckA, isPlaying: true } }));
          } else {
            set(s => ({ deckB: { ...s.deckB, isPlaying: true } }));
          }
        }, startDelayMs));

        scheduledTimeouts.push(window.setTimeout(() => {
          get().pause(currentDeck);
          audioEngine.resetMixTrigger();
          set({
            activeDeck: nextDeck,
            nowPlayingIndex: nextIndex,
            mixInProgress: false,
          });

          // Apply any pending source switch by rewriting the queue to the new source.
          const afterMix = get();
          if (afterMix.pendingSourceSwitch) {
            set({
              partySource: afterMix.pendingSourceSwitch.source,
              partyTrackIds: afterMix.pendingSourceSwitch.trackIds,
              nowPlayingIndex: 0,
              pendingNextIndex: null,
              pendingSourceSwitch: null,
            });
          }

          // Recompute automix trigger for the new outgoing deck.
          const newState = get();
          const triggerSecondsTrack = computeAutoMixTriggerSecondsTrack(newState);
          audioEngine.setMixTriggerConfig('remaining', triggerSecondsTrack);
          audioEngine.enableMixCheck(true);

          // If the user picked a different source during the mix, switch now.
          const afterQueued = get();
          if (afterQueued.queuedSourceSwitch) {
            const queued = afterQueued.queuedSourceSwitch;
            set({ queuedSourceSwitch: null });
            void get().switchPartySourceSmooth(queued);
          }
        }, stopDelayMs));

        if (nextDeck === 'A') {
          set({ deckA: { ...initialDeckState, trackId: nextTrackId, duration } });
        } else {
          set({ deckB: { ...initialDeckState, trackId: nextTrackId, duration } });
        }
      }).catch((error) => {
        console.error('[DJ Store] skip() failed to load next track:', error);
        set({ mixInProgress: false });
      });
    },

    startPartyMode: async (source: PartySource) => {
      const state = get();

      // Safety default: whenever the user chooses a source to start Party Mode,
      // ensure we start quiet (max 10%) to avoid unexpected loud playback.
      // Do not *increase* volume if the user already had it lower.
      if (!state.isPartyMode) {
        const current = state.settings.masterVolume ?? 1;
        const initialPartyVolume = 0.1;
        const next = Math.min(current, initialPartyVolume);
        if (next !== current) {
          get().setMasterVolume(next);
        }
      }
      
      let trackIds = getTrackIdsForPartySource(state, source);

      if (import.meta.env.DEV) {
        console.debug('[DJ Store] Starting party mode with', trackIds.length, 'playable tracks');
      }
      
      if (state.settings.shuffleEnabled) {
        trackIds = [...trackIds].sort(() => Math.random() - 0.5);
      }

      if (trackIds.length === 0) {
        console.error('[DJ Store] No playable tracks - all tracks may be missing file data');
        return;
      }

      const firstTrackId = trackIds[0];
      const firstTrack = state.tracks.find(t => t.id === firstTrackId);
      
      if (!firstTrack?.fileBlob) {
        console.error('[DJ Store] First track has no fileBlob');
        return;
      }
      
      // Apply Start Offset to the first track in Party Mode as well.
      const startOffsetSeconds = clamp(get().settings.nextSongStartOffset ?? 0, 0, 120);
      await get().loadTrackToDeck(firstTrackId, 'A', startOffsetSeconds);

      // If Auto Match is enabled but has no baseline yet (fresh installs / old settings),
      // capture it from what's currently playing (relative lock starting at 0).
      if (state.settings.tempoMode === 'auto' && state.settings.autoBaseBpm === null) {
        const baseBpm = firstTrack?.bpm ?? audioEngine.getBaseBpm('A') ?? 120;
        const rate = Math.max(0.25, audioEngine.getTempo('A') || 1);
        const effectiveBpm = baseBpm * rate;
        await updateSettings({ autoBaseBpm: effectiveBpm, autoOffsetBpm: 0 });
        set(s => ({ settings: { ...s.settings, autoBaseBpm: effectiveBpm, autoOffsetBpm: 0 } }));
      }
      
      // Apply locked tempo if set
      if (state.settings.tempoMode === 'locked' && firstTrack?.bpm) {
        const ratio = audioEngine.calculateTempoRatio('A', state.settings.lockedBpm, state.settings.maxTempoPercent);
        audioEngine.setTempo('A', ratio);
      }

      // Apply Auto Match tempo if baseline exists (or was just captured).
      const afterBaseline = get().settings;
      const autoTarget = computeTargetBpm(afterBaseline);
      if (afterBaseline.tempoMode === 'auto' && autoTarget !== null) {
        const ratio = audioEngine.calculateTempoRatio('A', autoTarget, afterBaseline.maxTempoPercent);
        audioEngine.setTempo('A', ratio);
      }
      
      set({
        isPartyMode: true,
        partySource: source,
        partyTrackIds: trackIds,
        nowPlayingIndex: 0,
        pendingNextIndex: null,
        pendingSourceSwitch: null,
        queuedSourceSwitch: null,
        activeDeck: 'A',
        crossfadeValue: 0,
      });
      
      audioEngine.setCrossfade(0);
      get().play('A');

      // Configure automix trigger AFTER party mode is active to avoid a race where
      // AudioEngine triggers before the store considers itself in Party Mode.
      const after = get();
      const triggerSecondsTrack = computeAutoMixTriggerSecondsTrack(after);
      audioEngine.setMixTriggerConfig('remaining', triggerSecondsTrack);
      audioEngine.enableMixCheck(true);
    },

    stopPartyMode: () => {
      clearScheduledTimeouts();
      get().pause('A');
      get().pause('B');
      audioEngine.enableMixCheck(false);
      set({ 
        isPartyMode: false, 
        partyTrackIds: [], 
        nowPlayingIndex: 0,
        pendingNextIndex: null,
        pendingSourceSwitch: null,
        queuedSourceSwitch: null,
        mixInProgress: false,
      });
    },

    triggerMixNow: () => {
      const state = get();
      if (state.isPartyMode) {
        const hasMore = state.nowPlayingIndex < state.partyTrackIds.length - 1;
        const canLoop = state.settings.loopPlaylist;
        if (hasMore || canLoop) {
          get().skip('user');
        }
      }
    },

    setPartySource: (source: PartySource | null) => {
      set({ partySource: source });
    },

    switchPartySourceSmooth: async (source: PartySource) => {
      const state = get();
      if (!state.isPartyMode) {
        await get().startPartyMode(source);
        return;
      }
      if (state.mixInProgress) {
        set({ queuedSourceSwitch: source });
        return;
      }

      // If we aren't currently playing anything, do a clean start onto the new source.
      const currentDeckStatePre = state.activeDeck === 'A' ? state.deckA : state.deckB;
      if (!currentDeckStatePre.isPlaying) {
        await get().startPartyMode(source);
        return;
      }

      let trackIds = getTrackIdsForPartySource(state, source);
      if (state.settings.shuffleEnabled) {
        trackIds = [...trackIds].sort(() => Math.random() - 0.5);
      }
      if (trackIds.length === 0) return;

      const currentDeckState = state.activeDeck === 'A' ? state.deckA : state.deckB;
      const currentTrackId = currentDeckState.trackId;

      // If we don't have a current track loaded, fall back to a clean start.
      if (!currentTrackId) {
        await get().startPartyMode(source);
        return;
      }

      // Insert current track at index 0 so skip('switch') can mix into the new source's first track.
      set({
        partySource: source,
        partyTrackIds: [currentTrackId, ...trackIds],
        nowPlayingIndex: 0,
        pendingNextIndex: 1,
        pendingSourceSwitch: { source, trackIds },
      });

      get().skip('switch');
    },

    saveCurrentPartyAsPlaylist: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;

      const state = get();
      if (!state.isPartyMode || state.partyTrackIds.length === 0) return null;

      const playlist: Playlist = {
        id: generateId(),
        name: trimmed,
        trackIds: [...state.partyTrackIds],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await addPlaylist(playlist);
      set(s => ({ playlists: [...s.playlists, playlist] }));
      return playlist.id;
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
      get().skip('user');
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
      get().skip('user');
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

    setMasterVolume: (value: number) => {
      const v = clamp(value, 0, 1);
      audioEngine.setMasterVolume(v);
      set(state => ({ settings: { ...state.settings, masterVolume: v } }));

      if (masterVolumeSaveTimeout !== null) {
        clearTimeout(masterVolumeSaveTimeout);
      }
      masterVolumeSaveTimeout = window.setTimeout(() => {
        void updateSettings({ masterVolume: v });
      }, 250);
    },

    updateUserSettings: async (updates: Partial<Settings>) => {
      const before = get();

      // When enabling Auto Match, capture a baseline from the currently playing deck
      // including any tempo stretch already applied, then set slider offset to 0.
      if (updates.tempoMode === 'auto' && before.settings.tempoMode !== 'auto') {
        const deck = before.activeDeck;
        const deckState = deck === 'A' ? before.deckA : before.deckB;
        const track = deckState.trackId ? before.tracks.find(t => t.id === deckState.trackId) : undefined;

        const baseBpm = track?.bpm ?? audioEngine.getBaseBpm(deck) ?? 120;
        const rate = Math.max(0.25, audioEngine.getTempo(deck) || deckState.playbackRate || 1);
        const effectiveBpm = baseBpm * rate;

        updates.autoBaseBpm = effectiveBpm;
        updates.autoOffsetBpm = 0;
      }

      // When enabling Tempo Lock, default the master BPM to the current playback BPM.
      if (updates.tempoMode === 'locked' && before.settings.tempoMode !== 'locked') {
        const deck = before.activeDeck;
        const deckState = deck === 'A' ? before.deckA : before.deckB;
        const track = deckState.trackId ? before.tracks.find(t => t.id === deckState.trackId) : undefined;

        const baseBpm = track?.bpm ?? audioEngine.getBaseBpm(deck) ?? 120;
        const rate = Math.max(0.25, audioEngine.getEffectiveTempo(deck) || deckState.playbackRate || 1);
        const effectiveBpm = baseBpm * rate;
        updates.lockedBpm = Math.round(effectiveBpm * 10) / 10;
      }

      // Apply settings immediately for responsive controls (sliders/toggles).
      set(state => ({ settings: { ...state.settings, ...updates } }));

      const state = get();

      // Make Master BPM / tempo mode changes apply instantly to the currently playing deck.
      if (state.isPartyMode && (
        updates.tempoMode !== undefined ||
        updates.lockedBpm !== undefined ||
        updates.autoBaseBpm !== undefined ||
        updates.autoOffsetBpm !== undefined ||
        updates.maxTempoPercent !== undefined
      )) {
        applyImmediateTempoToActiveDeck(state);
      }

      // Apply mix check enable/disable immediately.
      // Keep the automix trigger in sync immediately when timing/energy/tempo changes.
      if (state.isPartyMode && (
        updates.endEarlySeconds !== undefined ||
        updates.crossfadeSeconds !== undefined ||
        updates.tempoMode !== undefined ||
        updates.lockedBpm !== undefined ||
        updates.autoBaseBpm !== undefined ||
        updates.autoOffsetBpm !== undefined ||
        updates.maxTempoPercent !== undefined
      )) {
        const triggerSecondsTrack = computeAutoMixTriggerSecondsTrack(get());
        audioEngine.setMixTriggerConfig('remaining', triggerSecondsTrack);
        audioEngine.enableMixCheck(true);
        // Re-evaluate immediately using the new threshold.
        audioEngine.resetMixTrigger();
      }
      
      // Apply audio engine settings
      if (updates.masterVolume !== undefined) {
        audioEngine.setMasterVolume(clamp(updates.masterVolume, 0, 1));
      }
      if (updates.limiterEnabled !== undefined) {
        audioEngine.setLimiterEnabled(updates.limiterEnabled);
      }
      if (updates.limiterStrength !== undefined) {
        audioEngine.setLimiterStrength(updates.limiterStrength);
      }

      // Persist settings with a short debounce to prevent IDB write races
      // when controls update rapidly (e.g. sliders).
      queuedSettingsUpdates = { ...queuedSettingsUpdates, ...updates };
      if (settingsSaveTimeout !== null) {
        clearTimeout(settingsSaveTimeout);
      }
      settingsSaveTimeout = window.setTimeout(() => {
        const toSave = queuedSettingsUpdates;
        queuedSettingsUpdates = {};
        settingsSaveTimeout = null;

        void updateSettings(toSave).catch((error) => {
          console.error('[DJ Store] Failed to persist settings:', error);
        });
      }, 150);
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
      // Back-compat: treat as "remove from this playlist" with queue + currently-playing handling.
      await get().removeFromPlaylist(playlistId, trackId);
    },

    reorderPlaylistTracks: async (playlistId: string, fromIndex: number, toIndex: number) => {
      const playlist = get().playlists.find(p => p.id === playlistId);
      if (!playlist) return;

      const newTrackIds = [...playlist.trackIds];
      const [removed] = newTrackIds.splice(fromIndex, 1);
      newTrackIds.splice(toIndex, 0, removed);

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
    },
    {
      name: 'mejay:djStore',
      version: 1,
      storage: createJSONStorage(() => getDjSessionStorage() ?? djStoreNoopStorage),
      partialize: (state) => ({
        // Deck state: persist only what can be safely/consistently restored.
        deckA: {
          trackId: state.deckA.trackId,
          playbackRate: state.deckA.playbackRate,
        },
        deckB: {
          trackId: state.deckB.trackId,
          playbackRate: state.deckB.playbackRate,
        },

        activeDeck: state.activeDeck,
        isPartyMode: state.isPartyMode,
        partySource: state.partySource,
        partyTrackIds: state.partyTrackIds,
        nowPlayingIndex: state.nowPlayingIndex,
        pendingNextIndex: state.pendingNextIndex,
        pendingSourceSwitch: state.pendingSourceSwitch,
        queuedSourceSwitch: state.queuedSourceSwitch,
        crossfadeValue: state.crossfadeValue,

        // User settings are small and serializable.
        settings: state.settings,
      }),
      // Ensure nested objects (deckA/deckB) merge instead of replacing.
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<DJState>;
        return {
          ...currentState,
          ...persisted,
          deckA: { ...currentState.deckA, ...(persisted.deckA ?? {}) },
          deckB: { ...currentState.deckB, ...(persisted.deckB ?? {}) },
        } as DJState;
      },
    }
  )
);
