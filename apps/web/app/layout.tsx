import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { getLocale, getTheme } from '@/lib/prefs';

import './globals.css';

/*
 * The faces live in `apps/web/fonts` (latin subset), so neither the build nor
 * the browser ever reaches a font CDN — `next/font/google` would have made
 * `docker build` depend on fonts.googleapis.com being up.
 *
 * Outfit and Nunito Sans are variable, hence one file across a weight range;
 * IBM Plex Mono ships one file per weight.
 */
const outfit = localFont({
  src: '../fonts/Outfit-variable.woff2',
  weight: '400 700',
  display: 'swap',
  variable: '--font-outfit',
});

const nunito = localFont({
  src: '../fonts/NunitoSans-variable.woff2',
  weight: '400 700',
  display: 'swap',
  variable: '--font-nunito',
});

const plexMono = localFont({
  src: [
    { path: '../fonts/IBMPlexMono-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/IBMPlexMono-500.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  title: 'Control_Coin',
  description: 'Personal finance tracker',
};

/**
 * The theme preference is applied here, on <html>, so it takes effect
 * across the whole app the instant it is saved. `light`/`dark` force the
 * choice; `system` leaves no class, so the OS preference (via the media query
 * in globals.css) decides. `lang` follows the language preference.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);
  const themeClass = theme === 'system' ? undefined : theme;

  const fonts = `${outfit.variable} ${nunito.variable} ${plexMono.variable}`;

  return (
    <html
      lang={locale}
      className={themeClass ? `${themeClass} ${fonts}` : fonts}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
