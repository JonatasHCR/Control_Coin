import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '@/lib/api';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/prefs';

/** UC01: username and password. No email field, because nothing is ever sent. */
async function signIn(formData: FormData): Promise<void> {
  'use server';

  const response = await fetch(`${(process.env.API_URL ?? 'http://localhost:3001').trim()}/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: String(formData.get('username') ?? ''),
      password: String(formData.get('password') ?? ''),
    }),
  });

  if (!response.ok) redirect('/sign-in?error=1');

  const { token } = (await response.json()) as { token: string };
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  // Seed the language and theme cookies from the account, so the saved
  // preference is applied from the first authenticated page.
  const prefs = (await fetch(`${(process.env.API_URL ?? 'http://localhost:3001').trim()}/preferences`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { language?: string; theme?: string } | null;

  if (prefs) {
    store.set('cc_lang', prefs.language ?? 'pt-BR', { path: '/', maxAge: 60 * 60 * 24 * 365 });
    store.set('cc_theme', prefs.theme ?? 'system', { path: '/', maxAge: 60 * 60 * 24 * 365 });
  }

  redirect('/');
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const locale = await getLocale();
  const { error } = await searchParams;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left: a deep sage brand panel — the modern-fintech split login. */}
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
            Carteiras, cartões, faturas e o custo de vida — em um só lugar. Nada sai do sistema:
            sem e-mail, sem rastreio.
          </p>
        </div>
        <p className="relative text-[12px] text-white/60">© 2026 Control_Coin</p>
      </aside>

      {/* Right: the login card. */}
      <main className="grid place-items-center p-6">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-2.5 text-[17px] font-bold tracking-tight lg:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-accent)] text-[13px] text-[var(--color-on-accent)]">
              C
            </span>
            Control_Coin
          </div>

          <h1 className="text-[24px] font-semibold">{t(locale, 'auth.welcome')}</h1>
          <p className="mb-7 mt-1 text-[14px] text-[var(--color-muted)]">{t(locale, 'auth.noEmail')}</p>

          <form action={signIn} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">
                {t(locale, 'auth.username')}
              </span>
              <input
                name="username"
                autoComplete="off"
                className="rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[14px] outline-none transition focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)]"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">
                {t(locale, 'auth.password')}
              </span>
              <input
                name="password"
                type="password"
                autoComplete="off"
                className="rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[14px] outline-none transition focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)]"
              />
            </label>

            {error ? (
              <p className="rounded-lg bg-[var(--color-bad)]/8 px-3 py-2 text-[13px] font-medium text-[var(--color-bad)]">
                {t(locale, 'auth.failed')}
              </p>
            ) : null}

            <button
              type="submit"
              className="btn-accent mt-1 px-4 py-3 text-[14px] transition"
            >
              {t(locale, 'auth.signIn')}
            </button>
          </form>

          <p className="mt-6 flex items-center justify-between text-[13px] text-[var(--color-muted)]">
            <span>
              {t(locale, 'auth.noAccount')}{' '}
              <Link href="/sign-up" className="font-semibold text-[var(--color-accent)]">
                {t(locale, 'auth.signUp')}
              </Link>
            </span>
            <Link href="/recover" className="font-semibold text-[var(--color-accent)]">
              {t(locale, 'auth.forgotPassword')}
            </Link>
          </p>

          <p className="mt-4 text-[12px] leading-relaxed text-[var(--color-muted)]">
            {t(locale, 'auth.recoveryNote')}
          </p>
        </div>
      </main>
    </div>
  );
}
