import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOCALE, isLocale, SUPPORTED_LOCALES } from '../src/lib/i18n/locale';
import { formatAmount } from '../src/lib/i18n/format';
import en from '../src/lib/i18n/messages/en';
import fa from '../src/lib/i18n/messages/fa';
import { messages } from '../src/lib/i18n/messages';
import { getLocale, LOCALE_KEY, saveLocale } from '../src/lib/storage';

function stubLocalStorage(initial: Record<string, string>): void {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('locale', () => {
  it('accepts en and fa, rejects everything else', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fa')).toBe(true);
    expect(isLocale('EN')).toBe(false);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });

  it('defaults to fa and lists both supported locales', () => {
    expect(DEFAULT_LOCALE).toBe('fa');
    expect(SUPPORTED_LOCALES).toEqual(['en', 'fa']);
  });

  it('getLocale returns the default when localStorage is unavailable', () => {
    expect(getLocale()).toBe('fa');
  });

  it('getLocale returns the stored locale and falls back on invalid values', () => {
    stubLocalStorage({ [LOCALE_KEY]: 'en' });
    expect(getLocale()).toBe('en');

    stubLocalStorage({ [LOCALE_KEY]: 'fr' });
    expect(getLocale()).toBe('fa');

    stubLocalStorage({ [LOCALE_KEY]: '' });
    expect(getLocale()).toBe('fa');
  });

  it('saveLocale writes the locale and getLocale reads it back', () => {
    stubLocalStorage({});
    saveLocale('en');
    expect(getLocale()).toBe('en');
    saveLocale('fa');
    expect(getLocale()).toBe('fa');
  });
});

describe('dictionaries', () => {
  it('en and fa expose the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fa).sort());
  });

  it('messages is keyed by every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(messages[locale]).toBeDefined();
    }
  });
});

describe('formatAmount', () => {
  it('renders Latin digits for English', () => {
    expect(formatAmount('en', '1.5')).toBe('1.5');
    expect(formatAmount('en', '123')).toBe('123');
  });

  it('renders Persian digits for Persian', () => {
    expect(formatAmount('fa', '1.5')).toBe('۱٫۵');
    expect(formatAmount('fa', '123')).toBe('۱۲۳');
  });

  it('returns the input unchanged when it is not a finite number', () => {
    expect(formatAmount('en', 'not-a-number')).toBe('not-a-number');
  });
});
