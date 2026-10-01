import { cookies } from 'next/headers';

import type { Locale } from '@/lib/i18n';

/**
 * The active preferences, read from cookies so every server component can get
 * them without an API round trip. The cookies are set on sign-in (seeded from
 * the account) and on save (UC11). The account in the database stays the source
 * of truth; the cookies are the fast, per-request copy.
 */
export const LANG_COOKIE = 'cc_lang';
export const THEME_COOKIE = 'cc_theme';

export type Theme = 'system' | 'light' | 'dark';

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return v === 'en' ? 'en' : 'pt-BR';
}

export async function getTheme(): Promise<Theme> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return v === 'light' || v === 'dark' ? v : 'system';
}
