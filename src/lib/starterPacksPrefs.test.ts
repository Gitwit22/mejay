import { describe, it, expect, beforeEach } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

global.localStorage = localStorageMock as Storage;

import {
  setStarterPromptPending,
  consumeStarterPromptPending,
  setOnboarded,
  readStarterPacksPrefs,
  writeStarterPacksPrefs,
  type StarterPacksPrefs,
  STARTER_PACKS_ENABLED_KEY,
} from './starterPacksPrefs';

describe('starterPacksPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('starter prompt pending', () => {
    it('should set and consume starter prompt pending', () => {
      setStarterPromptPending(true);
      expect(consumeStarterPromptPending()).toBe(true);
    });

    it('should return false when not pending', () => {
      expect(consumeStarterPromptPending()).toBe(false);
    });

    it('should clear after consuming', () => {
      setStarterPromptPending(true);
      consumeStarterPromptPending();
      expect(consumeStarterPromptPending()).toBe(false);
    });

    it('should handle setting false', () => {
      setStarterPromptPending(true);
      setStarterPromptPending(false);
      expect(consumeStarterPromptPending()).toBe(false);
    });
  });

  describe('onboarding status', () => {
    it('should set onboarded to true', () => {
      setOnboarded(true);
      const value = localStorage.getItem('mejay:onboarded');
      expect(value).toBe('true');
    });

    it('should set onboarded to false', () => {
      setOnboarded(false);
      const value = localStorage.getItem('mejay:onboarded');
      expect(value).toBe('false');
    });
  });

  describe('starter packs preferences', () => {
    it('should read default preferences', () => {
      const prefs = readStarterPacksPrefs();
      expect(prefs.choiceMade).toBe(false);
      expect(Array.isArray(prefs.enabledPackIds)).toBe(true);
    });

    it('should write and read preferences', () => {
      const prefs: StarterPacksPrefs = {
        choiceMade: true,
        enabledPackIds: ['valentine-2026'],
      };
      writeStarterPacksPrefs(prefs);
      const read = readStarterPacksPrefs();
      expect(read).toEqual(prefs);
    });

    it('should drop retired or invalid pack ids from storage', () => {
      localStorage.setItem(STARTER_PACKS_ENABLED_KEY, JSON.stringify(['valentine-2026', 'party-pack', 'bad-id']));
      const read = readStarterPacksPrefs();
      expect(read.enabledPackIds).toEqual(['valentine-2026']);
    });
  });
});
