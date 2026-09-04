import type { Locale } from '../locale';
import en from './en';
import type { Messages } from './en';
import fa from './fa';

export type { Messages };

export const messages: Record<Locale, Messages> = { en, fa };
