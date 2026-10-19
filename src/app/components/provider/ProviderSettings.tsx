import {useEffect, useState, type FormEvent} from 'react'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {ChevronRight, CreditCard, Loader2, WalletCards} from 'lucide-react'
import {Link} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Textarea} from '@/components/ui/textarea'
import {toast} from '@/hooks/use-toast'
import {getProviderStatusLabel, parseProviderStatus} from '@/lib/marketplace'
import {updateProviderSettings, type ProviderDashboard} from '@/lib/providerApi'
import {usePlanStore} from '@/stores/planStore'

type Provider = ProviderDashboard['provider']

type FormState = {displayName: string; legalName: string; contactEmail: string; countryCode: string; bio: string}

const ROLE_LABELS: Record<string, string> = {owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer'}

function formFrom(provider: Provider): FormState {
  return {
    displayName: provider.display_name ?? '',
    legalName: provider.legal_name ?? '',
    contactEmail: provider.contact_email ?? '',
    countryCode: provider.country_code ?? '',
    bio: provider.bio ?? '',
  }
}

/** Client-side checks mirror the API schema so most mistakes are caught before a round trip. */
function validate(form: FormState): string | null {
  if (!form.displayName.trim()) return 'Display name is required.'
  if (form.displayName.trim().length > 300 || form.legalName.trim().length > 300) return 'Names must be 300 characters or fewer.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) return 'Enter a valid contact email.'
  if (!/^[A-Za-z]{2}$/.test(form.countryCode.trim())) return 'Country must be a 2-letter code, like US.'
  if (form.bio.trim().length > 2000) return 'Bio must be 2,000 characters or fewer.'
  return null
}

/** Portal Settings: the account's business details, account facts, and shortcuts to payouts and billing. */
export function ProviderSettings({provider, onOpenPayout}: {provider: Provider; onOpenPayout: () => void}) {
  const queryClient = useQueryClient()
  const signInEmail = usePlanStore((state) => state.user?.email ?? null)
  const canEdit = provider.role === 'owner' || provider.role === 'admin'
  const [form, setForm] = useState<FormState>(() => formFrom(provider))
  const [error, setError] = useState<string | null>(null)
  // Pick up fresh server data (e.g. after a save elsewhere) without clobbering unsaved edits.
  const saved = formFrom(provider)
  const dirty = (Object.keys(saved) as Array<keyof FormState>).some((key) => form[key].trim() !== saved[key].trim())
  useEffect(() => {
    if (!dirty) setForm(formFrom(provider))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only resync when the server copy changes
  }, [provider])

  const save = useMutation({
    mutationFn: () => updateProviderSettings({
      displayName: form.displayName.trim(),
      legalName: form.legalName.trim() || null,
      contactEmail: form.contactEmail.trim(),
      countryCode: form.countryCode.trim().toUpperCase(),
      bio: form.bio.trim() || null,
    }),
    onSuccess: async (updated) => {
      setForm(formFrom(updated))
      await queryClient.invalidateQueries({queryKey: ['provider', 'dashboard']})
      toast({title: 'Settings saved'})
    },
    onError: (failure: Error) => setError(failure.message),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problem = validate(form)
    setError(problem)
    if (!problem) save.mutate()
  }
  const set = (patch: Partial<FormState>) => { setForm((current) => ({...current, ...patch})); setError(null) }

  return <div className="space-y-8">
    <div>
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-zinc-400">Your artist account's business details. Artist pages are edited from My Artists.</p>
    </div>

    <section aria-labelledby="business-heading" className="rounded-lg border border-white/10 bg-white/[0.02] p-4 sm:p-6">
      <h2 id="business-heading" className="font-semibold">Business profile</h2>
      <p className="mt-1 text-sm text-zinc-500">Used for your account, receipts and MeJay staff contact. Not shown on your artist page.</p>
      {!canEdit && <p className="mt-4 rounded-md border border-white/10 bg-white/5 p-3 text-sm text-zinc-300">Only the account owner or an admin can change these details.</p>}
      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
        <div className="space-y-2">
          <Label htmlFor="settings-display-name">Display name</Label>
          <Input id="settings-display-name" value={form.displayName} maxLength={300} disabled={!canEdit} onChange={(event) => set({displayName: event.target.value})} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-legal-name">Legal / business name (optional)</Label>
          <Input id="settings-legal-name" value={form.legalName} maxLength={300} disabled={!canEdit} onChange={(event) => set({legalName: event.target.value})} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-contact-email">Contact email</Label>
          <Input id="settings-contact-email" type="email" value={form.contactEmail} disabled={!canEdit} onChange={(event) => set({contactEmail: event.target.value})} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-country">Country (2-letter code)</Label>
          <Input id="settings-country" value={form.countryCode} maxLength={2} disabled={!canEdit} onChange={(event) => set({countryCode: event.target.value.toUpperCase()})} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="settings-bio">About (optional)</Label>
          <Textarea id="settings-bio" value={form.bio} maxLength={2000} rows={4} disabled={!canEdit} onChange={(event) => set({bio: event.target.value})} />
        </div>
        {error && <p role="alert" className="text-sm text-red-300 sm:col-span-2">{error}</p>}
        {canEdit && <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" disabled={!dirty || save.isPending} className="gap-2">{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save changes</Button>
          <Button type="button" variant="ghost" disabled={!dirty || save.isPending} onClick={() => { setForm(formFrom(provider)); setError(null) }}>Discard</Button>
        </div>}
      </form>
    </section>

    <section aria-labelledby="account-heading" className="rounded-lg border border-white/10 bg-white/[0.02] p-4 sm:p-6">
      <h2 id="account-heading" className="font-semibold">Account</h2>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Fact label="Account status" value={getProviderStatusLabel(parseProviderStatus(provider.status))} />
        <Fact label="Your role" value={ROLE_LABELS[provider.role] ?? provider.role} />
        <Fact label="Signed in as" value={signInEmail ?? '—'} />
        <Fact label="Account address" value={provider.slug ?? '—'} hint="Set at sign-up. Contact MeJay support to change it." />
        {provider.created_at && <Fact label="Member since" value={new Intl.DateTimeFormat('en-US', {year: 'numeric', month: 'long', day: 'numeric'}).format(new Date(provider.created_at))} />}
      </dl>
    </section>

    <section aria-labelledby="shortcuts-heading">
      <h2 id="shortcuts-heading" className="sr-only">Related settings</h2>
      <div className="divide-y divide-white/10 rounded-lg border border-white/10">
        <button type="button" onClick={onOpenPayout} className="flex w-full items-center gap-3 p-4 text-left hover:bg-white/5">
          <WalletCards className="h-5 w-5 text-emerald-400" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Payout account</span><span className="block text-xs text-zinc-500">Stripe bank details and payout status</span></span>
          <ChevronRight className="h-4 w-4 text-zinc-500" />
        </button>
        <Link to="/app/settings/billing" className="flex items-center gap-3 p-4 hover:bg-white/5">
          <CreditCard className="h-5 w-5 text-emerald-400" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Subscription &amp; billing</span><span className="block text-xs text-zinc-500">Your MeJay Pro plan, which artist access requires</span></span>
          <ChevronRight className="h-4 w-4 text-zinc-500" />
        </Link>
      </div>
    </section>
  </div>
}

function Fact({label, value, hint}: {label: string; value: string; hint?: string}) {
  return <div className="min-w-0">
    <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
    <dd className="mt-0.5 break-words text-zinc-200">{value}</dd>
    {hint && <dd className="text-xs text-zinc-500">{hint}</dd>}
  </div>
}
