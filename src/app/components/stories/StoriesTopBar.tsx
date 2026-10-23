import {Link} from 'react-router-dom'

import {MEJAY_LOGO_URL} from '@/lib/branding'

/** Header for public story pages: the MeJay logo, back to music discovery, and all stories. */
export function StoriesTopBar() {
  return <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0a0b]/90 text-zinc-100 backdrop-blur">
    <nav aria-label="MeJay" className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-8">
      <Link to="/app?tab=music" aria-label="MeJay home"><img src={MEJAY_LOGO_URL} alt="MeJay" className="h-10 w-auto" /></Link>
      <div className="ml-auto flex items-center gap-5 text-sm font-semibold">
        <Link to="/app?tab=music" className="hover:text-emerald-300">Music</Link>
        <Link to="/stories" className="hover:text-emerald-300">Stories</Link>
      </div>
    </nav>
  </header>
}
