'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { BellIcon } from '@/components/ui/icons';
import { t, type Locale } from '@/lib/i18n';

interface Item {
  id: string;
  type: string;
  message: string;
  raisedAt: string;
  read: boolean;
  href: string | null;
}

/**
 * The notification centre — a bell in the top of the shell, next to the
 * brand, reachable from every screen and never a route. BR28: these are rows
 * read in-app; nothing is sent. The gear links to the configuration on the
 * preferences screen, where the alert rules live.
 */
export function NotificationCentre({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<{ unread: number; items: Item[] }>({ unread: 0, items: [] });
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    const res = await fetch('/api/notifications');
    if (res.ok) setFeed(await res.json());
  };

  useEffect(() => {
    void load();
    const timer = setInterval(load, 60_000); // absence is the failure mode; a slow poll is fine
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const markAll = async () => {
    await fetch('/api/notifications/read', { method: 'POST' });
    void load();
  };

  const markOneRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
    void load();
  };

  const dismiss = async (id: string) => {
    await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
    void load();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t(locale, 'notif.title')}
        title={t(locale, 'notif.title')}
        className="relative grid h-9 w-9 place-items-center rounded-[10px] text-[var(--color-ink-2)] transition hover:bg-[var(--color-well)] hover:text-[var(--color-ink)]"
      >
        <BellIcon />
        {feed.unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-[var(--color-bad)] px-1 text-[10px] font-bold leading-none text-white">
            {feed.unread > 9 ? '9+' : feed.unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-2 flex max-h-[70vh] w-[340px] flex-col overflow-hidden rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_12px_32px_rgba(0,0,0,0.18)] max-md:fixed max-md:left-3 max-md:right-3 max-md:top-16 max-md:w-auto">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
            <span className="text-[13px] font-semibold">{t(locale, 'notif.title')}</span>
            <span className="flex items-center gap-3">
              {feed.unread > 0 ? (
                <button onClick={markAll} className="text-[12px] text-[var(--color-accent)]">
                  {t(locale, 'notif.markRead')}
                </button>
              ) : null}
              <Link
                href="/preferences#notifications"
                onClick={() => setOpen(false)}
                className="text-[12px] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
              >
                {t(locale, 'notif.configure')}
              </Link>
            </span>
          </div>
          <div className="overflow-y-auto">
            {feed.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-[var(--color-muted)]">
                {t(locale, 'notif.empty')}
              </p>
            ) : (
              feed.items.map((n) => (
                <div
                  key={n.id}
                  className={`group flex items-start gap-2.5 border-b border-[var(--color-line)] px-4 py-3 last:border-0 ${
                    n.read ? 'opacity-55' : ''
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      n.read ? 'bg-transparent' : 'bg-[var(--color-accent)]'
                    }`}
                  />
                  {/* The body marks it read and, when it points somewhere (a plan to
                      confirm, an invoice), goes there — same as its button. */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.read) void markOneRead(n.id);
                      if (n.href) {
                        setOpen(false);
                        router.push(n.href);
                      }
                    }}
                    className="flex-1 text-left"
                  >
                    <p className="text-[13px] leading-snug">{n.message}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                      {new Date(n.raisedAt).toLocaleDateString(locale)}
                    </p>
                  </button>
                  {n.href ? (
                    <Link
                      href={n.href}
                      onClick={() => {
                        setOpen(false);
                        if (!n.read) void markOneRead(n.id);
                      }}
                      className="shrink-0 rounded-md border border-[var(--color-rule)] px-2 py-1 text-[11px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-well)]"
                    >
                      {n.type === 'PLANNED_DUE' ? 'Confirmar' : 'Ver'}
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => dismiss(n.id)}
                    aria-label={t(locale, 'notif.dismiss')}
                    title={t(locale, 'notif.dismiss')}
                    className="shrink-0 rounded p-1 text-[13px] leading-none text-[var(--color-muted)] opacity-0 transition hover:bg-[var(--color-well)] hover:text-[var(--color-ink)] group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-[var(--color-line)] bg-[var(--color-well)] px-4 py-2.5 text-[11px] text-[var(--color-muted)]">
            {t(locale, 'notif.nothingSent')}
          </div>
        </div>
      ) : null}
    </div>
  );
}
