# ME Jay (MEJay)

ME Jay is a browser-based “Auto DJ” web app built with React + Vite. It lets you import audio files, analyze BPM, build playlists (“Party Sets”), and run a Party Mode that auto-advances tracks with crossfading, tempo controls, and optional auto-volume/limiter features.

This repo is set up to use Bun (not npm) as the package manager/runtime.

## Quick start (Bun)

### 1) Install Bun

Verify Bun is installed:

```sh
bun --version
```

If that command is not found on Windows, install Bun and then restart your terminal so PATH updates take effect.

Official installer:

```sh
powershell -c "irm https://bun.sh/install.ps1 | iex"
```

### 2) Install dependencies

```sh
bun install
```

### 3) Run the dev server

```sh
bun dev
```

By default Vite runs on port `8080` in this project.

## Scripts

All scripts below are run with Bun:

```sh
# Dev
bun dev

# Production build
bun run build

# Development-mode build (Vite mode=development)
bun run build:dev

# Preview production build
bun run preview

# Lint
bun run lint

# Tests
bun run test
bun run test:watch
```

## Program rundown

### What the app does

- Library
	- Import audio files from your computer.
	- Tracks are stored in IndexedDB (metadata + the imported Blob while the browser keeps it).
	- Background BPM detection runs after import and labels tracks as `Analyzing`, `Ready`, or `Basic`.
	- Clicking a track loads it onto Deck A.

- Playlists (“Party Sets”)
	- Create playlists and add tracks from the Library.
	- Reorder playlist tracks via drag-and-drop.
	- Start Party Mode from a playlist and jump to the Party tab.

- Party Mode (Auto DJ)
	- Choose a source to play from:
		- Import List (all imported tracks)
		- Playlist
	- Shows Now Playing, Next Up, and a queue panel.
	- Auto-advances through the list and can loop the playlist.
	- Queue tools:
		- Shuffle (toggle + “Shuffle Now”)
		- Drag reorder
		- “Play Now” / “Play Next” actions

- Mixing features
	- Crossfade + mix timing controls (including “Mix Now” when in manual mode).
	- Tempo controls (auto-match / locked BPM, max tempo stretch, energy mode).
	- Auto volume matching + limiter controls.

### Important behavior/limitations (browser constraints)

- Imported audio files are user-provided local Blobs. Browsers do not give persistent file paths, and Blob availability can vary after refresh/restore depending on browser behavior.
- If you refresh and the app says tracks are “not playable”, re-import the files.

### How it’s built (high-level architecture)

- UI + routing
	- Single-page app with React Router.
	- Main screen is tab-based: Library / Party Mode / Playlists.

- State management
	- Zustand store drives the app state (tracks, playlists, party queue, deck state, settings).

- Persistence
	- IndexedDB via the `idb` package stores tracks/playlists/settings.

- Audio engine
	- Web Audio API dual-deck engine with:
		- Two decks (A/B)
		- Crossfade
		- Tempo via playbackRate
		- Loudness analysis and per-track gain
		- Limiter (DynamicsCompressorNode) with multiple strength presets

- BPM detection
	- Web Audio based BPM detection analyzes a mid-section of the track, finds peaks, and estimates tempo with a confidence score.

### “Free vs Plus” gating (dev)

The UI contains a simple plan feature gate (Free/Plus) used to lock some controls:

- Free: core playback, importing, playlists, basic party mode.
- Plus (dev toggle): enables advanced mix timing modes, tempo controls, and auto volume matching.

In development builds, a “Dev Plan Switcher” appears in the top-right to toggle Free/Plus.

## Tech stack

- Vite + React + TypeScript
- Tailwind CSS + shadcn/ui components
- Zustand (state)
- IndexedDB via `idb`
- Vitest (tests)

## Troubleshooting

### `bun` is not recognized (Windows)

- Install Bun and restart your terminal.
- If it still fails, make sure Bun’s install directory is on PATH.

### `bun dev` exits immediately

- Run `bun install` first.
- Then try `bun dev` again.
- If it still fails, paste the terminal output and we’ll chase the exact error.

## Deployment notes (SPA routing)

This is a React Router single-page app.

- For Cloudflare Pages / Netlify-style SPA refresh support on deep links like `/app/...`, this repo includes [public/_redirects](public/_redirects) so all routes serve `index.html`.
