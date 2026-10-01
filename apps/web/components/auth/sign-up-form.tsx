'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { t, type Locale } from '@/lib/i18n';

export interface SignUpState {
  error?: string;
  codes?: string[];
}

const inputClass =
  'rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[14px] outline-none transition focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)]';

/**
 * Registration (UC01). On success the API returns one-time recovery codes; we
 * show them exactly once — there is no email to send them to (BR28) — behind a
 * confirmation before letting the new user into the app.
 */
export function SignUpForm({
  locale,
  action,
}: {
  locale: Locale;
  action: (state: SignUpState, formData: FormData) => Promise<SignUpState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [saved, setSaved] = useState(false);

  if (state.codes) {
    return (
      <div>
        <h1 className="text-[24px] font-semibold">{t(locale, 'auth.recoveryTitle')}</h1>
        <p className="mb-5 mt-2 text-[14px] text-[var(--color-muted)]">{t(locale, 'auth.recoveryBody')}</p>

        <ul className="grid grid-cols-2 gap-2 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-well)] p-4">
          {state.codes.map((code) => (
            <li key={code} className="rounded-md bg-[var(--color-surface)] px-3 py-2 text-center font-mono text-[14px] tracking-wider">
              {code}
            </li>
          ))}
        </ul>

        <label className="mt-5 flex items-center gap-2.5 text-[13px]">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          {t(locale, 'auth.recoverySaved')}
        </label>

        <Link
          href="/"
          aria-disabled={!saved}
          className={`btn-accent mt-4 block px-4 py-3 text-center text-[14px] transition ${
            saved ? '' : 'pointer-events-none opacity-40'
          }`}
        >
          {t(locale, 'auth.continue')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[24px] font-semibold">{t(locale, 'auth.signUpTitle')}</h1>
      <p className="mb-7 mt-1 text-[14px] text-[var(--color-muted)]">{t(locale, 'auth.signUpSubtitle')}</p>

      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">{t(locale, 'auth.username')}</span>
          <input name="username" autoComplete="off" minLength={3} maxLength={40} required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">{t(locale, 'auth.password')}</span>
          <input name="password" type="password" autoComplete="off" minLength={6} required className={inputClass} />
          <span className="text-[11px] text-[var(--color-muted)]">{t(locale, 'auth.passwordHint')}</span>
        </label>

        {state.error ? (
          <p className="rounded-lg bg-[var(--color-bad)]/8 px-3 py-2 text-[13px] font-medium text-[var(--color-bad)]">
            {state.error === 'DUPLICATE' ? t(locale, 'auth.usernameTaken') : t(locale, 'auth.signUpFailed')}
          </p>
        ) : null}

        <button type="submit" disabled={pending} className="btn-accent mt-1 px-4 py-3 text-[14px] transition disabled:opacity-50">
          {t(locale, 'auth.signUp')}
        </button>
      </form>

      <p className="mt-6 text-[13px] text-[var(--color-muted)]">
        {t(locale, 'auth.haveAccount')}{' '}
        <Link href="/sign-in" className="font-semibold text-[var(--color-accent)]">
          {t(locale, 'auth.signIn')}
        </Link>
      </p>
    </div>
  );
}
