# MEJay Starter Packs Guide

Complete guide for managing MEJay's starter pack system - adding songs to existing packs or creating entirely new packs.

---

## Table of Contents

1. [Overview](#overview)
2. [Adding Songs to Existing Packs](#adding-songs-to-existing-packs)
3. [Creating a New Starter Pack](#creating-a-new-starter-pack)
4. [File Structure](#file-structure)
5. [Troubleshooting](#troubleshooting)

---

## Overview

MEJay's starter pack system provides curated music collections that users can download when they first use the app. Each pack contains pre-selected tracks that are automatically loaded into the user's library.

**Current Starter Packs:**
- 🎉 **Party Pack**: High-energy tracks for parties
- 💝 **Valentine 2026**: Romance-themed tracks

**Key Files:**
- `/src/config/starterPacks.ts` - Pack definitions and track metadata
- `/public/starter-packs/` - Audio files organized by pack
- `/src/lib/starterPacksPrefs.ts` - Pack ID types and preferences
- `/src/stores/djStore.ts` - Pack loading logic
- `/src/components/StarterPacksOnboardingModal.tsx` - Pack selection UI
- `/src/components/DownloadPacksModal.tsx` - Pack download UI

---

## Adding Songs to Existing Packs

### Step 1: Add the Audio File

1. Navigate to the appropriate pack folder:
   - Party Pack: `/public/starter-packs/party-pack/`
   - Valentine 2026: `/public/starter-packs/valentine-2026/`

2. Add your MP3 file to the folder
   - Use lowercase with hyphens (e.g., `new-song.mp3`)
   - Ensure the file is properly encoded (MP3 format recommended)

**Example:**
```
/public/starter-packs/party-pack/
├── im-so-lit-clean.mp3
├── its-a-celebration.mp3
├── money-right.mp3
├── on-tha-move.mp3
├── strawberry-and-lime-liquor.mp3
└── new-song.mp3  ← Your new file
```

### Step 2: Update the Pack Configuration

Open `/src/config/starterPacks.ts` and add the track metadata to the appropriate pack array.

**For Party Pack:**

```typescript
export const partyPack: StarterTrack[] = [
  // ... existing tracks ...
  {
    id: "party-07",                                      // Increment the number
    title: "Your Song Title",                            // Display name
    artist: "Artist Name",                               // Artist name
    url: "/starter-packs/party-pack/new-song.mp3",      // Path to file
    isStarter: true,                                     // Always true
  },
];
```

**For Valentine 2026 Pack:**

```typescript
export const valentine2026Pack: StarterTrack[] = [
  // ... existing tracks ...
  {
    id: "val-06",                                        // Increment the number
    title: "Your Song Title",
    artist: "Artist Name",
    url: "/starter-packs/valentine-2026/new-song.mp3",  // Path to file
    isStarter: true,
  },
];
```

### Step 3: Verify Your Changes

1. **Check the file path**: Ensure the `url` field matches the actual file location
2. **Unique ID**: Make sure the `id` field is unique within the pack
3. **Sequential numbering**: Follow the existing ID pattern (e.g., `party-01`, `party-02`)

### Step 4: Test

1. Run the development server:
   ```bash
   npm run dev
   ```

2. Clear browser storage to reset onboarding:
   - Open DevTools → Application → Local Storage
   - Delete `mejay:starterPacksChoiceMade` and `mejay:onboarded`

3. Refresh the page and select the pack you modified

4. Verify the new song appears in your library

---

## Creating a New Starter Pack

### Step 1: Create the Folder Structure

1. Create a new folder in `/public/starter-packs/`:

```
/public/starter-packs/
├── party-pack/
├── valentine-2026/
└── summer-vibes/  ← Your new pack
```

2. Add your MP3 files to the new folder:

```
/public/starter-packs/summer-vibes/
├── beach-party.mp3
├── sunshine-groove.mp3
├── tropical-beat.mp3
└── wave-rider.mp3
```

### Step 2: Define the Pack in starterPacks.ts

Open `/src/config/starterPacks.ts` and add your new pack array:

```typescript
export const summerVibesPack: StarterTrack[] = [
  {
    id: "summer-01",
    title: "Beach Party",
    artist: "John Blaze",
    url: "/starter-packs/summer-vibes/beach-party.mp3",
    isStarter: true,
  },
  {
    id: "summer-02",
    title: "Sunshine Groove",
    artist: "John Blaze",
    url: "/starter-packs/summer-vibes/sunshine-groove.mp3",
    isStarter: true,
  },
  {
    id: "summer-03",
    title: "Tropical Beat",
    artist: "John Blaze",
    url: "/starter-packs/summer-vibes/tropical-beat.mp3",
    isStarter: true,
  },
  {
    id: "summer-04",
    title: "Wave Rider",
    artist: "John Blaze",
    url: "/starter-packs/summer-vibes/wave-rider.mp3",
    isStarter: true,
  },
];
```

### Step 3: Add the Pack ID Type

Open `/src/lib/starterPacksPrefs.ts` and update the `StarterPackId` type:

**Before:**
```typescript
export type StarterPackId = 'valentine-2026' | 'party-pack';
```

**After:**
```typescript
export type StarterPackId = 'valentine-2026' | 'party-pack' | 'summer-vibes';
```

### Step 4: Import and Use the Pack in djStore

Open `/src/stores/djStore.ts`:

1. **Add the import** at the top (around line 12):

```typescript
import { valentine2026Pack, partyPack, summerVibesPack } from '@/config/starterPacks';
```

2. **Update the seeding logic** in the `seedStarterTracksIfEmpty` method (around line 659):

Find this section:
```typescript
for (const starter of valentine2026Pack) {
  if (!seenStarterIds.has(starter.id)) {
    const track = await this.addStarterTrackToLibrary(starter);
    if (track) added.push(track);
  }
}
```

Add your pack logic:
```typescript
if (enabledPackIds.includes('summer-vibes')) {
  for (const starter of summerVibesPack) {
    if (!seenStarterIds.has(starter.id)) {
      const track = await this.addStarterTrackToLibrary(starter);
      if (track) added.push(track);
    }
  }
}
```

3. **Update the download logic** in the `downloadStarterPacks` method (around line 1115):

Find this section:
```typescript
const tracksToAdd: typeof valentine2026Pack = [];

if (packIds.includes('valentine-2026')) {
  tracksToAdd.push(...valentine2026Pack);
}
if (packIds.includes('party-pack')) {
  tracksToAdd.push(...partyPack);
}
```

Add your pack:
```typescript
if (packIds.includes('summer-vibes')) {
  tracksToAdd.push(...summerVibesPack);
}
```

### Step 5: Add Pack to the UI

#### Update StarterPacksOnboardingModal

Open `/src/components/StarterPacksOnboardingModal.tsx`:

1. **Add the constant** (around line 16):

```typescript
const SUMMER_PACK_ID: StarterPackId = 'summer-vibes';
```

2. **Add the UI option** in the modal (find the checkbox section):

```tsx
<div className="flex items-start gap-3 p-4 rounded-lg border border-border hover:border-primary/50 transition-colors">
  <Checkbox
    id="pack-summer"
    checked={selectedPacks.includes(SUMMER_PACK_ID)}
    onCheckedChange={(checked) => {
      if (checked) {
        setSelectedPacks([...selectedPacks, SUMMER_PACK_ID]);
      } else {
        setSelectedPacks(selectedPacks.filter(id => id !== SUMMER_PACK_ID));
      }
    }}
  />
  <div className="space-y-1 flex-1">
    <label 
      htmlFor="pack-summer"
      className="text-sm font-medium leading-none cursor-pointer"
    >
      🌴 Summer Vibes (4 tracks)
    </label>
    <p className="text-xs text-muted-foreground">
      Beach-ready hits to keep the summer flowing
    </p>
  </div>
</div>
```

#### Update DownloadPacksModal

Open `/src/components/DownloadPacksModal.tsx` and make similar changes to add the pack option.

### Step 6: Test Your New Pack

1. Run the development server:
   ```bash
   npm run dev
   ```

2. Clear browser storage:
   - Open DevTools → Application → Local Storage
   - Delete all `mejay:*` keys

3. Refresh and verify:
   - ✅ New pack appears in onboarding modal
   - ✅ Pack checkbox works correctly
   - ✅ Selecting pack loads tracks into library
   - ✅ All tracks play correctly
   - ✅ Track metadata displays properly

---

## File Structure

### Complete Directory Layout

```
mejay/
├── public/
│   └── starter-packs/
│       ├── party-pack/
│       │   ├── im-so-lit-clean.mp3
│       │   ├── its-a-celebration.mp3
│       │   ├── money-right.mp3
│       │   ├── no-friends.mp3
│       │   ├── on-tha-move.mp3
│       │   └── strawberry-and-lime-liquor.mp3
│       └── valentine-2026/
│           ├── believe-it.mp3
│           ├── i-do.mp3
│           ├── sayless.mp3
│           ├── sundress.mp3
│           └── turnstyle.mp3
└── src/
    ├── config/
    │   └── starterPacks.ts           ← Track definitions
    ├── lib/
    │   └── starterPacksPrefs.ts      ← Pack ID types
    ├── stores/
    │   └── djStore.ts                ← Pack loading logic
    └── components/
        ├── StarterPacksOnboardingModal.tsx  ← First-time UI
        └── DownloadPacksModal.tsx           ← Download UI
```

### Code Flow

```
User selects packs in modal
          ↓
StarterPacksOnboardingModal.tsx
          ↓
useDJStore.seedStarterTracksIfEmpty()
          ↓
djStore.ts loads tracks from starterPacks.ts
          ↓
Tracks added to user's library
```

---

## Troubleshooting

### Songs Not Appearing

**Problem:** Added songs don't show up in the library

**Solutions:**
1. ✅ Check file path matches exactly (case-sensitive on production)
2. ✅ Verify file is in `/public/starter-packs/[pack-name]/`
3. ✅ Clear browser cache and storage
4. ✅ Check browser console for 404 errors
5. ✅ Ensure MP3 file is properly encoded

### Pack Not Showing in Modal

**Problem:** New pack doesn't appear in the onboarding modal

**Solutions:**
1. ✅ Added pack ID to `StarterPackId` type in `starterPacksPrefs.ts`
2. ✅ Imported pack in `djStore.ts`
3. ✅ Added UI elements in both modal components
4. ✅ Cleared browser storage and refreshed

### Tracks Load But Don't Play

**Problem:** Tracks appear but won't play

**Solutions:**
1. ✅ Verify MP3 file is not corrupted
2. ✅ Check browser console for codec errors
3. ✅ Ensure file is accessible (test direct URL)
4. ✅ Try different audio encoding/bitrate

### TypeScript Errors

**Problem:** TypeScript compilation errors after changes

**Solutions:**
1. ✅ Ensure `StarterPackId` type includes new pack ID
2. ✅ Import statement includes all pack exports
3. ✅ Track objects match `StarterTrack` type exactly
4. ✅ Run `npm run build` to check for errors

### Testing Tips

1. **Use DevTools Network tab** to verify audio files load
2. **Check Console** for JavaScript errors
3. **Test in incognito** to ensure clean slate
4. **Verify file sizes** - large files may time out
5. **Test on mobile** - some formats don't work on all devices

---

## Quick Reference Checklist

### Adding a Song to Existing Pack

- [ ] Add MP3 file to `/public/starter-packs/[pack-name]/`
- [ ] Add track object to pack array in `starterPacks.ts`
- [ ] Verify unique ID and correct URL path
- [ ] Test in development

### Creating a New Pack

- [ ] Create folder in `/public/starter-packs/[new-pack-name]/`
- [ ] Add MP3 files to folder
- [ ] Create pack array in `starterPacks.ts`
- [ ] Add pack ID to `StarterPackId` type in `starterPacksPrefs.ts`
- [ ] Import pack in `djStore.ts`
- [ ] Add seeding logic in `seedStarterTracksIfEmpty()`
- [ ] Add download logic in `downloadStarterPacks()`
- [ ] Add UI checkbox in `StarterPacksOnboardingModal.tsx`
- [ ] Add UI checkbox in `DownloadPacksModal.tsx`
- [ ] Test thoroughly in development
- [ ] Test in production build

---

## Need Help?

If you encounter issues:
1. Check the browser DevTools console for errors
2. Verify all file paths are correct
3. Review this guide's troubleshooting section
4. Check existing packs for reference implementations

**Contact:** support@mejay.app

**Version:** 1.5.0  
**Last Updated:** February 13, 2026
