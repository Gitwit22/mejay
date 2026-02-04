import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface Track {
  id: string;
  localPath: string;
  displayName: string;
  artist?: string;
  duration: number;
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
  energyMode: 'chill' | 'normal' | 'hype';
  shuffleEnabled: boolean;
  // Mix timing controls
  nextSongStartOffset: number; // seconds into next song to start
  mixTriggerMode: 'remaining' | 'elapsed' | 'manual';
  mixTriggerSeconds: number; // when to start bringing in next track
  // Tempo controls
  tempoMode: 'auto' | 'locked';
  lockedBpm: number;
  // Volume matching
  autoVolumeMatch: boolean;
  targetLoudness: number; // 0-1 scale (quiet to club)
  limiterEnabled: boolean;
  limiterStrength: 'light' | 'medium' | 'strong';
  // Party mode
  loopPlaylist: boolean;
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

export async function getDB(): Promise<IDBPDatabase<MeJayDB>> {
  if (dbInstance) return dbInstance;

  try {
    console.log('[DB] Opening IndexedDB...');
    dbInstance = await openDB<MeJayDB>('me-jay-db', 2, {
      upgrade(db, oldVersion, newVersion) {
        console.log('[DB] Upgrading from version', oldVersion, 'to', newVersion);
        
        // Tracks store
        if (!db.objectStoreNames.contains('tracks')) {
          console.log('[DB] Creating tracks store');
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('by-name', 'displayName');
          trackStore.createIndex('by-bpm', 'bpm');
        }

        // Playlists store
        if (!db.objectStoreNames.contains('playlists')) {
          console.log('[DB] Creating playlists store');
          const playlistStore = db.createObjectStore('playlists', { keyPath: 'id' });
          playlistStore.createIndex('by-name', 'name');
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          console.log('[DB] Creating settings store');
          db.createObjectStore('settings', { keyPath: 'id' });
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
    console.log('[DB] Database opened successfully');
    return dbInstance;
  } catch (error) {
    console.error('[DB] Failed to open database:', error);
    throw error;
  }
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

// Settings operations
export async function getSettings(): Promise<Settings> {
  const db = await getDB();
  const settings = await db.get('settings', 'default');
  return settings || {
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
  };
}

export async function updateSettings(updates: Partial<Settings>): Promise<void> {
  const db = await getDB();
  const current = await getSettings();
  await db.put('settings', { ...current, ...updates, id: 'default' } as Settings & { id: string });
}

// Generate unique ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
