import {buildReleaseShareMeta, type ShareableRelease} from '../../../src/lib/shareMeta'
import {fetchPublicData, servePageWithShareMeta, type PreviewEnv} from '../../_lib/share-preview'

const RELEASE_ID = /^[A-Za-z0-9_-]{1,80}$/

/**
 * Shared store links (/app/store/<releaseId>, what the Share button copies): the preview shows
 * the cover art and "<Title> by <Artist> · Buy now on MeJay". Only releases the public store
 * lists (live, or open for pre-order) get a preview; anything else gets the plain app page.
 */
export const onRequest: PagesFunction<PreviewEnv> = async ({request, env, params}) =>
  servePageWithShareMeta(request, env, async (origin) => {
    const releaseId = String(params.releaseId ?? '')
    if (!RELEASE_ID.test(releaseId)) return null
    const data = await fetchPublicData<{release?: ShareableRelease}>(env, `/api/store/releases/${encodeURIComponent(releaseId)}`)
    return data?.release ? buildReleaseShareMeta(data.release, origin) : null
  })
