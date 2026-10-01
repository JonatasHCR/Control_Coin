import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '@/lib/api';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/prefs';

const API = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

/** UC01 alt flow: recover access with a one-time recovery code. No email (BR28). */
async function recover(formData: FormData): Promise<void> {
  'use server';

  const response = await fetch(`${API}/auth/recover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: String(formData.get('username') ?? '').trim(),
      code: String(formData.get('code') ?? '').trim(),
      newPassword: String(formData.get('newPassword') ?? ''),
    }),
    cache: 'no-store',
  });

  if (!response.ok) redirect('/recover?error=1');

  const { token } = (await response.json()) as { token: string };
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect('/');
}

export default async function RecoverPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const locale = await getLocale();
  const { error } = await searchParams;

  const inputClass =
    'rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[14px] outline-none transition focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)]';

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[var(--color-brand-panel)] p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              'radial-gradient(700px circle at 20% 10%, rgba(255,255,255,0.5), transparent 45%), radial-gradient(600px circle at 90% 90%, rgba(255,255,255,0.35), transparent 40%)',
          }}
        />
        <div className="relative flex items-center gap-2.5 text-[18px] font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/20 text-[15px] backdrop-blur">
            C
          </span>
          Control_Coin
        </div>
        <div className="relative">
          <p className="max-w-sm text-[26px] font-semibold leading-tight">
            Suas finanças, do jeito que fazem sentido para você.
          </p>
          <p className="mt-3 max-w-sm text-[14px] text-white/80">
            Sem e-mail: seus códigos de recuperação são a chave. Um código serve uma vez.
          </p>
        </div>
        <p className="relative text-[12px] text-white/60">© 2026 Control_Coin</p>
      </aside>

      <main className="grid place-items-center p-6">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-2.5 text-[17px] font-bold tracking-tight lg:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-accent)] text-[13px] text-[var(--color-on-accent)]">
              C
            </span>
            Control_Coin
          </div>

          <h1 className="text-[24px] font-semibold">{t(locale, 'auth.recoverTitle')}</h1>
          <p className="mb-7 mt-1 text-[14px] text-[var(--color-muted)]">{t(locale, 'auth.recoverSubtitle')}</p>

          <form action={recover} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">{t(locale, 'auth.username')}</span>
              <input name="username" autoComplete="off" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">{t(locale, 'auth.recoveryCode')}</span>
              <input name="code" autoComplete="off" required className={`${inputClass} font-mono tracking-wider`} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">{t(locale, 'auth.newPassword')}</span>
              <input name="newPassword" type="password" autoComplete="off" minLength={6} required className={inputClass} />
              <span className="text-[11px] text-[var(--color-muted)]">{t(locale, 'auth.passwordHint')}</span>
            </label>

            {error ? (
              <p className="rounded-lg bg-[var(--color-bad)]/8 px-3 py-2 text-[13px] font-medium text-[var(--color-bad)]">
                {t(locale, 'auth.recoverFailed')}
              </p>
            ) : null}

            <button type="submit" className="btn-accent mt-1 px-4 py-3 text-[14px] transition">
              {t(locale, 'auth.recoverCta')}
            </button>
          </form>

          <p className="mt-6 text-[13px] text-[var(--color-muted)]">
            <Link href="/sign-in" className="font-semibold text-[var(--color-accent)]">
              {t(locale, 'auth.signIn')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
