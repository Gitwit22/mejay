export const STARTER_PACKS_CHOICE_MADE_KEY = 'mejay:starterPacksChoiceMade';
export const STARTER_PACKS_ENABLED_KEY = 'mejay:starterPacksEnabled';
export const STARTER_PROMPT_PENDING_KEY = 'mejay:starterPromptPending';
export const ONBOARDED_KEY = 'mejay:onboarded';

export type StarterPackId = 'valentine-2026';

export type StarterPacksPrefs = {
  choiceMade: boolean;
  enabledPackIds: StarterPackId[];
};

export const setStarterPromptPending = (value: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(STARTER_PROMPT_PENDING_KEY, 'true');
    else window.localStorage.removeItem(STARTER_PROMPT_PENDING_KEY);
  } catch {
    // ignore
  }
};

export const consumeStarterPromptPending = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const pending = window.localStorage.getItem(STARTER_PROMPT_PENDING_KEY) === 'true';
    if (pending) window.localStorage.removeItem(STARTER_PROMPT_PENDING_KEY);
    return pending;
  } catch {
    return false;
  }
};

export const setOnboarded = (value: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ONBOARDED_KEY, value ? 'true' : 'false');
  } catch {
    // ignore
  }
};

const safeParseJson = (raw: string | null): unknown => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const readStarterPacksPrefs = (): StarterPacksPrefs => {
  if (typeof window === 'undefined') {
    return { choiceMade: false, enabledPackIds: [] };
  }

  let choiceMade = false;
  let enabledPackIds: StarterPackId[] = [];

  try {
    const rawChoice = window.localStorage.getItem(STARTER_PACKS_CHOICE_MADE_KEY);
    choiceMade = rawChoice === '1' || rawChoice === 'true';
  } catch {
    // ignore
  }

  try {
    const rawEnabled = window.localStorage.getItem(STARTER_PACKS_ENABLED_KEY);
    const parsed = safeParseJson(rawEnabled);
    if (Array.isArray(parsed)) {
      enabledPackIds = parsed.filter((x): x is StarterPackId => x === 'valentine-2026');
    }
  } catch {
    // ignore
  }

  return { choiceMade, enabledPackIds };
};

export const writeStarterPacksPrefs = (prefs: StarterPacksPrefs): void => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(STARTER_PACKS_CHOICE_MADE_KEY, prefs.choiceMade ? 'true' : 'false');
  } catch {
    // ignore
  }

  try {
    window.localStorage.setItem(STARTER_PACKS_ENABLED_KEY, JSON.stringify(prefs.enabledPackIds ?? []));
  } catch {
    // ignore
  }
};
