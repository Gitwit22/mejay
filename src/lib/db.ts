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
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  crossfadeSeconds: number;
  maxTempoPercent: number;
  energyMode: 'chill' | 'normal' | 'hype';
  shuffleEnabled: boolean;
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

  dbInstance = await openDB<MeJayDB>('me-jay-db', 1, {
    upgrade(db) {
      // Tracks store
      const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
      trackStore.createIndex('by-name', 'displayName');
      trackStore.createIndex('by-bpm', 'bpm');

      // Playlists store
      const playlistStore = db.createObjectStore('playlists', { keyPath: 'id' });
      playlistStore.createIndex('by-name', 'name');

      // Settings store
      db.createObjectStore('settings', { keyPath: 'id' });
    },
  });

  return dbInstance;
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
