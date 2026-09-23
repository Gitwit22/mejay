export const STARTER_PACK_IDS = ['valentine-2026'] as const;

export type StarterPackId = (typeof STARTER_PACK_IDS)[number];

export type StarterTrack = {
  id: string;
  title: string;
  artist: string;
  url: string;
  isStarter: true;
  artworkUrl?: string;
  genre?: string;
  releaseYear?: number;
};

export type StarterPackDefinition = {
  id: StarterPackId;
  title: string;
  artist: string;
  tagline: string;
  description: string;
  artworkUrl: string;
  releaseYear: number;
  genres: string[];
  tracks: StarterTrack[];
};

const VALENTINE_2026_ARTWORK_URL = '/goodfeels.jpg';

export const valentine2026Pack: StarterTrack[] = [
  {
    id: 'val-01',
    title: 'Believe It',
    artist: 'John Blaze',
    url: '/starter-packs/valentine-2026/believe-it.mp3',
    isStarter: true,
    artworkUrl: VALENTINE_2026_ARTWORK_URL,
    genre: 'R&B',
    releaseYear: 2026,
  },
  {
    id: 'val-02',
    title: 'I Do',
    artist: 'John Blaze',
    url: '/starter-packs/valentine-2026/i-do.mp3',
    isStarter: true,
    artworkUrl: VALENTINE_2026_ARTWORK_URL,
    genre: 'R&B',
    releaseYear: 2026,
  },
  {
    id: 'val-03',
    title: 'SAYLESS',
    artist: 'John Blaze',
    url: '/starter-packs/valentine-2026/sayless.mp3',
    isStarter: true,
    artworkUrl: VALENTINE_2026_ARTWORK_URL,
    genre: 'Contemporary R&B',
    releaseYear: 2026,
  },
  {
    id: 'val-04',
    title: 'Sundress',
    artist: 'John Blaze',
    url: '/starter-packs/valentine-2026/sundress.mp3',
    isStarter: true,
    artworkUrl: VALENTINE_2026_ARTWORK_URL,
    genre: 'Slow Jam',
    releaseYear: 2026,
  },
  {
    id: 'val-05',
    title: 'Turnstyle',
    artist: 'John Blaze',
    url: '/starter-packs/valentine-2026/turnstyle.mp3',
    isStarter: true,
    artworkUrl: VALENTINE_2026_ARTWORK_URL,
    genre: 'Party Warmup',
    releaseYear: 2026,
  },
];

export const starterPacksCatalog: StarterPackDefinition[] = [
  {
    id: 'valentine-2026',
    title: 'Valentine 2026',
    artist: 'John Blaze',
    tagline: 'Featured Music Store release',
    description: 'Five ready-to-mix tracks you can load instantly to test Play Mode, playlists, and transitions.',
    artworkUrl: VALENTINE_2026_ARTWORK_URL,
    releaseYear: 2026,
    genres: ['R&B', 'Slow Jam', 'Party Warmup'],
    tracks: valentine2026Pack,
  },
];

export function isStarterPackId(value: string): value is StarterPackId {
  return STARTER_PACK_IDS.includes(value as StarterPackId);
}

export function getStarterPackById(id: StarterPackId): StarterPackDefinition | undefined {
  return starterPacksCatalog.find((pack) => pack.id === id);
}

export function getStarterPackName(id: StarterPackId): string {
  return getStarterPackById(id)?.title ?? id;
}

export function getStarterPackTracks(packIds: StarterPackId[]): StarterTrack[] {
  return packIds.flatMap((packId) => getStarterPackById(packId)?.tracks ?? []);
}
