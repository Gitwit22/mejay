# MEJay Music Store Guide

This guide covers the bundled Music Store release that ships with MEJay and how to maintain its metadata.

## Current bundled release

- **Valentine 2026**
  - Pack ID: `valentine-2026`
  - Audio folder: `/public/starter-packs/valentine-2026/`
  - Catalog metadata: `/src/config/starterPacks.ts`

## Files involved

- `/src/config/starterPacks.ts` — release catalog, artwork, artist, genres, track metadata
- `/src/lib/starterPacksPrefs.ts` — persisted release preferences
- `/src/stores/djStore.ts` — library seeding + Music Store download logic
- `/src/components/StarterPacksOnboardingModal.tsx` — first-run Music Store prompt
- `/src/components/DownloadPacksModal.tsx` — Settings → Music Store dialog

## Updating the bundled release

1. Add or remove MP3 files in `/public/starter-packs/valentine-2026/`.
2. Update the `valentine2026Pack` entries in `/src/config/starterPacks.ts`.
3. Keep each track entry in sync with the file system:
   - `id`
   - `title`
   - `artist`
   - `url`
   - `artworkUrl`
   - optional metadata like `genre` and `releaseYear`
4. Update the `starterPacksCatalog` entry if the release artwork, title, tagline, description, year, or genres change.

## Testing

- `bun run test src/config/starterPacks.test.ts src/lib/starterPacksPrefs.test.ts`
- Clear `mejay:starterPacksChoiceMade` and `mejay:starterPacksEnabled` in localStorage if you want to see onboarding again.

## Notes

- The old Party Pack has been retired and is no longer part of the Music Store catalog.
- Bundled releases are still stored locally on the device after download.
