import {Building2, Check, ExternalLink, Mic2, Music2, type LucideIcon} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {
  PARTNER_CATEGORIES,
  getPartners,
  partnerLaunchUrl,
  partnersInCategory,
  type Partner,
  type PartnerCategoryId,
} from '@/lib/partners'

const categoryIcons: Record<PartnerCategoryId, LucideIcon> = {beats: Music2, shows: Mic2, venues: Building2}

/** Artist portal "Partners" section: outside services MeJay artists can use. */
export function ProviderPartners({partners = getPartners()}: {partners?: Partner[]}) {
  return <div className="space-y-8">
    <div>
      <h1 className="text-2xl font-bold">Partners</h1>
      <p className="mt-1 text-sm text-zinc-400">Services from across the MeJay ecosystem to help you make, perform and promote your music.</p>
    </div>
    {PARTNER_CATEGORIES.map((category) => {
      const Icon = categoryIcons[category.id]
      const items = partnersInCategory(partners, category.id)
      return <section key={category.id} aria-labelledby={`partners-${category.id}`} className="space-y-4 border-t border-white/10 pt-7">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 text-emerald-400" aria-hidden="true" />
          <div>
            <h2 id={`partners-${category.id}`} className="text-lg font-semibold">{category.label}</h2>
            <p className="text-sm text-zinc-400">{category.description}</p>
          </div>
        </div>
        {items.length === 0
          ? <ComingSoonCategory label={category.label} />
          : <div className="grid gap-4 md:grid-cols-2">{items.map((partner) => <PartnerCard key={partner.id} partner={partner} />)}</div>}
      </section>
    })}
  </div>
}

function PartnerCard({partner}: {partner: Partner}) {
  const launchUrl = partnerLaunchUrl(partner)
  return <article className="flex flex-col rounded-md border border-white/10 bg-[#141417] p-5">
    {partner.logo && <img src={partner.logo.src} alt={`${partner.name} logo`} width={partner.logo.width} height={partner.logo.height} loading="lazy" decoding="async" className="mb-4 h-16 w-auto self-start object-contain" />}
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="font-semibold">{partner.name}</h3>
      {launchUrl
        ? <span className="rounded-full border border-emerald-400/40 px-2.5 py-1 text-xs text-emerald-300">Available</span>
        : <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-zinc-400">Coming soon</span>}
    </div>
    <p className="mt-1 text-sm text-zinc-300">{partner.tagline}</p>
    <p className="mt-3 text-sm text-zinc-400">{partner.description}</p>
    {partner.highlights.length > 0 && <ul className="mt-4 space-y-1.5 text-sm text-zinc-300">
      {partner.highlights.map((highlight) => <li key={highlight} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />{highlight}</li>)}
    </ul>}
    {launchUrl && <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
      <Button asChild className="gap-2 bg-emerald-400 text-zinc-950 hover:bg-emerald-300">
        <a href={launchUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" />Open {partner.name}</a>
      </Button>
      {/* Partners keep their own accounts until shared sign-in exists; say so rather than imply a connection. */}
      <p className="text-xs text-zinc-500">Opens in a new tab. {partner.name} uses its own account.</p>
    </div>}
  </article>
}

function ComingSoonCategory({label}: {label: string}) {
  return <div className="rounded-md border border-dashed border-white/10 p-5 text-sm text-zinc-500">
    <p className="font-medium text-zinc-300">{label} partners are coming soon.</p>
    <p className="mt-1">We'll list them here as they join MeJay.</p>
  </div>
}
