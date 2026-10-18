/** R2 prefix (folder) for every artist/marketplace upload in the private bucket. */
export const MARKETPLACE_STORAGE_PREFIX = 'mejay-artist/'
/** Prefix used before uploads moved under mejay-artist/; existing keys stay readable. */
const LEGACY_MARKETPLACE_STORAGE_PREFIX = 'marketplace/'

/** True for keys MeJay's marketplace wrote, so a stored key can never point elsewhere in the bucket. */
export function isMarketplaceStorageKey(key: string): boolean {
  return key.startsWith(MARKETPLACE_STORAGE_PREFIX) || key.startsWith(LEGACY_MARKETPLACE_STORAGE_PREFIX)
}
