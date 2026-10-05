import { AppShell } from '@/components/app-shell';
import { EditButton, EntityForm, NewButton } from '@/components/forms/entity-form';
import { DeleteButton, ArchiveButton } from '@/components/row-actions';
import { Callout, Card, CardHead, Chip } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { apiFetch, type AccountNode, type AccountTree, type ArchivedTree } from '@/lib/api';
import { t, type Locale } from '@/lib/i18n';
import { getLocale } from '@/lib/prefs';

/** UC10: wallet › account › card, with balances derived by the API. */
export default async function AccountsPage() {
  const locale = await getLocale();
  const [tree, archived] = await Promise.all([
    apiFetch<AccountTree>('/accounts'),
    apiFetch<ArchivedTree>('/accounts/archived'),
  ]);
  const archivedCount = archived.wallets.length + archived.accounts.length + archived.cards.length;

  // BR37: two accounts may share a name in different wallets, so every place
  // that offers one for choosing names the wallet too.
  const allAccounts = [
    ...tree.wallets.flatMap((w) => w.accounts.map((a) => ({ ...a, walletName: w.name }))),
    ...tree.unassigned.map((a) => ({ ...a, walletName: null as string | null })),
  ];
  const walletOptions = [
    { value: '', label: '— sem carteira' },
    ...tree.wallets.map((w) => ({ value: w.id, label: w.name })),
  ];
  const accountOptions = allAccounts.map((a) => ({
    value: a.id,
    label: a.walletName ? `${a.walletName} › ${a.name}` : a.name,
  }));

  return (
    <AppShell>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">{t(locale, 'nav.accounts')}</h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{t(locale, 'acc.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <EntityForm
            trigger={<NewButton label="Carteira" />}
            title="Nova carteira"
            method="POST"
            path="accounts/wallets"
            submitLabel="Criar"
            fields={[{ name: 'name', label: 'Nome', type: 'text', required: true, hint: 'Ex.: Emergência, Dia a dia' }]}
          />
          <EntityForm
            trigger={<NewButton label="Conta" />}
            title="Nova conta"
            method="POST"
            path="accounts"
            submitLabel="Criar"
            fields={[
              { name: 'name', label: 'Nome', type: 'text', required: true },
              { name: 'type', label: 'Tipo', type: 'select', options: [{ value: 'BANK', label: 'Conta bancária' }, { value: 'CASH', label: 'Dinheiro' }, { value: 'LIABILITY', label: 'Dívida (alguém pagou / empréstimo)' }] },
              { name: 'currency', label: 'Moeda', type: 'text', value: 'BRL', emptyAs: 'omit' },
              { name: 'initialBalance', label: 'Saldo inicial', type: 'money', value: '0.00', emptyAs: 'omit' },
              { name: 'walletId', label: 'Carteira', type: 'select', options: walletOptions },
            ]}
          />
          <EntityForm
            trigger={<NewButton label="Cartão" />}
            title="Novo cartão"
            method="POST"
            path="accounts/cards"
            submitLabel="Criar"
            fields={[
              { name: 'accountId', label: 'Conta', type: 'select', options: accountOptions },
              { name: 'name', label: 'Nome', type: 'text', required: true },
              { name: 'allowsCredit', label: 'Crédito', type: 'checkbox', value: true, hint: 'Acumula na fatura' },
              { name: 'allowsDebit', label: 'Débito', type: 'checkbox', hint: 'Sai da conta na hora' },
              { name: 'creditLimit', label: 'Limite de crédito', type: 'money', hint: 'Obrigatório se crédito' },
              { name: 'closingDay', label: 'Dia de fechamento', type: 'number' },
              { name: 'dueDay', label: 'Dia de vencimento', type: 'number' },
            ]}
          />
        </div>
      </header>

      <div className="flex flex-col gap-4">
        {tree.wallets.map((wallet) => (
          <Card key={wallet.id}>
            <CardHead
              title={wallet.name}
              action={
                <span className="flex items-center gap-3">
                  <span className="text-[15px] font-semibold tabular">
                    <Money value={wallet.balance} locale={locale} />
                  </span>
                  <EntityForm
                    trigger={<EditButton />}
                    title={`Editar ${wallet.name}`}
                    method="PATCH"
                    path={`accounts/wallets/${wallet.id}`}
                    fields={[{ name: 'name', label: 'Nome', type: 'text', value: wallet.name }]}
                  />
                  <ArchiveButton id={wallet.id} kind="WALLET" />
                  <DeleteButton path={`accounts/${wallet.id}?kind=WALLET`} confirmLabel="Excluir esta carteira? (só se estiver vazia)" />
                </span>
              }
            />
            <div className="flex flex-col gap-3">
              {wallet.accounts.map((account) => (
                <AccountBlock key={account.id} account={account} locale={locale} />
              ))}
            </div>
          </Card>
        ))}

        {tree.unassigned.length > 0 ? (
          <Card>
            <CardHead title={t(locale, 'acc.noWallet')} note={t(locale, 'acc.ownScope')} />
            <div className="flex flex-col gap-3">
              {tree.unassigned.map((account) => (
                <AccountBlock key={account.id} account={account} locale={locale} />
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      {archivedCount > 0 ? (
        <details className="mt-4 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <summary className="cursor-pointer text-[14px] font-semibold">
            Arquivados <span className="font-normal text-[var(--color-muted)]">({archivedCount})</span>
          </summary>
          <p className="mt-1 text-[12px] text-[var(--color-muted)]">
            Ficam fora das listas e escolhas, mas o histórico e os saldos continuam. Desarquive para voltar a usar.
          </p>
          <div className="mt-3 flex flex-col gap-2 text-[13px]">
            {archived.wallets.map((w) => (
              <ArchivedRow key={w.id} kind="Carteira" name={w.name} note={w.hiddenAccounts > 0 ? `volta com ${w.hiddenAccounts} conta(s)` : null}>
                <ArchiveButton id={w.id} kind="WALLET" undo />
              </ArchivedRow>
            ))}
            {archived.accounts.map((a) => (
              <ArchivedRow
                key={a.id}
                kind="Conta"
                name={a.walletName ? `${a.walletName} › ${a.name}` : a.name}
                note={a.hiddenCards > 0 ? `volta com ${a.hiddenCards} cartão(ões)` : null}
              >
                <ArchiveButton id={a.id} kind="ACCOUNT" undo />
              </ArchivedRow>
            ))}
            {archived.cards.map((c) => (
              <ArchivedRow
                key={c.id}
                kind="Cartão"
                name={`${c.accountName} › ${c.name}`}
                note={c.accountArchived ? 'a conta dele também está arquivada' : null}
              >
                <ArchiveButton id={c.id} kind="CARD" undo />
              </ArchivedRow>
            ))}
          </div>
        </details>
      ) : null}

      <Callout>{t(locale, 'acc.committedNote')}</Callout>
    </AppShell>
  );
}

function ArchivedRow({ kind, name, note, children }: { kind: string; name: string; note: string | null; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--color-well)] px-3.5 py-2.5">
      <span>
        <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{kind}</span>
        {name}
        {note ? <span className="ml-2 text-[12px] text-[var(--color-muted)]">· {note}</span> : null}
      </span>
      {children}
    </div>
  );
}

function AccountBlock({ account, locale }: { account: AccountNode; locale: Locale }) {
  return (
    <div className="rounded-lg bg-[var(--color-well)] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold">
          {account.name}
          <span className="ml-2 font-normal text-[var(--color-muted)]">
            {account.type === 'BANK' ? t(locale, 'acc.bank') : t(locale, 'acc.cash')} · {account.currency}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <Money value={account.balance} locale={locale} className="text-[13px] font-semibold" />
          <EntityForm
            trigger={<EditButton />}
            title={`Editar ${account.name}`}
            method="PATCH"
            path={`accounts/${account.id}`}
            fields={[{ name: 'name', label: 'Nome', type: 'text', value: account.name }]}
          />
          <ArchiveButton id={account.id} kind="ACCOUNT" />
          <DeleteButton path={`accounts/${account.id}?kind=ACCOUNT`} confirmLabel="Excluir esta conta? (só se sem cartões e sem histórico)" />
        </span>
      </div>

      {account.cards.length > 0 ? (
        <div className="mt-3 ml-3 flex flex-col gap-2 border-l-2 border-[var(--color-rule)] pl-3">
          {account.cards.map((card) => (
            <div key={card.id} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex items-center gap-1.5">
                {card.name}
                {card.functions.map((fn) => (
                  <Chip key={fn} tone={fn === 'CREDIT' ? 'neutral' : 'essential'}>
                    {fn === 'CREDIT' ? t(locale, 'acc.credit') : t(locale, 'acc.debit')}
                  </Chip>
                ))}
                {card.overdue ? <Chip tone="bad">▲ {t(locale, 'inv.overdue')}</Chip> : null}
              </span>
              <span className="flex items-center gap-3">
                {Number(card.openInvoices) > 0 ? (
                  <span className="text-[12px] text-[var(--color-muted)]">
                    {t(locale, 'acc.openInvoice')}{' '}
                    <Money value={card.openInvoices} locale={locale} className="text-[var(--color-ink-2)]" />
                  </span>
                ) : (
                  <span className="text-[12px] text-[var(--color-muted)]">{t(locale, 'acc.noInvoice')}</span>
                )}
                <EntityForm
                  trigger={<EditButton />}
                  title={`Editar ${card.name}`}
                  method="PATCH"
                  path={`accounts/cards/${card.id}`}
                  fields={[
                    { name: 'name', label: 'Nome', type: 'text', value: card.name },
                    { name: 'allowsCredit', label: 'Crédito', type: 'checkbox', value: card.functions.includes('CREDIT') },
                    { name: 'allowsDebit', label: 'Débito', type: 'checkbox', value: card.functions.includes('DEBIT') },
                    { name: 'closingDay', label: 'Dia de fechamento', type: 'number', value: card.closingDay ?? undefined, hint: 'Vale para as próximas faturas' },
                    { name: 'dueDay', label: 'Dia de vencimento', type: 'number', value: card.dueDay ?? undefined },
                  ]}
                />
                <ArchiveButton id={card.id} kind="CARD" />
                <DeleteButton path={`accounts/${card.id}?kind=CARD`} confirmLabel="Excluir este cartão? (só se sem histórico)" />
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
