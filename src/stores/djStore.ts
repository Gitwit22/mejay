import { create } from 'zustand';
import { Track, Settings, getAllTracks, getSettings, addTrack, updateTrack, deleteTrack, updateSettings, generateId, getAllPlaylists, Playlist, addPlaylist, updatePlaylist, deletePlaylist, PartySource } from '@/lib/db';
import { audioEngine, DeckId } from '@/lib/audioEngine';
import { analyzeBPM } from '@/lib/bpmDetector';
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
  
  // Playback
  loadTrackToDeck: (trackId: string, deck: DeckId, offsetSeconds?: number) => Promise<void>;
  play: (deck?: DeckId) => void;
  pause: (deck?: DeckId) => void;
  togglePlayPause: (deck?: DeckId) => void;
  seek: (deck: DeckId, time: number) => void;
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

export const useDJStore = create<DJState>((set, get) => {
  let scheduledTimeouts: number[] = [];
  let masterVolumeSaveTimeout: number | null = null;

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

  const getEnergyProfile = (energyMode: Settings['energyMode']) => {
    switch (energyMode) {
      case 'chill':
        return {
          startQuantBeats: 4, // next bar
          fadeQuantBeats: 4,  // next bar
          tempoRampMs: 800,
          settleBeats: 4, // 1 bar
          stepLargeDeltas: true,
          crossfadeMultiplier: 1.25,
          crossfadeSecMin: 6,
          crossfadeSecMax: 14,
        };
      case 'hype':
        return {
          startQuantBeats: 1, // next beat
          fadeQuantBeats: 1,  // next beat
          tempoRampMs: 300,
          settleBeats: 1, // 1/4 bar
          stepLargeDeltas: false,
          crossfadeMultiplier: 0.75,
          crossfadeSecMin: 2,
          crossfadeSecMax: 8,
        };
      case 'normal':
      default:
        return {
          startQuantBeats: 1, // next beat
          fadeQuantBeats: 1,  // next beat
          tempoRampMs: 500,
          settleBeats: 2, // 1/2 bar
          stepLargeDeltas: false,
          crossfadeMultiplier: 1,
          crossfadeSecMin: 4,
          crossfadeSecMax: 10,
        };
    }
  };

  const getEffectiveCrossfadeSeconds = (userSeconds: number, energyMode: Settings['energyMode']) => {
    const energy = getEnergyProfile(energyMode);
    const biased = userSeconds * energy.crossfadeMultiplier;
    return clamp(biased, energy.crossfadeSecMin, energy.crossfadeSecMax);
  };

  const computeTargetBpm = (settings: Settings, currentTrackBpm?: number) => {
    if (settings.tempoMode === 'locked') return settings.lockedBpm;
    return currentTrackBpm || 120;
  };

  const computeAutoMixTriggerSecondsTrack = (state: DJState) => {
    const outgoingDeck = state.activeDeck;
    const outgoingDeckState = outgoingDeck === 'A' ? state.deckA : state.deckB;
    const outgoingTrack = state.tracks.find(t => t.id === outgoingDeckState.trackId);

    const endEarlySeconds = clamp(state.settings.endEarlySeconds ?? 0, 0, 60);
    const effectiveCrossfadeSeconds = getEffectiveCrossfadeSeconds(state.settings.crossfadeSeconds ?? 8, state.settings.energyMode);
    const energy = getEnergyProfile(state.settings.energyMode);

    const targetBpm = computeTargetBpm(state.settings, outgoingTrack?.bpm);
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
    // Use engine tempo (more reliable than store state when ramps/automation are involved).
    const outgoingRate = Math.max(0.25, audioEngine.getTempo(outgoingDeck) || 1);
    // Engine trigger compares against *track-time* remaining; convert from real seconds.
    return desiredRealSeconds * outgoingRate;
  };

  const applyImmediateTempoToActiveDeck = (state: DJState) => {
    const deck = state.activeDeck;
    const deckState = deck === 'A' ? state.deckA : state.deckB;
    if (!deckState.trackId) return;

    const track = state.tracks.find(t => t.id === deckState.trackId);
    const targetBpm = computeTargetBpm(state.settings, track?.bpm);
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
    settings: {
      crossfadeSeconds: 8,
      maxTempoPercent: 6,
      energyMode: 'normal',
      shuffleEnabled: false,
      masterVolume: 0.9,
      nextSongStartOffset: 15,
      endEarlySeconds: 5,
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
    mixInProgress: false,

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
      audioEngine.setMasterVolume(settings.masterVolume ?? 0.9);
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
          description: 'Free mode supports ~30 minutes of imported music. Upgrade to import more.',
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
        set(state => ({ tracks: [...state.tracks, track] }));

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
      await deleteTrack(id);
      set(state => ({ tracks: state.tracks.filter(t => t.id !== id) }));
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
      const targetBpm = computeTargetBpm(settings, currentTrack?.bpm);

      // Get track gain for volume matching
      const gainDb = settings.autoVolumeMatch ? nextTrack.gainDb : undefined;

      const ctxNow = audioEngine.getAudioContextTime();
      if (ctxNow === null) return;

      // DJ Logic timing
      const startOffsetSeconds = clamp(settings.nextSongStartOffset ?? 0, 0, 120);
      const endEarlySeconds = clamp(settings.endEarlySeconds ?? 0, 0, 60);
      const effectiveCrossfadeSeconds = getEffectiveCrossfadeSeconds(settings.crossfadeSeconds ?? 8, settings.energyMode);
      const energy = getEnergyProfile(settings.energyMode);

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
          audioEngine.enableMixCheck(newState.settings.mixTriggerMode !== 'manual');

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
      
      let trackIds = getTrackIdsForPartySource(state, source);

      console.log('[DJ Store] Starting party mode with', trackIds.length, 'playable tracks');
      
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
      
      // Apply locked tempo if set
      if (state.settings.tempoMode === 'locked' && firstTrack?.bpm) {
        const ratio = audioEngine.calculateTempoRatio('A', state.settings.lockedBpm, state.settings.maxTempoPercent);
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
      audioEngine.enableMixCheck(after.settings.mixTriggerMode !== 'manual');
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
      // Energy Mode biasing (no UI changes): apply defaults unless explicitly overridden.
      if (updates.energyMode) {
        if (updates.targetLoudness === undefined) {
          updates.targetLoudness = updates.energyMode === 'chill' ? 0.55 : updates.energyMode === 'hype' ? 0.8 : 0.7;
        }
        if (updates.limiterStrength === undefined) {
          updates.limiterStrength = updates.energyMode === 'chill' ? 'strong' : updates.energyMode === 'hype' ? 'light' : 'medium';
        }
        if (updates.limiterEnabled === undefined) {
          updates.limiterEnabled = true;
        }
      }

      await updateSettings(updates);
      set(state => ({ settings: { ...state.settings, ...updates } }));

      const state = get();

      // Make Master BPM / tempo mode changes apply instantly to the currently playing deck.
      if (state.isPartyMode && (
        updates.tempoMode !== undefined ||
        updates.lockedBpm !== undefined ||
        updates.maxTempoPercent !== undefined
      )) {
        applyImmediateTempoToActiveDeck(state);
      }

      // Keep the automix trigger in sync immediately when timing/energy/tempo changes.
      if (state.isPartyMode && (
        updates.endEarlySeconds !== undefined ||
        updates.crossfadeSeconds !== undefined ||
        updates.energyMode !== undefined ||
        updates.tempoMode !== undefined ||
        updates.lockedBpm !== undefined ||
        updates.maxTempoPercent !== undefined
      )) {
        const triggerSecondsTrack = computeAutoMixTriggerSecondsTrack(get());
        audioEngine.setMixTriggerConfig('remaining', triggerSecondsTrack);
        // Re-evaluate immediately using the new threshold.
        audioEngine.resetMixTrigger();
      }

      // Apply mix check enable/disable immediately.
      if (state.isPartyMode && updates.mixTriggerMode !== undefined) {
        audioEngine.enableMixCheck(get().settings.mixTriggerMode !== 'manual');
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
});
