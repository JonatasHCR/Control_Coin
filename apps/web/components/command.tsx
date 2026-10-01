'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { NavIcon, type NavIconName } from '@/components/ui/icons';

export interface Command {
  href: string;
  label: string;
  icon: NavIconName;
  /** The second key of a `g`-chord, e.g. "d" for Painel. `null` for no chord. */
  chord: string | null;
}

/**
 * The rail's search bar, the palette it opens, and the keyboard shortcuts —
 * one component, because the key hints printed beside the nav are only honest
 * if the same handler makes them work.
 *
 * `n` adds a transaction, `g` then a letter goes to a screen, ⌘K/Ctrl+K opens
 * the palette. Keys are ignored while a field has focus, so typing "n" in an
 * amount never navigates away.
 */
export function CommandBar({
  commands,
  openLabel,
  placeholder,
  emptyLabel,
  newLabel,
  newHref,
}: {
  commands: Command[];
  openLabel: string;
  placeholder: string;
  emptyLabel: string;
  newLabel: string;
  newHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pendingChord = useRef(false);

  const all: Command[] = [{ href: newHref, label: newLabel, icon: 'plus', chord: null }, ...commands];
  const hits = all.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((was) => !was);
        return;
      }

      if (open && event.key === 'Escape') {
        setOpen(false);
        return;
      }

      if (typing || event.metaKey || event.ctrlKey || event.altKey || open) return;

      if (pendingChord.current) {
        pendingChord.current = false;
        const hit = commands.find((c) => c.chord === event.key.toLowerCase());
        if (hit) {
          event.preventDefault();
          router.push(hit.href);
        }
        return;
      }

      if (event.key.toLowerCase() === 'g') {
        pendingChord.current = true;
        // A chord that is never finished must not swallow the next keystroke.
        window.setTimeout(() => (pendingChord.current = false), 1200);
        return;
      }

      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        router.push(newHref);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commands, newHref, open, router]);

  useEffect(() => {
    if (open) {
      setQuery('');
      input.current?.focus();
    }
  }, [open]);

  function go(href: string): void {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tile flex w-full items-center gap-2 px-2.5 py-[7px] text-left transition hover:border-[var(--color-rule)]"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          className="text-[var(--color-muted)]"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span className="truncate text-[12px] text-[var(--color-muted)] max-md:hidden">{openLabel}</span>
        <span className="kbd ml-auto max-md:hidden">⌘K</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-ink)]/25 p-4 pt-[12vh]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="tile w-full max-w-[460px] overflow-hidden"
            style={{ boxShadow: 'var(--shadow-pop)' }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal
          >
            <input
              ref={input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && hits[0]) go(hits[0].href);
              }}
              placeholder={placeholder}
              className="w-full border-b border-[var(--color-line)] bg-transparent px-4 py-3 text-[14px] outline-none"
            />
            <div className="max-h-[320px] overflow-y-auto p-1.5">
              {hits.length === 0 ? (
                <p className="px-2.5 py-3 text-[13px] text-[var(--color-muted)]">{emptyLabel}</p>
              ) : (
                hits.map((c) => (
                  <button
                    key={c.href}
                    type="button"
                    onClick={() => go(c.href)}
                    className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] transition hover:bg-[var(--color-well)]"
                  >
                    <span className="text-[var(--color-muted)]">
                      <NavIcon name={c.icon} />
                    </span>
                    {c.label}
                    {c.chord ? <span className="kbd ml-auto">G {c.chord.toUpperCase()}</span> : null}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
