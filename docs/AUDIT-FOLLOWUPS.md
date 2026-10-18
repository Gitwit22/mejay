# Audit follow-ups

The October 2026 audit covered import, playback, plans and pricing, billing, auth and the marketplace. Every Critical, High, Medium and Low finding has been fixed except the items below. Each of these needs infrastructure or a product decision, not just a code change.

| Area | What's left | Why it isn't done | Suggested approach |
| --- | --- | --- | --- |
| Store artwork | Store cards load the original artwork, which can be up to 20 MB. Artwork is now cached privately for 5 minutes, but there are no thumbnails. | Needs image resizing on the server (for example `sharp` or Cloudflare Images) at upload time. | When an artwork upload is finalized, generate 300 px and 600 px variants and store them as extra assets. Have `/api/store/assets/:id` accept a size. |
| Store previews | Previews are capped at about 30 s and never more than 20% of the master, but they are still byte slices of the lossless file. | Needs an audio transcoding step (for example ffmpeg in a worker). | When an audio upload is finalized, transcode a 30–45 s MP3/AAC clip, store it as a `preview` asset, and serve only that. |
| Revenue splits | Splits drive earnings reports only. The whole payout goes to the provider's Stripe account, and the release wizard now says so. | Paying each collaborator directly is a product and compliance decision: payees need their own Connect accounts, and it changes tax reporting. | If wanted, onboard payees as Connect accounts and issue one transfer per split allocation in `ensureProviderTransfer`. |
| Rendering | Position updates are throttled, Party Mode mounts one layout, and queue lookups are O(1). Many components still call `useDJStore()` without a selector. | Converting every component is a broad, mechanical refactor with UI regression risk. | Switch components to `useDJStore(selector, shallow)` one at a time, starting with `NowPlaying`, `PartyQueuePanel` and `LibraryView`. |
