import type {NavigateFunction, NavigateOptions} from 'react-router-dom'

export type AppTabId = 'library' | 'party' | 'playlists'

export type SettingsReturnTo = {
  tab?: AppTabId
}

export const SETTINGS_RETURN_TO_STORAGE_KEY = 'settings:returnTo'

const LAST_TAB_STORAGE_KEY = 'mejay:lastTab'

const isAppTabId = (value: unknown): value is AppTabId =>
  value === 'library' || value === 'party' || value === 'playlists'

const safeSessionGetItem = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

const safeSessionSetItem = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

const safeSessionRemoveItem = (key: string) => {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export const computeSettingsReturnToFromSession = (): SettingsReturnTo | null => {
  const tab = safeSessionGetItem(LAST_TAB_STORAGE_KEY)
  if (tab === 'party') return {tab: 'party'}
  return null
}

export const persistSettingsReturnTo = (value: SettingsReturnTo | null) => {
  if (!value) {
    safeSessionRemoveItem(SETTINGS_RETURN_TO_STORAGE_KEY)
    return
  }

  try {
    safeSessionSetItem(SETTINGS_RETURN_TO_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // ignore
  }
}

export const readPersistedSettingsReturnTo = (): SettingsReturnTo | null => {
  const raw = safeSessionGetItem(SETTINGS_RETURN_TO_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const tab = (parsed as any).tab
    if (tab == null) return {}
    if (!isAppTabId(tab)) return null
    return {tab}
  } catch {
    return null
  }
}

export const readReturnToFromNavigateState = (state: unknown): SettingsReturnTo | null => {
  if (!state || typeof state !== 'object') return null
  const rt = (state as any).returnTo as unknown
  if (!rt || typeof rt !== 'object') return null

  const tab = (rt as any).tab
  if (tab == null) return {}
  if (!isAppTabId(tab)) return null
  return {tab}
}

export const resolveEffectiveSettingsReturnTo = (state: unknown): SettingsReturnTo | null => {
  return readReturnToFromNavigateState(state) ?? readPersistedSettingsReturnTo()
}

export const withSettingsReturnToState = (
  options: NavigateOptions | undefined,
  returnTo: SettingsReturnTo | null,
): NavigateOptions | undefined => {
  if (!returnTo) return options

  const prevState = options?.state
  const nextState = {
    ...(prevState && typeof prevState === 'object' ? (prevState as any) : {}),
    returnTo,
  }

  return {
    ...options,
    state: nextState,
  }
}

export const getSettingsEntryNavigateOptions = (options?: NavigateOptions): NavigateOptions | undefined => {
  const returnTo = computeSettingsReturnToFromSession()
  // Clear stale values when not entering from Party Mode.
  persistSettingsReturnTo(returnTo)
  return withSettingsReturnToState(options, returnTo)
}

export const navigateBackToPartyMode = (
  navigate: NavigateFunction,
  state: unknown,
  options?: Omit<NavigateOptions, 'replace'>,
) => {
  // Requirement: always return to Party Mode.
  const returnTo = resolveEffectiveSettingsReturnTo(state)
  const tab: AppTabId = returnTo?.tab === 'party' ? 'party' : 'party'

  safeSessionSetItem(LAST_TAB_STORAGE_KEY, tab)
  safeSessionRemoveItem(SETTINGS_RETURN_TO_STORAGE_KEY)

  navigate('/app?tab=party', {
    ...options,
    replace: true,
  })
}
