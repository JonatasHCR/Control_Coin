import { cookies } from 'next/headers';

import { SignUpForm, type SignUpState } from '@/components/auth/sign-up-form';
import { SESSION_COOKIE } from '@/lib/api';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/prefs';

const API = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

/** UC01: self-serve registration. Own authentication, username, no email (BR28). */
export default async function SignUpPage() {
  const locale = await getLocale();

  async function signUp(_state: SignUpState, formData: FormData): Promise<SignUpState> {
    'use server';

    const response = await fetch(`${API}/auth/sign-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: String(formData.get('username') ?? '').trim(),
        password: String(formData.get('password') ?? ''),
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { code?: string };
      return { error: body.code ?? 'INTERNAL' };
    }

    const { token, recoveryCodes } = (await response.json()) as {
      token: string;
      recoveryCodes: string[];
    };

    // Log the new user straight in — the session cookie is set here, so the
    // "Go to the dashboard" link lands authenticated. Language/theme keep their
    // defaults until the user changes them in Preferences.
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    return { codes: recoveryCodes };
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left: the sky-blue brand panel — the modern-fintech split. */}
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

      {/* Right: the registration card. */}
      <main className="grid place-items-center p-6">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-2.5 text-[17px] font-bold tracking-tight lg:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-accent)] text-[13px] text-[var(--color-on-accent)]">
              C
            </span>
            Control_Coin
          </div>

          <SignUpForm locale={locale} action={signUp} />

          <p className="mt-6 text-[12px] leading-relaxed text-[var(--color-muted)]">
            {t(locale, 'auth.recoveryNote')}
          </p>
        </div>
      </main>
    </div>
  );
}
