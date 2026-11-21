import {buildArtistShareMeta, type ShareableArtist} from '../../src/lib/shareMeta'
import {fetchPublicData, servePageWithShareMeta, type PreviewEnv} from '../_lib/share-preview'

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Shared artist pages (/artist/<slug>): the preview shows the artist's name, tagline and photo. */
export const onRequest: PagesFunction<PreviewEnv> = async ({request, env, params}) =>
  servePageWithShareMeta(request, env, async (origin) => {
    const slug = String(params.slug ?? '').toLowerCase()
    if (!SLUG.test(slug) || slug.length > 80) return null
    const data = await fetchPublicData<{artist?: ShareableArtist}>(env, `/api/store/artists/${slug}`)
    return data?.artist ? buildArtistShareMeta(data.artist, origin) : null
  })
