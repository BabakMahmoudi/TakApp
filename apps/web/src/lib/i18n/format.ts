import type { Locale } from './locale';

export function formatAmount(locale: Locale, value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    maximumFractionDigits: 7,
  }).format(number);
}
