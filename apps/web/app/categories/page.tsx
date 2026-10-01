import { AppShell } from '@/components/app-shell';
import { EditButton, EntityForm, NewButton } from '@/components/forms/entity-form';
import { DeleteButton } from '@/components/row-actions';
import { Callout, Card, Chip } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { apiFetch, type CategoryRow } from '@/lib/api';
import { t, type Locale } from '@/lib/i18n';
import { getLocale } from '@/lib/prefs';

/** UC04: categories are optional, untyped, and carry their own flag + target. */
export default async function CategoriesPage() {
  const locale = await getLocale();
  const categories = await apiFetch<CategoryRow[]>('/categories');
  const roots = categories.filter((c) => c.parentId === null);
  const essentialCount = categories.filter((c) => c.isEssential).length;
  const withTarget = categories.filter((c) => c.monthlyTarget !== null).length;

  const parentOptions = [
    { value: '', label: '— nenhum (nível superior)' },
    ...roots.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <AppShell>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">{t(locale, 'nav.categories')}</h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
            {essentialCount} {t(locale, 'cat.essentialCount')} · {withTarget} {t(locale, 'cat.targetCount')}
          </p>
        </div>
        <EntityForm
          trigger={<NewButton label="Categoria" />}
          title="Nova categoria"
          method="POST"
          path="categories"
          submitLabel="Criar"
          fields={[
            { name: 'name', label: 'Nome', type: 'text' },
            { name: 'parentId', label: 'Categoria pai', type: 'select', options: parentOptions, hint: 'Um nível de aninhamento' },
            { name: 'isEssential', label: 'Essencial', type: 'checkbox', hint: 'Conta no custo de vida essencial' },
            { name: 'monthlyTarget', label: 'Meta mensal', type: 'money', hint: 'Opcional — alimenta a previsão' },
          ]}
        />
      </header>

      <Card>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              <th className="pb-2">{t(locale, 'col.category')}</th>
              <th className="pb-2">{t(locale, 'cat.essential')}</th>
              <th className="pb-2 text-right">{t(locale, 'col.target')}</th>
              <th className="pb-2 text-right">{t(locale, 'cat.average')}</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {roots.flatMap((root) => {
              const children = categories.filter((c) => c.parentId === root.id);
              return [
                <Row key={root.id} category={root} locale={locale} />,
                ...children.map((child) => <Row key={child.id} category={child} indent locale={locale} />),
              ];
            })}
          </tbody>
        </table>
      </Card>

      <Callout>{t(locale, 'cat.retroNote')}</Callout>
    </AppShell>
  );
}

function Row({ category, indent, locale }: { category: CategoryRow; indent?: boolean; locale: Locale }) {
  return (
    <tr className="border-b border-[var(--color-line)] last:border-0">
      <td className={`py-3 ${indent ? 'pl-5 text-[var(--color-ink-2)]' : 'font-medium'}`}>
        {indent ? '↳ ' : ''}
        {category.name}
      </td>
      <td className="py-3">
        {category.isEssential ? (
          <Chip tone="essential">✓ {t(locale, 'cat.essential').toLowerCase()}</Chip>
        ) : (
          <Chip tone="ghost">{t(locale, 'cat.no')}</Chip>
        )}
      </td>
      <td className="py-3 text-right">
        {category.monthlyTarget ? (
          <Money value={category.monthlyTarget} locale={locale} />
        ) : (
          <span className="italic text-[var(--color-muted)]">{t(locale, 'col.noTarget')}</span>
        )}
      </td>
      <td className="py-3 text-right text-[var(--color-ink-2)]">
        <Money value={category.average} locale={locale} />
      </td>
      <td className="py-3 pl-3 text-right">
        <span className="inline-flex items-center gap-3">
          <EntityForm
            trigger={<EditButton />}
            title={`Editar ${category.name}`}
            method="PATCH"
            path={`categories/${category.id}`}
            fields={[
              { name: 'name', label: 'Nome', type: 'text', value: category.name },
              { name: 'isEssential', label: 'Essencial', type: 'checkbox', value: category.isEssential, hint: 'Muda meses passados — auditado' },
              { name: 'monthlyTarget', label: 'Meta mensal', type: 'money', value: category.monthlyTarget ?? '' },
            ]}
          />
          <DeleteButton
            path={`categories/${category.id}`}
            confirmLabel="Excluir esta categoria? Os lançamentos ficam Sem categoria; subcategorias sobem de nível."
          />
        </span>
      </td>
    </tr>
  );
}
