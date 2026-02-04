// Web Audio API based audio engine for ME Jay
// Provides dual-deck playback, crossfading, tempo control, and scratching

export type DeckId = 'A' | 'B';
export type ScratchType = 'baby' | 'chirp' | 'transformer' | 'tear' | 'stab';

interface DeckState {
  audioBuffer: AudioBuffer | null;
  sourceNode: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  playbackRate: number;
  baseBpm: number; // Original detected BPM
  isPlaying: boolean;
  currentTime: number;
  startedAt: number;
  pausedAt: number;
  duration: number;
}

// Scratch envelope definitions (time in beats, rate multiplier)
const SCRATCH_ENVELOPES: Record<ScratchType, { duration: number; envelope: Array<[number, number]> }> = {
  baby: { duration: 1, envelope: [[0, 1], [0.25, -0.5], [0.5, 0.5], [0.75, -0.5], [1, 1]] },
  chirp: { duration: 0.5, envelope: [[0, 0], [0.15, 1.5], [0.35, -1], [0.5, 1]] },
  transformer: { duration: 1, envelope: [[0, 1], [0.125, 0], [0.25, 1], [0.375, 0], [0.5, 1], [0.625, 0], [0.75, 1], [0.875, 0], [1, 1]] },
  tear: { duration: 1, envelope: [[0, 0.3], [0.33, 0.6], [0.66, 0.9], [1, 1]] },
  stab: { duration: 0.25, envelope: [[0, 0], [0.1, 2], [0.25, 1]] },
};

class AudioEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private decks: Record<DeckId, DeckState> = {
    A: this.createEmptyDeck(),
    B: this.createEmptyDeck(),
  };
  private crossfadeValue: number = 0.5; // 0 = full A, 1 = full B
  private onTimeUpdate: ((deck: DeckId, time: number) => void) | null = null;
  private onTrackEnd: ((deck: DeckId) => void) | null = null;
  private onMixTrigger: (() => void) | null = null;
  private animationFrameId: number | null = null;
  private scratchTimeout: number | null = null;
  private mixCheckEnabled: boolean = false;
  private mixTriggerMode: 'remaining' | 'elapsed' | 'manual' = 'remaining';
  private mixTriggerSeconds: number = 20;
  private mixTriggered: boolean = false;

  private createEmptyDeck(): DeckState {
    return {
      audioBuffer: null,
      sourceNode: null,
      gainNode: null,
      playbackRate: 1,
      baseBpm: 120,
      isPlaying: false,
      currentTime: 0,
      startedAt: 0,
      pausedAt: 0,
      duration: 0,
    };
  }

  async initialize(): Promise<void> {
    if (this.audioContext) return;

    this.audioContext = new AudioContext();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.connect(this.audioContext.destination);

    // Create gain nodes for each deck
    this.decks.A.gainNode = this.audioContext.createGain();
    this.decks.B.gainNode = this.audioContext.createGain();
    this.decks.A.gainNode.connect(this.masterGain);
    this.decks.B.gainNode.connect(this.masterGain);

    this.updateCrossfade();
    this.startTimeUpdateLoop();
  }

  private startTimeUpdateLoop(): void {
    const update = () => {
      if (this.onTimeUpdate) {
        if (this.decks.A.isPlaying) {
          const time = this.getCurrentTime('A');
          this.onTimeUpdate('A', time);
          
          // Check mix trigger for deck A
          this.checkMixTrigger('A', time);
          
          // Check if track ended
          if (time >= this.decks.A.duration && this.decks.A.duration > 0) {
            this.onTrackEnd?.('A');
          }
        }
        if (this.decks.B.isPlaying) {
          const time = this.getCurrentTime('B');
          this.onTimeUpdate('B', time);
          
          // Check mix trigger for deck B
          this.checkMixTrigger('B', time);
          
          if (time >= this.decks.B.duration && this.decks.B.duration > 0) {
            this.onTrackEnd?.('B');
          }
        }
      }
      this.animationFrameId = requestAnimationFrame(update);
    };
    this.animationFrameId = requestAnimationFrame(update);
  }

  private checkMixTrigger(deck: DeckId, currentTime: number): void {
    if (!this.mixCheckEnabled || this.mixTriggered) return;
    
    const deckState = this.decks[deck];
    const remaining = deckState.duration - currentTime;
    
    let shouldTrigger = false;
    
    if (this.mixTriggerMode === 'remaining' && remaining <= this.mixTriggerSeconds) {
      shouldTrigger = true;
    } else if (this.mixTriggerMode === 'elapsed' && currentTime >= this.mixTriggerSeconds) {
      shouldTrigger = true;
    }
    
    if (shouldTrigger) {
      this.mixTriggered = true;
      this.onMixTrigger?.();
    }
  }

  setMixTriggerConfig(mode: 'remaining' | 'elapsed' | 'manual', seconds: number): void {
    this.mixTriggerMode = mode;
    this.mixTriggerSeconds = seconds;
  }

  enableMixCheck(enabled: boolean): void {
    this.mixCheckEnabled = enabled;
    this.mixTriggered = false;
  }

  resetMixTrigger(): void {
    this.mixTriggered = false;
  }

  setOnMixTrigger(callback: () => void): void {
    this.onMixTrigger = callback;
  }

  setOnTimeUpdate(callback: (deck: DeckId, time: number) => void): void {
    this.onTimeUpdate = callback;
  }

  setOnTrackEnd(callback: (deck: DeckId) => void): void {
    this.onTrackEnd = callback;
  }

  async loadTrack(deck: DeckId, blob: Blob, bpm?: number): Promise<number> {
    await this.initialize();
    
    if (!this.audioContext) throw new Error('Audio context not initialized');

    // Stop any current playback on this deck
    this.stop(deck);

    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    
    this.decks[deck].audioBuffer = audioBuffer;
    this.decks[deck].duration = audioBuffer.duration;
    this.decks[deck].currentTime = 0;
    this.decks[deck].pausedAt = 0;
    this.decks[deck].baseBpm = bpm || 120;

    return audioBuffer.duration;
  }

  // Load track and set initial offset (start at X seconds)
  async loadTrackWithOffset(deck: DeckId, blob: Blob, offsetSeconds: number, bpm?: number): Promise<number> {
    const duration = await this.loadTrack(deck, blob, bpm);
    const clampedOffset = Math.max(0, Math.min(offsetSeconds, duration - 1));
    this.decks[deck].pausedAt = clampedOffset;
    return duration;
  }

  getBaseBpm(deck: DeckId): number {
    return this.decks[deck].baseBpm;
  }

  setBaseBpm(deck: DeckId, bpm: number): void {
    this.decks[deck].baseBpm = bpm;
  }

  // Calculate tempo ratio to match target BPM
  calculateTempoRatio(deck: DeckId, targetBpm: number, maxPercent: number): number {
    const baseBpm = this.decks[deck].baseBpm;
    if (!baseBpm || baseBpm === 0) return 1;
    
    const idealRatio = targetBpm / baseBpm;
    const minRatio = 1 - (maxPercent / 100);
    const maxRatio = 1 + (maxPercent / 100);
    
    return Math.max(minRatio, Math.min(maxRatio, idealRatio));
  }

  // Match deck B's tempo to deck A (or to a locked BPM)
  matchTempo(targetBpm: number, maxPercent: number): void {
    const ratio = this.calculateTempoRatio('B', targetBpm, maxPercent);
    this.setTempo('B', ratio);
  }

  play(deck: DeckId): void {
    if (!this.audioContext || !this.decks[deck].audioBuffer) return;

    // Resume audio context if suspended (mobile browsers)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const deckState = this.decks[deck];
    
    // If already playing, do nothing
    if (deckState.isPlaying) return;

    // Create new source node
    const source = this.audioContext.createBufferSource();
    source.buffer = deckState.audioBuffer;
    source.playbackRate.value = deckState.playbackRate;
    source.connect(deckState.gainNode!);

    // Calculate start offset
    const offset = deckState.pausedAt;
    
    source.start(0, offset);
    deckState.sourceNode = source;
    deckState.startedAt = this.audioContext.currentTime - offset;
    deckState.isPlaying = true;

    // Handle track end
    source.onended = () => {
      if (deckState.isPlaying) {
        deckState.isPlaying = false;
        deckState.pausedAt = 0;
        this.onTrackEnd?.(deck);
      }
    };
  }

  pause(deck: DeckId): void {
    const deckState = this.decks[deck];
    if (!deckState.isPlaying || !deckState.sourceNode) return;

    deckState.pausedAt = this.getCurrentTime(deck);
    deckState.sourceNode.stop();
    deckState.sourceNode.disconnect();
    deckState.sourceNode = null;
    deckState.isPlaying = false;
  }

  stop(deck: DeckId): void {
    const deckState = this.decks[deck];
    if (deckState.sourceNode) {
      try {
        deckState.sourceNode.stop();
        deckState.sourceNode.disconnect();
      } catch (e) {
        // Ignore errors from already stopped sources
      }
    }
    deckState.sourceNode = null;
    deckState.isPlaying = false;
    deckState.pausedAt = 0;
    deckState.currentTime = 0;
  }

  getCurrentTime(deck: DeckId): number {
    const deckState = this.decks[deck];
    if (!this.audioContext || !deckState.isPlaying) {
      return deckState.pausedAt;
    }
    const elapsed = (this.audioContext.currentTime - deckState.startedAt) * deckState.playbackRate;
    return Math.min(elapsed, deckState.duration);
  }

  getDuration(deck: DeckId): number {
    return this.decks[deck].duration;
  }

  isPlaying(deck: DeckId): boolean {
    return this.decks[deck].isPlaying;
  }

  setTempo(deck: DeckId, ratio: number): void {
    const deckState = this.decks[deck];
    deckState.playbackRate = ratio;
    
    if (deckState.sourceNode) {
      deckState.sourceNode.playbackRate.value = ratio;
    }
  }

  getTempo(deck: DeckId): number {
    return this.decks[deck].playbackRate;
  }

  setCrossfade(value: number): void {
    this.crossfadeValue = Math.max(0, Math.min(1, value));
    this.updateCrossfade();
  }

  private updateCrossfade(): void {
    if (!this.decks.A.gainNode || !this.decks.B.gainNode) return;

    // Equal power crossfade
    const gainA = Math.cos(this.crossfadeValue * Math.PI * 0.5);
    const gainB = Math.sin(this.crossfadeValue * Math.PI * 0.5);
    
    this.decks.A.gainNode.gain.value = gainA;
    this.decks.B.gainNode.gain.value = gainB;
  }

  async crossfade(seconds: number): Promise<void> {
    if (!this.audioContext || !this.decks.A.gainNode || !this.decks.B.gainNode) return;

    const startTime = this.audioContext.currentTime;
    const endTime = startTime + seconds;

    // Current crossfade position determines direction
    const startValue = this.crossfadeValue;
    const endValue = startValue < 0.5 ? 1 : 0;

    const gainA = this.decks.A.gainNode.gain;
    const gainB = this.decks.B.gainNode.gain;

    // Cancel any ongoing transitions
    gainA.cancelScheduledValues(startTime);
    gainB.cancelScheduledValues(startTime);

    // Set current values
    gainA.setValueAtTime(Math.cos(startValue * Math.PI * 0.5), startTime);
    gainB.setValueAtTime(Math.sin(startValue * Math.PI * 0.5), startTime);

    // Ramp to new values
    gainA.linearRampToValueAtTime(Math.cos(endValue * Math.PI * 0.5), endTime);
    gainB.linearRampToValueAtTime(Math.sin(endValue * Math.PI * 0.5), endTime);

    this.crossfadeValue = endValue;
  }

  seek(deck: DeckId, time: number): void {
    const deckState = this.decks[deck];
    const wasPlaying = deckState.isPlaying;
    
    if (wasPlaying) {
      this.pause(deck);
    }
    
    deckState.pausedAt = Math.max(0, Math.min(time, deckState.duration));
    
    if (wasPlaying) {
      this.play(deck);
    }
  }

  setMasterVolume(value: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, value));
    }
  }

  // Quantized scratch effect
  performScratch(deck: DeckId, type: ScratchType, intensity: number = 0.5): void {
    if (!this.audioContext || !this.decks[deck].audioBuffer || !this.decks[deck].isPlaying) return;
    
    const deckState = this.decks[deck];
    const bpm = deckState.baseBpm || 120;
    const beatDuration = 60 / bpm; // seconds per beat
    const envelope = SCRATCH_ENVELOPES[type];
    const scratchDuration = envelope.duration * beatDuration * 1000; // ms
    
    // Store original playback rate
    const originalRate = deckState.playbackRate;
    
    // Apply scratch envelope
    let step = 0;
    const steps = envelope.envelope;
    
    const applyStep = () => {
      if (step >= steps.length - 1) {
        // Reset to original
        this.setTempo(deck, originalRate);
        return;
      }
      
      const [, rateMultiplier] = steps[step];
      const scaledRate = originalRate * (1 + (rateMultiplier - 1) * intensity);
      this.setTempo(deck, scaledRate);
      
      step++;
      const nextTime = (steps[step][0] - steps[step - 1][0]) * scratchDuration;
      this.scratchTimeout = window.setTimeout(applyStep, nextTime);
    };
    
    // Clear any existing scratch
    if (this.scratchTimeout) {
      clearTimeout(this.scratchTimeout);
    }
    
    applyStep();
  }

  destroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.scratchTimeout) {
      clearTimeout(this.scratchTimeout);
    }
    this.stop('A');
    this.stop('B');
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// Singleton instance
export const audioEngine = new AudioEngine();
