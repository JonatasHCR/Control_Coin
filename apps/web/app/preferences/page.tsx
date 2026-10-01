import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { EditButton, EntityForm, NewButton } from '@/components/forms/entity-form';
import { DeleteButton } from '@/components/row-actions';
import { Callout, Card, CardHead, Chip } from '@/components/ui/card';
import { apiFetch, type CategoryRow } from '@/lib/api';
import { t } from '@/lib/i18n';
import { getLocale, LANG_COOKIE, THEME_COOKIE } from '@/lib/prefs';

interface Prefs {
  username: string;
  language: 'pt-BR' | 'en';
  theme: 'system' | 'light' | 'dark';
  mainCurrency: string;
}

interface AlertRule {
  id: string;
  type: string;
  targetType: string | null;
  targetId: string | null;
  thresholdPercent: number | null;
  daysBefore: number | null;
  active: boolean;
}

/** UC11: language sets interface text and formatting only, never currency. */
export default async function PreferencesPage() {
  const locale = await getLocale();
  const [prefs, rules, categories] = await Promise.all([
    apiFetch<Prefs>('/preferences'),
    apiFetch<AlertRule[]>('/notifications/rules'),
    apiFetch<CategoryRow[]>('/categories'),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));
  const budgetRules = rules.filter((r) => r.type === 'BUDGET_THRESHOLD');
  const dueRules = rules.filter((r) => r.type === 'INVOICE_DUE');

  async function save(formData: FormData): Promise<void> {
    'use server';
    const language = String(formData.get('language') ?? 'pt-BR');
    const theme = String(formData.get('theme') ?? 'system');
    const mainCurrency = String(formData.get('mainCurrency') ?? 'BRL');

    await apiFetch('/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ language, theme, mainCurrency }),
    });

    // The account is the source of truth; mirror the choice into cookies so
    // every server component applies it without an API round trip. Setting the
    // cookies is what makes the change actually take effect on screen.
    const store = await cookies();
    store.set(LANG_COOKIE, language, { path: '/', maxAge: 60 * 60 * 24 * 365 });
    store.set(THEME_COOKIE, theme, { path: '/', maxAge: 60 * 60 * 24 * 365 });

    revalidatePath('/', 'layout'); // re-render the whole app with the new theme/lang
    redirect('/preferences');
  }

  return (
    <AppShell>
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold">{t(locale, 'nav.prefs')}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{t(locale, 'pref.subtitle')}</p>
      </header>

      <div className="max-w-[560px]">
        <Card>
          <CardHead title={prefs.username} />
          <form action={save} className="flex flex-col gap-4">
            <Field label={t(locale, 'pref.language')}>
              <select name="language" defaultValue={prefs.language} className={input}>
                <option value="pt-BR">Português (pt-BR)</option>
                <option value="en">English (en)</option>
              </select>
            </Field>

            <Field label={t(locale, 'pref.currency')} hint={t(locale, 'pref.currencyHint')}>
              <select name="mainCurrency" defaultValue={prefs.mainCurrency} className={input}>
                <option value="BRL">BRL — Real</option>
                <option value="USD">USD — Dollar</option>
                <option value="EUR">EUR — Euro</option>
              </select>
            </Field>

            <Field label={t(locale, 'pref.theme')}>
              <select name="theme" defaultValue={prefs.theme} className={input}>
                <option value="system">{t(locale, 'pref.system')}</option>
                <option value="light">{t(locale, 'pref.light')}</option>
                <option value="dark">{t(locale, 'pref.dark')}</option>
              </select>
            </Field>

            <div className="flex justify-end border-t border-[var(--color-line)] pt-3.5">
              <button
                type="submit"
                className="btn-accent px-4 py-2 text-[13px]"
              >
                {t(locale, 'pref.save')}
              </button>
            </div>
          </form>
          <Callout>{t(locale, 'pref.note')}</Callout>
        </Card>

        {/* UC08 — the notification configuration: budget-threshold alert rules. */}
        <Card id="notifications" className="mt-4 scroll-mt-6">
          <CardHead
            title={t(locale, 'notif.cfgTitle')}
            action={
              <EntityForm
                trigger={<NewButton label={t(locale, 'notif.newRule')} />}
                title={t(locale, 'notif.ruleTitle')}
                method="POST"
                path="notifications/rules"
                submitLabel={t(locale, 'pref.save')}
                fields={[
                  { name: 'targetId', label: t(locale, 'notif.ruleCategory'), type: 'select', options: categoryOptions },
                  { name: 'thresholdPercent', label: t(locale, 'notif.ruleThreshold'), type: 'number', value: 80, hint: t(locale, 'notif.ruleThresholdHint') },
                ]}
                extra={{ type: 'BUDGET_THRESHOLD', targetType: 'CATEGORY' }}
              />
            }
          />
          <p className="-mt-2 mb-3 text-[12px] text-[var(--color-muted)]">{t(locale, 'notif.cfgSubtitle')}</p>

          {budgetRules.length > 0 ? (
            <div className="flex flex-col divide-y divide-[var(--color-line)]">
              {budgetRules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between gap-3 py-3 first:pt-1">
                  <span className="flex items-center gap-2 text-[13px]">
                    <span className="font-medium">
                      {rule.targetId ? categoryName.get(rule.targetId) ?? '—' : '—'}
                    </span>
                    <span className="text-[var(--color-muted)]">
                      {t(locale, 'notif.at')} {rule.thresholdPercent}%
                    </span>
                    {rule.active ? (
                      <Chip tone="essential">{t(locale, 'notif.ruleActive')}</Chip>
                    ) : (
                      <Chip tone="ghost">{t(locale, 'notif.paused')}</Chip>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    <EntityForm
                      trigger={<EditButton />}
                      title={t(locale, 'notif.ruleTitle')}
                      method="PATCH"
                      path={`notifications/rules/${rule.id}`}
                      submitLabel={t(locale, 'pref.save')}
                      fields={[
                        { name: 'thresholdPercent', label: t(locale, 'notif.ruleThreshold'), type: 'number', value: rule.thresholdPercent ?? 80 },
                        { name: 'active', label: t(locale, 'notif.ruleActive'), type: 'checkbox', value: rule.active },
                      ]}
                    />
                    <DeleteButton
                      path={`notifications/rules/${rule.id}`}
                      confirmLabel={t(locale, 'notif.deleteConfirm')}
                    />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-2 text-[13px] text-[var(--color-muted)]">{t(locale, 'notif.rulesNone')}</p>
          )}

          {/* UC08 — upcoming invoice due-date reminders (the configurable
              "N days before due"; overdue always warns, BR32). */}
          <div className="mt-5 border-t border-[var(--color-line)] pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold">{t(locale, 'notif.dueTitle')}</h3>
                <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">{t(locale, 'notif.dueSubtitle')}</p>
              </div>
              {dueRules.length === 0 ? (
                <EntityForm
                  trigger={<NewButton label={t(locale, 'notif.newDueRule')} />}
                  title={t(locale, 'notif.dueRuleTitle')}
                  method="POST"
                  path="notifications/rules"
                  submitLabel={t(locale, 'pref.save')}
                  fields={[
                    { name: 'daysBefore', label: t(locale, 'notif.daysBefore'), type: 'number', value: 5, hint: t(locale, 'notif.daysBeforeHint') },
                  ]}
                  extra={{ type: 'INVOICE_DUE' }}
                />
              ) : null}
            </div>

            {dueRules.length > 0 ? (
              <div className="flex flex-col divide-y divide-[var(--color-line)]">
                {dueRules.map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between gap-3 py-3 first:pt-1">
                    <span className="flex items-center gap-2 text-[13px]">
                      <span className="font-medium">
                        {rule.daysBefore ?? 5} {t(locale, 'notif.daysBeforeShort')}
                      </span>
                      {rule.active ? (
                        <Chip tone="essential">{t(locale, 'notif.ruleActive')}</Chip>
                      ) : (
                        <Chip tone="ghost">{t(locale, 'notif.paused')}</Chip>
                      )}
                    </span>
                    <span className="flex items-center gap-3">
                      <EntityForm
                        trigger={<EditButton />}
                        title={t(locale, 'notif.dueRuleTitle')}
                        method="PATCH"
                        path={`notifications/rules/${rule.id}`}
                        submitLabel={t(locale, 'pref.save')}
                        fields={[
                          { name: 'daysBefore', label: t(locale, 'notif.daysBefore'), type: 'number', value: rule.daysBefore ?? 5 },
                          { name: 'active', label: t(locale, 'notif.ruleActive'), type: 'checkbox', value: rule.active },
                        ]}
                      />
                      <DeleteButton
                        path={`notifications/rules/${rule.id}`}
                        confirmLabel={t(locale, 'notif.deleteConfirm')}
                      />
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-1 text-[13px] text-[var(--color-muted)]">{t(locale, 'notif.dueNone')}</p>
            )}
          </div>

          <Callout>{t(locale, 'notif.cfgNote')}</Callout>
        </Card>
      </div>
    </AppShell>
  );
}

const input =
  'w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-2.5 py-2 text-[13px]';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-[var(--color-muted)]">{hint}</span> : null}
    </label>
  );
}
