import {useMemo, useState} from 'react'
import {useNavigate, useSearchParams, Link} from 'react-router-dom'
import {toast} from '@/hooks/use-toast'
import {MEJAY_LOGO_URL} from '@/lib/branding'
import {usePlanStore} from '@/stores/planStore'

type Mode = 'password' | 'code' | 'setPassword'
type CodeStep = 'email' | 'code'
type Purpose = 'signup_verify' | 'password_reset'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const authBypassEnabled = usePlanStore((s) => s.authBypassEnabled)
  const canToggleAuthBypass = usePlanStore((s) => s.canToggleAuthBypass)
  const setAuthBypassEnabled = usePlanStore((s) => s.setAuthBypassEnabled)

  const returnTo = useMemo(() => {
    const rt = searchParams.get('returnTo')
    return rt && rt.startsWith('/') ? rt : '/app'
  }, [searchParams])

  const [mode, setMode] = useState<Mode>('password')
  const [codeStep, setCodeStep] = useState<CodeStep>('email')
  const [purpose, setPurpose] = useState<Purpose>('signup_verify')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [verifiedToken, setVerifiedToken] = useState('')
  const [busy, setBusy] = useState(false)

  const login = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({email, password}),
      })
      const data = (await res.json().catch(() => null)) as any
      if (res.ok && data?.ok) {
        toast({title: 'Signed in', description: 'Welcome back.'})
        navigate(returnTo, {replace: true})
        return
      }

      if (data?.error === 'password_not_set') {
        toast({title: 'Password not set', description: 'Verify your email to set a password.'})
        setPurpose('signup_verify')
        setCodeStep('email')
        setMode('code')
        return
      }

      throw new Error(typeof data?.error === 'string' ? data.error : `Login failed (${res.status})`)
    } catch (e) {
      toast({
        title: 'Login failed',
        description: e instanceof Error ? e.message : 'Could not sign in.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const startCode = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/start', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({email, purpose}),
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

      setCodeStep('code')
    } catch (e) {
      toast({
        title: 'Could not send code',
        description: e instanceof Error ? e.message : 'Could not send code.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({email, code, purpose}),
      })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `Verify failed (${res.status})`)
      }

      if (typeof data?.verifiedToken !== 'string' || !data.verifiedToken.trim()) {
        throw new Error('Missing verifiedToken')
      }

      setVerifiedToken(String(data.verifiedToken))
      setPassword('')
      setPassword2('')
      setMode('setPassword')
      toast({title: 'Verified', description: 'Set your password to finish.'})
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

  const setNewPassword = async () => {
    if (password.length < 8) {
      toast({title: 'Password too short', description: 'Use at least 8 characters.', variant: 'destructive'})
      return
    }
    if (password !== password2) {
      toast({title: 'Passwords do not match', description: 'Please retype both fields.', variant: 'destructive'})
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({email, verifiedToken, password}),
      })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `Set password failed (${res.status})`)
      }

      toast({title: 'Signed in', description: 'Welcome back.'})
      navigate(returnTo, {replace: true})
    } catch (e) {
      toast({
        title: 'Could not set password',
        description: e instanceof Error ? e.message : 'Could not set password.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const bypass = () => {
    if (!canToggleAuthBypass) {
      toast({
        title: 'Bypass unavailable',
        description: 'Auth bypass is disabled in this build.',
        variant: 'destructive',
      })
      return
    }

    setAuthBypassEnabled(true)
    toast({title: 'Auth bypass enabled', description: 'Skipping login for this browser.'})
    navigate(returnTo, {replace: true})
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md glass-card p-6">
        <div className="flex flex-col items-center text-center gap-2 mb-6">
          <img src={MEJAY_LOGO_URL} alt="MEJay" className="h-20 w-auto object-contain" />
          <h1 className="text-xl font-bold">Sign in</h1>
          {mode === 'password' && <p className="text-sm text-muted-foreground">Sign in with your password.</p>}
          {mode === 'code' && (
            <p className="text-sm text-muted-foreground">
              {purpose === 'password_reset' ? 'Reset your password with a code.' : 'Verify your email to set a password.'}
            </p>
          )}
          {mode === 'setPassword' && <p className="text-sm text-muted-foreground">Choose a new password.</p>}
        </div>

        {mode === 'password' && (
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
            <label className="block text-sm font-medium">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              placeholder="Your password"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={login}
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-primary to-secondary text-white font-semibold disabled:opacity-60"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => {
                  setPurpose('password_reset')
                  setCodeStep('email')
                  setCode('')
                  setMode('code')
                }}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground"
              >
                Forgot password?
              </button>
              <button
                type="button"
                onClick={() => {
                  setPurpose('signup_verify')
                  setCodeStep('email')
                  setCode('')
                  setMode('code')
                }}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground"
              >
                Use a code instead
              </button>
            </div>
          </div>
        )}

        {mode === 'code' && codeStep === 'email' && (
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
              onClick={startCode}
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-primary to-secondary text-white font-semibold disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
            <button
              type="button"
              onClick={() => setMode('password')}
              disabled={busy}
              className="w-full py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"
            >
              Back to password
            </button>
          </div>
        )}

        {mode === 'code' && codeStep === 'code' && (
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
              onClick={verifyCode}
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-primary to-secondary text-white font-semibold disabled:opacity-60"
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => setCodeStep('email')}
              disabled={busy}
              className="w-full py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"
            >
              Use a different email
            </button>
          </div>
        )}

        {mode === 'setPassword' && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Setting password for <span className="text-foreground font-medium">{email}</span>
            </div>
            <label className="block text-sm font-medium">New password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <label className="block text-sm font-medium">Confirm password</label>
            <input
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              type="password"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              placeholder="Retype password"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={setNewPassword}
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-primary to-secondary text-white font-semibold disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Set password & sign in'}
            </button>
            <button
              type="button"
              onClick={() => {
                setVerifiedToken('')
                setMode('password')
              }}
              disabled={busy}
              className="w-full py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}

        <div className="mt-6 text-center text-xs text-muted-foreground">
          {canToggleAuthBypass && !authBypassEnabled && (
            <button
              type="button"
              onClick={bypass}
              className="block w-full mb-3 text-xs text-muted-foreground hover:text-foreground"
            >
              Bypass login (dev/demo)
            </button>
          )}

          {canToggleAuthBypass && authBypassEnabled && (
            <button
              type="button"
              onClick={() => setAuthBypassEnabled(false)}
              className="block w-full mb-3 text-xs text-muted-foreground hover:text-foreground"
            >
              Disable bypass
            </button>
          )}

          <Link to="/" className="hover:text-foreground">Back to home</Link>
        </div>
      </div>
    </div>
  )
}
