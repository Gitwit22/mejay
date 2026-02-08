import {useMemo, useState} from 'react'
import {useNavigate, useSearchParams, Link} from 'react-router-dom'
import {toast} from '@/hooks/use-toast'
import {MEJAY_LOGO_URL} from '@/lib/branding'

type Step = 'email' | 'code'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const returnTo = useMemo(() => {
    const rt = searchParams.get('returnTo')
    return rt && rt.startsWith('/') ? rt : '/app'
  }, [searchParams])

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/start', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({email}),
      })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `Start failed (${res.status})`)
      }

      if (typeof data?.devCode === 'string' && data.devCode.trim()) {
        toast({title: 'Dev code', description: `Code: ${data.devCode}`})
      } else {
        toast({title: 'Check your email', description: 'Enter the 6-digit code we sent you.'})
      }

      setStep('code')
    } catch (e) {
      toast({
        title: 'Login failed',
        description: e instanceof Error ? e.message : 'Could not start login.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({email, code}),
      })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `Verify failed (${res.status})`)
      }

      toast({title: 'Signed in', description: 'Welcome back.'})
      navigate(returnTo, {replace: true})
    } catch (e) {
      toast({
        title: 'Invalid code',
        description: e instanceof Error ? e.message : 'Could not verify code.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md glass-card p-6">
        <div className="flex flex-col items-center text-center gap-2 mb-6">
          <img src={MEJAY_LOGO_URL} alt="MEJay" className="h-20 w-auto object-contain" />
          <h1 className="text-xl font-bold">Sign in</h1>
          <p className="text-sm text-muted-foreground">Use your email to get a code.</p>
        </div>

        {step === 'email' && (
          <div className="space-y-3">
            <label className="block text-sm font-medium">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              placeholder="you@example.com"
              autoComplete="email"
            />
            <button
              type="button"
              onClick={start}
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-primary to-secondary text-white font-semibold disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </div>
        )}

        {step === 'code' && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Code sent to <span className="text-foreground font-medium">{email}</span>
            </div>
            <label className="block text-sm font-medium">6-digit code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 tracking-widest"
              placeholder="123456"
            />
            <button
              type="button"
              onClick={verify}
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-primary to-secondary text-white font-semibold disabled:opacity-60"
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => setStep('email')}
              disabled={busy}
              className="w-full py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"
            >
              Use a different email
            </button>
          </div>
        )}

        <div className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">Back to home</Link>
        </div>
      </div>
    </div>
  )
}
