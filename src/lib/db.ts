import { openDB, deleteDB, DBSchema, IDBPDatabase } from 'idb';

export const MEJAY_DB_NAME = 'me-jay-db';

export interface Track {
  id: string;
  localPath: string;
  displayName: string;
  artist?: string;
  duration: number;
  /**
   * Precomputed “musical end” time (seconds) used for transition planning.
   * This trims streaming padding / trailing silence so auto-mix avoids dead air.
   */
  trueEndTime?: number;
  bpm?: number;
  hasBeat: boolean;
  analysisStatus: 'pending' | 'analyzing' | 'ready' | 'basic';
  fileBlob?: Blob;
  addedAt: number;
  // Auto volume matching
  loudnessDb?: number; // Measured loudness in dB (RMS proxy)
  gainDb?: number; // Calculated gain to apply
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PartySource {
  type: 'import' | 'playlist';
  playlistId?: string;
}

export interface Settings {
  crossfadeSeconds: number;
  maxTempoPercent: number;
  shuffleEnabled: boolean;
  /** When false, imported audio is kept in-memory only (not persisted to IndexedDB). */
  keepImportsOnDevice: boolean;
  /** Prev button behavior. */
  prevBehavior: 'restartFirst' | 'alwaysMixPrevious';
  // Master output
  masterVolume: number; // 0..1
  // Mix timing controls
  nextSongStartOffset: number; // seconds into next song to start
  endEarlySeconds?: number; // fade out this many seconds before current track ends
  // Tempo controls
  /** UI mode: which tempo control UI to show (vibes presets vs advanced controls). */
  tempoUiMode: 'vibes' | 'advanced';
  /** Remembers which advanced mode (auto/locked) was last used. */
  lastAdvancedTempoMode: 'auto' | 'locked';
  tempoMode: 'auto' | 'locked' | 'preset';
  /** Discrete tempo vibe presets (used when tempoMode === 'preset'). */
  tempoPreset: 'original' | 'chill' | 'upbeat' | 'club' | 'fast';
  lockedBpm: number;
  /** 0..100 - allowed BPM drift before correcting back to lockedBpm. */
  lockTolerancePct: number;
  // Auto tempo baseline + offset (Auto Match)
  autoBaseBpm: number | null;
  autoOffsetBpm: number;
  /** Party Mode: what happens after a tempo-matched transition (auto mode only). */
  partyTempoAfterTransition?: 'hold' | 'revert';
  // Volume matching
  autoVolumeMatch: boolean;
  targetLoudness: number; // 0-1 scale (quiet to club)
  limiterEnabled: boolean;
  limiterStrength: 'light' | 'medium' | 'strong';
  /** Master tone preset applied pre-limiter. */
  vibesPreset: 'flat' | 'warm' | 'bright' | 'club' | 'vocal';
  // Party mode
  /**
   * Repeat behavior in Party Mode.
   * - off: stop at end of queue
   * - playlist: wrap to start of queue
   * - track: repeat current track only (hard restart)
   */
  repeatMode: 'off' | 'playlist' | 'track';
}

interface MeJayDB extends DBSchema {
  tracks: {
    key: string;
    value: Track;
    indexes: { 'by-name': string; 'by-bpm': number };
  };
  playlists: {
    key: string;
    value: Playlist;
    indexes: { 'by-name': string };
  };
  settings: {
    key: string;
    value: Settings;
  };
}

let dbInstance: IDBPDatabase<MeJayDB> | null = null;

const stripLegacySettingsKeys = (value: unknown): Partial<Settings> => {
  if (!value || typeof value !== 'object') return {};
  const {
    // Legacy automation settings (removed)
    energyMode: _energyMode,
    mixTriggerMode: _mixTriggerMode,
    mixTriggerSeconds: _mixTriggerSeconds,
    ...rest
  } = value as Record<string, unknown>;
  return rest as Partial<Settings>;
};

export async function getDB(): Promise<IDBPDatabase<MeJayDB>> {
  if (dbInstance) return dbInstance;

  try {
    if (import.meta.env.DEV) {
      console.debug('[DB] Opening IndexedDB...');
    }
    dbInstance = await openDB<MeJayDB>(MEJAY_DB_NAME, 3, {
      async upgrade(db, oldVersion, newVersion, transaction) {
        if (import.meta.env.DEV) {
          console.debug('[DB] Upgrading from version', oldVersion, 'to', newVersion);
        }
        
        // Tracks store
        if (!db.objectStoreNames.contains('tracks')) {
          if (import.meta.env.DEV) {
            console.debug('[DB] Creating tracks store');
          }
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('by-name', 'displayName');
          trackStore.createIndex('by-bpm', 'bpm');
        }

        // Playlists store
        if (!db.objectStoreNames.contains('playlists')) {
          if (import.meta.env.DEV) {
            console.debug('[DB] Creating playlists store');
          }
          const playlistStore = db.createObjectStore('playlists', { keyPath: 'id' });
          playlistStore.createIndex('by-name', 'name');
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          if (import.meta.env.DEV) {
            console.debug('[DB] Creating settings store');
          }
          db.createObjectStore('settings', { keyPath: 'id' });
        }

        // v3: remove legacy automation keys from persisted settings.
        if (oldVersion < 3) {
          try {
            const settingsStore = transaction.objectStore('settings');
            const existing = await settingsStore.get('default');
            if (existing) {
              const cleaned = stripLegacySettingsKeys(existing);
              await settingsStore.put({ ...cleaned, id: 'default' } as Settings & { id: string });
            }
          } catch (error) {
            console.error('[DB] Failed to migrate settings to v3:', error);
          }
        }
      },
      blocked() {
        console.warn('[DB] Database upgrade blocked - close other tabs');
      },
      blocking() {
        console.warn('[DB] This connection is blocking an upgrade');
        dbInstance?.close();
        dbInstance = null;
      },
      terminated() {
        console.warn('[DB] Database connection terminated unexpectedly');
        dbInstance = null;
      },
    });
    if (import.meta.env.DEV) {
      console.debug('[DB] Database opened successfully');
    }
    return dbInstance;
  } catch (error) {
    console.error('[DB] Failed to open database:', error);
    throw error;
  }
}

export async function resetLocalDatabase(): Promise<void> {
  try {
    dbInstance?.close();
  } catch {
    // ignore
  }

  dbInstance = null;

  await deleteDB(MEJAY_DB_NAME, {
    blocked() {
      console.warn('[DB] Delete blocked - close other tabs');
    },
  });
}

// Track operations
export async function addTrack(track: Track): Promise<void> {
  const db = await getDB();
  await db.put('tracks', track);
}

export async function getTrack(id: string): Promise<Track | undefined> {
  const db = await getDB();
  return db.get('tracks', id);
}

export async function getAllTracks(): Promise<Track[]> {
  const db = await getDB();
  return db.getAll('tracks');
}

export async function updateTrack(id: string, updates: Partial<Track>): Promise<void> {
  const db = await getDB();
  const track = await db.get('tracks', id);
  if (track) {
    await db.put('tracks', { ...track, ...updates });
  }
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('tracks', id);
}

// Playlist operations
export async function addPlaylist(playlist: Playlist): Promise<void> {
  const db = await getDB();
  await db.put('playlists', playlist);
}

export async function getPlaylist(id: string): Promise<Playlist | undefined> {
  const db = await getDB();
  return db.get('playlists', id);
}

export async function getAllPlaylists(): Promise<Playlist[]> {
  const db = await getDB();
  return db.getAll('playlists');
}

export async function updatePlaylist(id: string, updates: Partial<Playlist>): Promise<void> {
  const db = await getDB();
  const playlist = await db.get('playlists', id);
  if (playlist) {
    await db.put('playlists', { ...playlist, ...updates, updatedAt: Date.now() });
  }
}

export async function deletePlaylist(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('playlists', id);
}

// Bulk clear operations
export async function clearTracksAndPlaylists(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['tracks', 'playlists'], 'readwrite');
  await tx.objectStore('tracks').clear();
  await tx.objectStore('playlists').clear();
  await tx.done;
}

// Settings operations
export async function getSettings(): Promise<Settings> {
  const db = await getDB();
  const settings = await db.get('settings', 'default');
  const DEFAULT_MAX_SHIFT_PCT = 8;
  const ABSOLUTE_MAX_SHIFT_PCT = 12;
  const defaults: Settings = {
    crossfadeSeconds: 8,
    maxTempoPercent: DEFAULT_MAX_SHIFT_PCT,
    shuffleEnabled: false,
    keepImportsOnDevice: true,
    prevBehavior: 'alwaysMixPrevious',
    masterVolume: 0.9,
    nextSongStartOffset: 15,
    endEarlySeconds: 5,
    tempoUiMode: 'vibes',
    lastAdvancedTempoMode: 'auto',
    tempoMode: 'preset',
    tempoPreset: 'original',
    lockedBpm: 128,
    lockTolerancePct: 10,
    autoBaseBpm: null,
    autoOffsetBpm: 0,
    partyTempoAfterTransition: 'hold',
    autoVolumeMatch: true,
    targetLoudness: 0.7,
    limiterEnabled: true,
    limiterStrength: 'medium',
    vibesPreset: 'flat',
    repeatMode: 'playlist',
  };

  // Merge to backfill new fields for existing users.
  const merged = settings ? { ...defaults, ...stripLegacySettingsKeys(settings) } : defaults;

  const rawPrevBehavior = (merged as any).prevBehavior;
  const prevBehavior = rawPrevBehavior === 'alwaysMixPrevious' || rawPrevBehavior === 'restartFirst'
    ? rawPrevBehavior
    : defaults.prevBehavior;

  const rawRepeatMode = (merged as any).repeatMode;
  const legacyLoopPlaylist = Boolean((merged as any).loopPlaylist);
  const repeatMode: Settings['repeatMode'] = rawRepeatMode === 'off' || rawRepeatMode === 'playlist' || rawRepeatMode === 'track'
    ? rawRepeatMode
    : (legacyLoopPlaylist ? 'playlist' : 'off');

  const rawTempoMode = (merged as any).tempoMode;
  const tempoMode: Settings['tempoMode'] = rawTempoMode === 'locked' || rawTempoMode === 'preset' ? rawTempoMode : 'auto';

  const rawTempoPreset = (merged as any).tempoPreset;
  const tempoPreset: Settings['tempoPreset'] =
    // Migrate legacy 'normal' -> 'upbeat' (same BPM target as old Normal).
    rawTempoPreset === 'normal'
      ? 'upbeat'
      : rawTempoPreset === 'slow'
        ? 'chill'
      : (
          rawTempoPreset === 'original' ||
          rawTempoPreset === 'chill' ||
          rawTempoPreset === 'upbeat' ||
          rawTempoPreset === 'club' ||
          rawTempoPreset === 'fast'
            ? rawTempoPreset
            : defaults.tempoPreset
        );

  const rawVibesPreset = (merged as any).vibesPreset;
  const vibesPreset: Settings['vibesPreset'] =
    rawVibesPreset === 'flat' ||
    rawVibesPreset === 'warm' ||
    rawVibesPreset === 'bright' ||
    rawVibesPreset === 'club' ||
    rawVibesPreset === 'vocal'
      ? rawVibesPreset
      : defaults.vibesPreset;

  // Normalize tempo safety clamp.
  const rawMaxTempoPercent = Number((merged as any).maxTempoPercent);
  const clampedMaxTempoPercent = Number.isFinite(rawMaxTempoPercent)
    ? Math.max(0, Math.min(ABSOLUTE_MAX_SHIFT_PCT, rawMaxTempoPercent))
    : defaults.maxTempoPercent;
  const snappedMaxTempoPercent = Math.round(clampedMaxTempoPercent);

  // Normalize BPM-related settings to match UI behavior.
  const rawLocked = Number((merged as any).lockedBpm);
  const clampedLocked = Number.isFinite(rawLocked) ? Math.max(60, Math.min(300, rawLocked)) : defaults.lockedBpm;
  const snappedLocked = Math.round(clampedLocked / 5) * 5;

  const rawOffset = Number((merged as any).autoOffsetBpm);
  const clampedOffset = Number.isFinite(rawOffset) ? Math.max(-150, Math.min(150, rawOffset)) : defaults.autoOffsetBpm;
  const snappedOffset = Math.round(clampedOffset / 5) * 5;

  // Snap lock tolerance to 5% increments (UI + engine expect bigger steps).
  const rawPct = Number((merged as any).lockTolerancePct);
  const clampedPct = Number.isFinite(rawPct) ? Math.max(0, Math.min(100, rawPct)) : defaults.lockTolerancePct;
  const snappedPct = Math.round(clampedPct / 5) * 5;

  return {
    ...merged,
    tempoMode,
    tempoPreset,
    prevBehavior,
    repeatMode,
    vibesPreset,
    maxTempoPercent: snappedMaxTempoPercent,
    lockedBpm: snappedLocked,
    autoOffsetBpm: snappedOffset,
    lockTolerancePct: snappedPct,
  };
}

export async function updateSettings(updates: Partial<Settings>): Promise<void> {
  const db = await getDB();
  const current = await getSettings();
  await db.put('settings', { ...current, ...stripLegacySettingsKeys(updates), id: 'default' } as Settings & { id: string });
}

// Generate unique ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
