import {useEffect} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Eye, ExternalLink, Share2} from 'lucide-react'
import {Link, useParams} from 'react-router-dom'

import {ArtistPageTopBar, ArtistPageView} from '@/app/pages/ArtistPage'
import {StoreLoading} from '@/app/pages/MusicStorePage'
import {Button} from '@/components/ui/button'
import {useResolvedAuthStatus} from '@/hooks/useResolvedAuthStatus'
import {shareLink} from '@/lib/shareLink'
import {artistPreviewImageUrl, getArtistPagePreview, type ArtistPageVisibility} from '@/lib/musicStoreApi'

const ARTIST_PORTAL = '/app/artist'

/** Plain-language reason shown to the artist; mirrors the API's visibility rule. */
function visibilityMessage(visibility: ArtistPageVisibility): string {
  if (visibility.public) return 'Your page is public. This is what fans see.'
  if (visibility.suspended) return 'Your page is hidden while your artist account is suspended.'
  return 'Only you can see this preview. Connect Stripe payouts (or get a release approved and live) to make your page public.'
}

/**
 * Shares the public page link.
 * Only rendered once the page is public, so the link always works for whoever receives it.
 */
function ShareArtistPageButton({name, slug}: {name: string; slug: string}) {
  const share = () => shareLink(`${name} on MeJay`, `${window.location.origin}/artist/${slug}`)
  return <Button size="sm" className="gap-2" onClick={() => void share()}><Share2 className="h-3.5 w-3.5" />Share link</Button>
}

/** The signed-in artist's own page at /artist-preview/:artistId, shown whether or not it is public yet. */
export default function ArtistPagePreview() {
  const {artistId = ''} = useParams()
  const authStatus = useResolvedAuthStatus()
  const page = useQuery({
    queryKey: ['artist-page-preview', artistId],
    queryFn: () => getArtistPagePreview(artistId),
    enabled: Boolean(artistId) && authStatus === 'authenticated',
    retry: false,
  })
  useEffect(() => {
    if (page.data) document.title = `Preview: ${page.data.artist.name} | MeJay`
  }, [page.data])

  if (authStatus === 'unknown' || page.isLoading) return <StoreLoading />
  if (authStatus !== 'authenticated' || page.isError || !page.data) {
    return <div className="min-h-screen bg-[#0a0a0b] text-zinc-100">
      <ArtistPageTopBar to={authStatus === 'authenticated' ? ARTIST_PORTAL : '/login'} label={authStatus === 'authenticated' ? 'Back to MeJay' : 'Sign in to MeJay'} />
      <div className="grid min-h-[60vh] place-items-center px-6 text-center">
        <div>
          <p className="font-semibold">Artist page preview unavailable</p>
          <p className="mt-2 text-sm text-zinc-400">{authStatus === 'authenticated' ? page.error?.message ?? 'This artist was not found on your account.' : 'Sign in with the account that owns this artist to preview the page.'}</p>
        </div>
      </div>
    </div>
  }

  const {artist, releases, visibility} = page.data
  const topBar = <ArtistPageTopBar to={ARTIST_PORTAL}>
    <p className="flex min-w-0 basis-full items-center gap-2 text-xs text-zinc-300 sm:basis-auto sm:flex-1 sm:text-sm" role="status">
      <Eye className="h-4 w-4 shrink-0" />{visibilityMessage(visibility)}
    </p>
    {visibility.public && <div className="flex gap-2">
      <ShareArtistPageButton name={artist.name} slug={artist.slug} />
      <Button asChild size="sm" variant="outline" className="gap-2"><Link to={`/artist/${artist.slug}`}>Open public page<ExternalLink className="h-3.5 w-3.5" /></Link></Button>
    </div>}
  </ArtistPageTopBar>
  return <ArtistPageView artist={artist} releases={releases} imageUrl={(assetId) => artistPreviewImageUrl(artist.id, assetId)} topBar={topBar} />
}
