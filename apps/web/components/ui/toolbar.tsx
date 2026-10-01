import Link from 'next/link';
import type { ReactNode } from 'react';

import { NavIcon } from '@/components/ui/icons';
import { t, type Locale } from '@/lib/i18n';

/**
 * A screen's top row: title, then the period, then the primary action on the
 * right. The action sits here rather than in the rail because it acts on the
 * period that is open — the two belong on the same line.
 */
export function Toolbar({
  title,
  subtitle,
  locale,
  children,
}: {
  title: string;
  subtitle?: string;
  locale: Locale;
  children?: ReactNode;
}) {
  return (
    <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-[18px] font-semibold leading-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 truncate text-[12px] text-[var(--color-muted)]">{subtitle}</p>
        ) : null}
      </div>

      {children}

      <Link
        href="/transactions/new"
        className="btn-accent ml-auto flex items-center gap-2 px-3.5 py-2 text-[12.5px] transition"
      >
        <NavIcon name="plus" size={13} />
        {t(locale, 'nav.newTransaction')}
        <span className="kbd bg-[var(--color-on-accent)]/20 text-[var(--color-on-accent)]">N</span>
      </Link>
    </header>
  );
}
