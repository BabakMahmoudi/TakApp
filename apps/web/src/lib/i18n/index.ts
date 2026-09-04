import { useContext } from 'react';
import { I18nContext } from './provider';
import type { I18nContextValue } from './provider';

export * from './locale';
export * from './format';
export * from './messages';
export { I18nContext, I18nProvider } from './provider';
export type { I18nContextValue } from './provider';

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used within an I18nProvider');
  return value;
}
