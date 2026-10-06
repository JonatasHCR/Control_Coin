import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { apiFetch, SESSION_COOKIE, type AccountTree } from '@/lib/api';
import { CommandBar, type Command } from '@/components/command';
import { NotificationCentre } from '@/components/notification-centre';
import { Money } from '@/components/ui/money';
import { NavIcon, type NavIconName } from '@/components/ui/icons';
import { t, type Locale, type MessageKey } from '@/lib/i18n';
import { getLocale } from '@/lib/prefs';

async function signOut(): Promise<void> {
  'use server';
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/sign-in');
}

const NAV: { href: string; key: MessageKey; icon: NavIconName; chord: string | null }[] = [
  { href: '/', key: 'nav.dashboard', icon: 'dashboard', chord: 'd' },
  { href: '/transactions', key: 'nav.transactions', icon: 'transactions', chord: 't' },
  { href: '/planned', key: 'nav.planned', icon: 'planned', chord: null },
  { href: '/accounts', key: 'nav.accounts', icon: 'accounts', chord: 'a' },
  { href: '/planning', key: 'nav.planning', icon: 'planning', chord: 'p' },
  { href: '/invoices', key: 'nav.invoices', icon: 'invoices', chord: 'f' },
  { href: '/categories', key: 'nav.categories', icon: 'categories', chord: 'c' },
  { href: '/data', key: 'nav.data', icon: 'data', chord: null },
  { href: '/preferences', key: 'nav.prefs', icon: 'prefs', chord: null },
];

/**
 * The application shell: the rail sits directly on the page ground — only the
 * search bar, the active item and the scope well get a surface, so the
 * screen's own cards stay the figure. The primary action is NOT here: it lives
 * at the right of each screen's toolbar, beside the period.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  if (!(await cookies()).get(SESSION_COOKIE)) redirect('/sign-in');
  const locale = await getLocale();
  const scopes = await walletScopes(locale);

  const commands: Command[] = NAV.map((item) => ({
    href: item.href,
    label: t(locale, item.key),
    icon: item.icon,
    chord: item.chord,
  }));

  return (
    <div className="grid min-h-screen grid-cols-[214px_1fr] max-md:grid-cols-1">
      <aside className="flex flex-col gap-3 p-3 max-md:gap-2">
        <div className="flex items-center gap-2.5 px-1.5 pt-1">
          <span className="grid h-7 w-7 place-items-center rounded-[10px] bg-[var(--color-accent-well)] text-[var(--color-accent)]">
            <NavIcon name="brand" />
          </span>
          <span className="font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-tight">
            Control_Coin
          </span>
          <span className="ml-auto">
            <NotificationCentre locale={locale} />
          </span>
        </div>

        <CommandBar
          commands={commands}
          openLabel={t(locale, 'cmd.open')}
          placeholder={t(locale, 'cmd.placeholder')}
          emptyLabel={t(locale, 'cmd.empty')}
          newLabel={t(locale, 'nav.newTransaction')}
          newHref="/transactions/new"
        />

        <nav className="flex flex-col gap-px max-md:flex-row max-md:overflow-x-auto">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 rounded-[11px] px-2.5 py-[7px] text-[13px] text-[var(--color-ink-2)] transition hover:bg-[var(--color-well)] hover:text-[var(--color-ink)]"
            >
              <span className="text-[var(--color-muted)]">
                <NavIcon name={item.icon} />
              </span>
              <span className="max-md:hidden">{t(locale, item.key)}</span>
              {item.chord ? (
                <span className="kbd ml-auto max-md:hidden">G {item.chord.toUpperCase()}</span>
              ) : null}
            </Link>
          ))}
        </nav>

        {scopes.length > 0 ? (
          <div className="rounded-[14px] bg-[var(--color-inset)] px-3 py-2.5 max-md:hidden">
            <div className="label mb-1.5">{t(locale, 'cmd.scope')}</div>
            <div className="flex flex-col gap-1">
              {scopes.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="flex items-baseline justify-between gap-2 text-[12px] text-[var(--color-ink-2)] transition hover:text-[var(--color-ink)]"
                >
                  <span className="truncate">{s.name}</span>
                  <Money value={s.balance} locale={locale} className="shrink-0 text-[var(--color-muted)]" />
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-auto flex flex-col gap-2 max-md:mt-0">
          <p className="note max-md:hidden">{t(locale, 'cmd.runningMonth')}</p>
          <form action={signOut} className="px-2">
            <button className="text-[12px] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]">
              {t(locale, 'nav.signOut')} →
            </button>
          </form>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-[1200px] p-5 pb-14 max-md:p-4">{children}</main>
    </div>
  );
}

/**
 * BR16 — every wallet is a report scope, and so is an account with no wallet.
 * A failure here must not take the whole shell down: the rail's scope list is
 * a convenience, not the screen.
 */
async function walletScopes(
  locale: Locale,
): Promise<{ href: string; name: string; balance: string }[]> {
  try {
    const tree = await apiFetch<AccountTree>('/accounts');
    return [
      ...tree.wallets.map((w) => ({ href: `/?scope=${w.id}`, name: w.name, balance: w.balance })),
      ...tree.unassigned.map((a) => ({ href: `/?scope=${a.id}`, name: a.name, balance: a.balance })),
    ];
  } catch {
    void locale;
    return [];
  }
}
