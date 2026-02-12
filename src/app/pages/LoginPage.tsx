import {useEffect, useMemo, useState} from 'react'
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
    const raw = (rt ?? '').trim()
    if (!raw) return '/app'
    if (!raw.startsWith('/')) return '/app'
    if (raw.startsWith('//')) return '/app'
    if (raw.includes('://')) return '/app'
    // Never redirect *to* login after a successful login.
    if (raw.startsWith('/login') || raw.includes('/login')) return '/app'
    return raw
  }, [searchParams])

  const [mode, setMode] = useState<Mode>('password')
  const [codeStep, setCodeStep] = useState<CodeStep>('email')
  const [purpose, setPurpose] = useState<Purpose>('signup_verify')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [verifiedToken, setVerifiedToken] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const intent = (searchParams.get('intent') ?? '').toLowerCase()
    if (intent !== 'signup') return
    goToCreateAccount()
    // Only run when intent changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const goToCreateAccount = () => {
    setPurpose('signup_verify')
    setCodeStep('email')
    setCode('')
    setMode('code')
  }

  const login = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({email, password, rememberMe}),
      })
      const data = (await res.json().catch(() => null)) as any
      if (res.ok && data?.ok) {
        toast({title: 'Signed in', description: 'Welcome back.'})
        // Avoid /app redirect loop by marking authenticated immediately.
        usePlanStore.getState().markAuthenticated({email})
        // Best-effort: hydrate user + entitlements from the server.
        void usePlanStore.getState().refreshFromServer({reason: 'postLogin'})
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
        credentials: 'include',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({email, verifiedToken, password, rememberMe}),
      })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `Set password failed (${res.status})`)
      }

      toast({title: 'Signed in', description: 'Welcome back.'})
      usePlanStore.getState().markAuthenticated({email})
      void usePlanStore.getState().refreshFromServer({reason: 'postSetPassword'})
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
          {mode === 'setPassword' && (
            <p className="text-sm text-muted-foreground">
              {purpose === 'password_reset' ? 'Choose a new password.' : 'Create a password for your account.'}
            </p>
          )}
        </div>

        {mode === 'password' && (
          <form
            className="space-y-3"
            autoComplete="on"
            onSubmit={(e) => {
              e.preventDefault()
              void login()
            }}
          >
            <label className="block text-sm font-medium" htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              placeholder="you@example.com"
              required
            />
            <label className="block text-sm font-medium" htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              placeholder="Your password"
              required
            />

            <div className="flex items-center gap-2 pt-1">
              <input
                id="remember-me"
                name="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <label htmlFor="remember-me" className="text-sm text-muted-foreground select-none">
                Remember me for 30 days
              </label>
            </div>
            <button
              type="submit"
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
                onClick={goToCreateAccount}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground"
              >
                Create account
              </button>
            </div>
          </form>
        )}

        {mode === 'code' && codeStep === 'email' && (
          <form
            className="space-y-3"
            autoComplete="on"
            onSubmit={(e) => {
              e.preventDefault()
              void startCode()
            }}
          >
            <label className="block text-sm font-medium" htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              placeholder="you@example.com"
              required
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-primary to-secondary text-white font-semibold disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setMode('password')}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground"
              >
                Back to password
              </button>
              <button
                type="button"
                onClick={() => setPurpose(purpose === 'signup_verify' ? 'password_reset' : 'signup_verify')}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground"
              >
                {purpose === 'signup_verify' ? 'Reset password instead' : 'Create account instead'}
              </button>
            </div>
          </form>
        )}

        {mode === 'code' && codeStep === 'code' && (
          <form
            className="space-y-3"
            autoComplete="on"
            onSubmit={(e) => {
              e.preventDefault()
              void verifyCode()
            }}
          >
            <div className="text-sm text-muted-foreground">
              Code sent to <span className="text-foreground font-medium">{email}</span>
            </div>
            <label className="block text-sm font-medium" htmlFor="code">6-digit code</label>
            <input
              id="code"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 tracking-widest"
              placeholder="123456"
            />
            <button
              type="submit"
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
          </form>
        )}

        {mode === 'setPassword' && (
          <form
            className="space-y-3"
            autoComplete="on"
            onSubmit={(e) => {
              e.preventDefault()
              void setNewPassword()
            }}
          >
            <div className="text-sm text-muted-foreground">
              Setting password for <span className="text-foreground font-medium">{email}</span>
            </div>
            <label className="block text-sm font-medium" htmlFor="new-password">New password</label>
            <input
              id="new-password"
              name="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
            />
            <label className="block text-sm font-medium" htmlFor="new-password-confirm">Confirm password</label>
            <input
              id="new-password-confirm"
              name="new-password-confirm"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              type="password"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              placeholder="Retype password"
              autoComplete="new-password"
              required
            />

            <div className="flex items-center gap-2 pt-1">
              <input
                id="remember-me"
                name="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <label htmlFor="remember-me" className="text-sm text-muted-foreground select-none">
                Remember me for 30 days
              </label>
            </div>
            <button
              type="submit"
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
          </form>
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
