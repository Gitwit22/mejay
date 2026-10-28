import {ArrowLeft} from 'lucide-react'
import {Link, useLocation, useNavigate} from 'react-router-dom'

import {MEJAY_LOGO_URL} from '@/lib/branding'

/** Header for public story pages: back, the MeJay logo, music discovery, and all stories. */
export function StoriesTopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  // Opened from inside the app: go back to where the reader was. Opened from a shared link
  // (no earlier page in this session): go to Discover instead of leaving MeJay.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/app?tab=music'))
  return <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0a0b]/90 text-zinc-100 backdrop-blur">
    <nav aria-label="MeJay" className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-8">
      <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold text-zinc-300 hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">
        <ArrowLeft className="h-4 w-4" />Back
      </button>
      <Link to="/app?tab=music" aria-label="MeJay home"><img src={MEJAY_LOGO_URL} alt="MeJay" className="h-10 w-auto" /></Link>
      <div className="ml-auto flex items-center gap-5 text-sm font-semibold">
        <Link to="/app?tab=music" className="hover:text-emerald-300">Music</Link>
        <Link to="/stories" className="hover:text-emerald-300">Stories</Link>
      </div>
    </nav>
  </header>
}
