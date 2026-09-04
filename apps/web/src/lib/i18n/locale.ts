export type Locale = 'en' | 'fa';

export const DEFAULT_LOCALE: Locale = 'fa';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'fa'];

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'fa';
}
