import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

import type { Money } from '@cc/domain/money';
import { ERROR_CODES } from '@cc/domain/rules';

import { DomainError, userError } from '../../common/errors/domain-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { cellText, isBlank, readAmount, readDate } from './xlsx.service.js';

/**
 * The fill-in workbook (UC09): only what a person types — cadastros,
 * lançamentos and previstos, with dropdowns, and only the parts asked for. Balances, invoices, installments and every
 * average are derived on import (BR36), so the sheet has no column for them.
 *
 * Import is two passes: validate the whole file against existing data plus
 * what the file itself creates, and write nothing if any row is wrong; then
 * write. Rows already present (same name, or a lançamento imported before) are
 * skipped, so the same file can be sent again after fixing an error.
 */

const SEP = ' › ';
const NO_WALLET = '(sem carteira)';
const ROWS = 1000;
const YES = /^(s|sim|x|yes|y|true|1)$/i;

const ACCOUNT_TYPES: Record<string, 'BANK' | 'CASH' | 'LIABILITY'> = {
  'conta bancaria': 'BANK',
  banco: 'BANK',
  dinheiro: 'CASH',
  divida: 'LIABILITY',
};
const ACCOUNT_TYPE_LABEL = { BANK: 'Conta bancária', CASH: 'Dinheiro', LIABILITY: 'Dívida' } as const;
const KINDS: Record<string, 'EXPENSE' | 'INCOME' | 'TRANSFER'> = {
  despesa: 'EXPENSE',
  receita: 'INCOME',
  transferencia: 'TRANSFER',
};

type Col = { key: string; header: string; width: number; note: string; required?: boolean };

const SHEETS = {
  wallets: {
    name: 'Carteiras',
    cols: [
      { key: 'name', header: 'Nome', width: 24, note: 'Ex.: Pessoal, Casa, Emergência', required: true },
      { key: 'description', header: 'Descrição', width: 36, note: 'Opcional' },
    ],
  },
  accounts: {
    name: 'Contas',
    cols: [
      { key: 'name', header: 'Nome', width: 22, note: 'Ex.: Nubank, Carteira física', required: true },
      { key: 'type', header: 'Tipo', width: 18, note: 'Conta bancária, Dinheiro ou Dívida (alguém pagou por você / empréstimo)', required: true },
      { key: 'wallet', header: 'Carteira', width: 20, note: 'Uma da aba Carteiras. Vazio = sem carteira' },
      { key: 'initialBalance', header: 'Saldo inicial', width: 16, note: 'Saldo no dia em que você começou a registrar. Vazio = 0' },
      { key: 'currency', header: 'Moeda', width: 10, note: 'Vazio = BRL' },
    ],
  },
  cards: {
    name: 'Cartões',
    cols: [
      { key: 'name', header: 'Nome', width: 22, note: 'Ex.: Nubank Roxinho', required: true },
      { key: 'account', header: 'Conta', width: 26, note: 'A conta que emitiu o cartão (aba Contas)', required: true },
      { key: 'credit', header: 'Crédito', width: 10, note: 'Sim ou Não' },
      { key: 'debit', header: 'Débito', width: 10, note: 'Sim ou Não' },
      { key: 'limit', header: 'Limite', width: 14, note: 'Obrigatório se Crédito = Sim' },
      { key: 'closingDay', header: 'Dia de fechamento', width: 18, note: '1 a 31. Obrigatório se Crédito = Sim' },
      { key: 'dueDay', header: 'Dia de vencimento', width: 18, note: '1 a 31. Obrigatório se Crédito = Sim' },
    ],
  },
  categories: {
    name: 'Categorias',
    cols: [
      { key: 'name', header: 'Nome', width: 24, note: 'Ex.: Mercado, Aluguel', required: true },
      { key: 'parent', header: 'Categoria pai', width: 22, note: 'Opcional. Só um nível: o pai não pode ter pai' },
      { key: 'essential', header: 'Essencial', width: 11, note: 'Sim ou Não — entra no custo de vida essencial' },
      { key: 'target', header: 'Meta mensal', width: 14, note: 'Opcional' },
    ],
  },
  entries: {
    name: 'Lançamentos',
    cols: [
      { key: 'date', header: 'Data', width: 12, note: 'Data da compra / recebimento', required: true },
      { key: 'kind', header: 'Tipo', width: 15, note: 'Despesa, Receita ou Transferência', required: true },
      { key: 'description', header: 'Descrição', width: 30, note: 'Opcional' },
      { key: 'amount', header: 'Valor', width: 13, note: 'Valor total, sem sinal. Parcelado: o total da compra', required: true },
      { key: 'account', header: 'Conta', width: 24, note: 'De onde saiu (despesa / transferência) ou para onde foi (receita). Preencha Conta OU Cartão' },
      { key: 'card', header: 'Cartão', width: 22, note: 'Só para despesa paga com cartão' },
      { key: 'cardFunction', header: 'Função', width: 10, note: 'Crédito ou Débito. Vazio = crédito se o cartão tiver' },
      { key: 'installments', header: 'Parcelas', width: 10, note: 'Só no crédito. Vazio = à vista' },
      { key: 'category', header: 'Categoria', width: 22, note: 'Opcional (aba Categorias)' },
      { key: 'destination', header: 'Conta destino', width: 24, note: 'Só para transferência' },
    ],
  },
  planned: {
    name: 'Previstos',
    cols: [
      { key: 'date', header: 'Data prevista', width: 14, note: 'Quando deve acontecer', required: true },
      { key: 'kind', header: 'Tipo', width: 15, note: 'Despesa, Receita ou Transferência', required: true },
      { key: 'description', header: 'Descrição', width: 30, note: 'Ex.: IPVA, 13º salário', required: true },
      { key: 'amount', header: 'Valor', width: 13, note: 'Valor previsto, sem sinal', required: true },
      { key: 'account', header: 'Conta', width: 24, note: 'Opcional: conta prevista. Preencha Conta OU Cartão' },
      { key: 'card', header: 'Cartão', width: 22, note: 'Opcional: só para despesa' },
      { key: 'cardFunction', header: 'Função', width: 10, note: 'Crédito ou Débito. Vazio = crédito se o cartão tiver' },
      { key: 'category', header: 'Categoria', width: 22, note: 'Opcional' },
      { key: 'destination', header: 'Conta destino', width: 24, note: 'Opcional: só para transferência' },
      { key: 'notify', header: 'Avisar dias antes', width: 16, note: 'De 0 a 60. Vazio = 3' },
    ],
  },
} satisfies Record<string, { name: string; cols: Col[] }>;

export const PARTS = ['wallets', 'accounts', 'cards', 'categories', 'entries', 'planned'] as const;
export type Part = (typeof PARTS)[number];

/** "Como aparece nas listas": the label dropdowns pick, unique even when names repeat. */
const PICK = 'Como aparece nas listas';

type Wallet = { id?: string; name: string };
type Account = { id?: string; name: string; wallet: string | null; type: string; currency: string };
type Card = { id?: string; name: string; account: Account; allowsCredit: boolean; allowsDebit: boolean };
type Category = { id?: string; name: string; parent: string | null };

@Injectable()
export class WorkbookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  // ── Template ─────────────────────────────────────────────────────────────

  /**
   * Only the parts the user picked, so there is one obvious place to type. A
   * dropdown reads the picked sheet when it is in the file (so a row added
   * there is offered at once), else a hidden "Listas" sheet of what exists.
   */
  async template(userId: string, parts: readonly Part[] = ['entries']): Promise<Buffer> {
    const has = (p: Part) => parts.includes(p);
    const [wallets, accounts, cards, categories] = await Promise.all([
      this.prisma.wallet.findMany({ where: { userId, archived: false }, orderBy: { name: 'asc' } }),
      this.prisma.account.findMany({ where: { userId, archived: false }, include: { wallet: true }, orderBy: { name: 'asc' } }),
      this.prisma.card.findMany({ where: { account: { userId }, archived: false }, include: { account: { include: { wallet: true } } }, orderBy: { name: 'asc' } }),
      this.prisma.category.findMany({ where: { userId, archived: false }, include: { parent: true }, orderBy: { name: 'asc' } }),
    ]);
    const accountLabel = labeller(accounts.map((a) => ({ name: a.name, scope: a.wallet?.name ?? NO_WALLET })));
    const accountOf = (a: (typeof accounts)[number]) => accountLabel(a.name, a.wallet?.name ?? NO_WALLET);
    const cardLabel = labeller(cards.map((c) => ({ name: c.name, scope: accountOf(c.account) })));
    const categoryLabel = labeller(categories.map((c) => ({ name: c.name, scope: c.parent?.name ?? '' })));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Control_Coin';
    wb.calcProperties.fullCalcOnLoad = true; // the "listas" formulas compute on open

    this.instructions(wb, parts);
    const ws = (key: Part) => this.sheet(wb, SHEETS[key].name, SHEETS[key].cols);

    const lists = {
      wallets: wallets.map((w) => w.name),
      accounts: accounts.map(accountOf),
      cards: cards.map((c) => cardLabel(c.name, accountOf(c.account))),
      categories: categories.map((c) => (c.parent ? categoryLabel(c.name, c.parent.name) : c.name)),
    };
    const hidden = (col: string, items: string[]) => `'Listas'!$${col}$2:$${col}$${Math.max(2, items.length + 1)}`;
    const ref = {
      wallets: has('wallets') ? `'Carteiras'!$A$2:$A$${ROWS}` : hidden('A', lists.wallets),
      accounts: has('accounts') ? `'Contas'!$F$2:$F$${ROWS}` : hidden('B', lists.accounts),
      cards: has('cards') ? `'Cartões'!$H$2:$H$${ROWS}` : hidden('C', lists.cards),
      categories: has('categories') ? `'Categorias'!$E$2:$E$${ROWS}` : hidden('D', lists.categories),
    };

    if (has('wallets')) {
      const w = ws('wallets');
      wallets.forEach((x) => w.addRow([x.name, x.description ?? '']));
    }
    if (has('accounts')) {
      const a = ws('accounts');
      accounts.forEach((x) => a.addRow([x.name, ACCOUNT_TYPE_LABEL[x.type as keyof typeof ACCOUNT_TYPE_LABEL] ?? x.type, x.wallet?.name ?? '', Number(x.initialBalance), x.currency]));
      this.pickColumn(a, 6, (r) => `IF(A${r}="","",IF(COUNTIF($A$2:$A$${ROWS},A${r})>1,IF(C${r}="","${NO_WALLET}",C${r})&"${SEP}"&A${r},A${r}))`);
      this.list(a, 'B', ['Conta bancária', 'Dinheiro', 'Dívida']);
      this.list(a, 'C', ref.wallets);
      this.money(a, 'D');
    }
    if (has('cards')) {
      const c = ws('cards');
      cards.forEach((x) => c.addRow([x.name, accountOf(x.account), yn(x.allowsCredit), yn(x.allowsDebit), x.creditLimit ? Number(x.creditLimit) : null, x.closingDay, x.dueDay]));
      this.pickColumn(c, 8, (r) => `IF(A${r}="","",IF(COUNTIF($A$2:$A$${ROWS},A${r})>1,B${r}&"${SEP}"&A${r},A${r}))`);
      this.list(c, 'B', ref.accounts);
      this.list(c, 'C', ['Sim', 'Não']);
      this.list(c, 'D', ['Sim', 'Não']);
      this.money(c, 'E');
    }
    if (has('categories')) {
      const g = ws('categories');
      categories.forEach((x) => g.addRow([x.name, x.parent?.name ?? '', yn(x.isEssential), x.monthlyTarget ? Number(x.monthlyTarget) : null]));
      this.pickColumn(g, 5, (r) => `IF(A${r}="","",IF(AND(B${r}<>"",COUNTIF($A$2:$A$${ROWS},A${r})>1),B${r}&"${SEP}"&A${r},A${r}))`);
      this.list(g, 'B', `'Categorias'!$A$2:$A$${ROWS}`);
      this.list(g, 'C', ['Sim', 'Não']);
      this.money(g, 'D');
    }
    if (has('entries')) {
      const l = ws('entries');
      this.list(l, 'B', ['Despesa', 'Receita', 'Transferência']);
      this.list(l, 'E', ref.accounts);
      this.list(l, 'F', ref.cards);
      this.list(l, 'G', ['Crédito', 'Débito']);
      this.list(l, 'I', ref.categories);
      this.list(l, 'J', ref.accounts);
      this.money(l, 'D');
      this.dates(l);
    }
    if (has('planned')) {
      const l = ws('planned');
      this.list(l, 'B', ['Despesa', 'Receita', 'Transferência']);
      this.list(l, 'E', ref.accounts);
      this.list(l, 'F', ref.cards);
      this.list(l, 'G', ['Crédito', 'Débito']);
      this.list(l, 'H', ref.categories);
      this.list(l, 'I', ref.accounts);
      this.money(l, 'D');
      this.dates(l);
    }

    const hiddenSheet = wb.addWorksheet('Listas', { state: 'hidden' });
    hiddenSheet.addRow(['Carteiras', 'Contas', 'Cartões', 'Categorias']);
    const longest = Math.max(lists.wallets.length, lists.accounts.length, lists.cards.length, lists.categories.length);
    for (let i = 0; i < longest; i += 1) {
      hiddenSheet.addRow([lists.wallets[i] ?? null, lists.accounts[i] ?? null, lists.cards[i] ?? null, lists.categories[i] ?? null]);
    }

    wb.views = [{ activeTab: 1, x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, visibility: 'visible' }];
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private dates(s: ExcelJS.Worksheet): void {
    s.getColumn('A').numFmt = 'dd/mm/yyyy';
    for (let r = 2; r <= ROWS; r += 1) {
      s.getCell(`A${r}`).dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date('1990-01-01')], showErrorMessage: true, error: 'Digite uma data, ex.: 15/03/2026' };
    }
  }

  private instructions(wb: ExcelJS.Workbook, parts: readonly Part[]): void {
    const s = wb.addWorksheet('Como preencher');
    s.getColumn(1).width = 110;
    const names = PARTS.filter((p) => parts.includes(p)).map((p) => SHEETS[p].name);
    const tips: Record<Part, string> = {
      wallets: 'Carteiras: um grupo de contas (ex.: Pessoal, Casa).',
      accounts: 'Contas: onde o dinheiro fica. O que você já tem vem preenchido e não é alterado.',
      cards: 'Cartões: precisam de uma conta. Crédito exige limite e dias de fechamento e vencimento.',
      categories: 'Categorias: só um nível de subcategoria.',
      entries: 'Lançamentos: o que já aconteceu. Uma linha por compra / recebimento; parcelado = valor TOTAL + parcelas. Despesa: Conta OU Cartão. Receita: Conta. Transferência: Conta e Conta destino.',
      planned: 'Previstos: o que pode acontecer. Não mexe em saldo; perto da data o sistema pergunta o que aconteceu. Conta e cartão são opcionais.',
    };
    const lines: [string, boolean?][] = [
      ['Control Coin — planilha para importar', true],
      [''],
      [`Abas desta planilha: ${names.join(', ')}.`],
      ['Preencha só o que você sabe digitar. Saldos, faturas, parcelas e médias são calculados pelo sistema.'],
      ['Colunas com * são obrigatórias. Passe o mouse no título da coluna para ver a dica; as colunas com lista têm uma setinha.'],
      [''],
      ...PARTS.filter((p) => parts.includes(p)).map((p) => [`• ${tips[p]}`] as [string]),
      [''],
      ['Se alguma linha tiver erro, nada é importado e a tela mostra aba e linha. Enviar a mesma planilha de novo não duplica.'],
      ['Precisa de outra parte? Baixe de novo marcando o que quiser na tela Dados.'],
    ];
    lines.forEach(([text, bold]) => {
      const row = s.addRow([text]);
      if (bold) row.font = { bold: true, size: 14 };
    });
  }

  private sheet(wb: ExcelJS.Workbook, name: string, cols: Col[]): ExcelJS.Worksheet {
    const s = wb.addWorksheet(name);
    s.columns = cols.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width }));
    const head = s.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cols.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? 'FF2563EB' : 'FF6B7280' } };
      cell.note = c.note;
    });
    s.views = [{ state: 'frozen', ySplit: 1 }];
    return s;
  }

  /** A grey, formula-filled column the other sheets' dropdowns read. */
  private pickColumn(s: ExcelJS.Worksheet, col: number, formula: (row: number) => string): void {
    const head = s.getRow(1).getCell(col);
    head.value = PICK;
    head.font = { italic: true, color: { argb: 'FF6B7280' } };
    head.note = 'Calculado — não precisa preencher';
    s.getColumn(col).width = 30;
    for (let r = 2; r <= ROWS; r += 1) {
      const cell = s.getCell(r, col);
      cell.value = { formula: formula(r) };
      cell.font = { color: { argb: 'FF9CA3AF' } };
    }
  }

  private list(s: ExcelJS.Worksheet, col: string, source: string[] | string): void {
    const formulae = Array.isArray(source) ? [`"${source.join(',')}"`] : [source];
    for (let r = 2; r <= ROWS; r += 1) {
      s.getCell(`${col}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae, showErrorMessage: Array.isArray(source), error: 'Escolha um valor da lista' };
    }
  }

  private money(s: ExcelJS.Worksheet, col: string): void {
    s.getColumn(col).numFmt = '#,##0.00';
  }

  // ── Import ───────────────────────────────────────────────────────────────

  async import(userId: string, buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw userError(ERROR_CODES.VALIDATION_FAILED, 'não foi possível ler o arquivo — salve como .xlsx');
    }
    if (!PARTS.some((p) => wb.getWorksheet(SHEETS[p].name))) {
      throw userError(ERROR_CODES.VALIDATION_FAILED, 'esta não é a planilha modelo — baixe o modelo na tela Dados');
    }

    const errors: string[] = [];
    const [dbWallets, dbAccounts, dbCards, dbCategories] = await Promise.all([
      this.prisma.wallet.findMany({ where: { userId } }),
      this.prisma.account.findMany({ where: { userId }, include: { wallet: true } }),
      this.prisma.card.findMany({ where: { account: { userId } }, include: { account: true } }),
      this.prisma.category.findMany({ where: { userId }, include: { parent: true } }),
    ]);

    // In-memory model: what exists plus what the file creates.
    const wallets: Wallet[] = dbWallets.map((w) => ({ id: w.id, name: w.name }));
    const accounts: Account[] = dbAccounts.map((a) => ({ id: a.id, name: a.name, wallet: a.wallet?.name ?? null, type: a.type, currency: a.currency }));
    const cards: Card[] = dbCards.map((c) => ({
      id: c.id,
      name: c.name,
      account: accounts.find((a) => a.id === c.accountId)!,
      allowsCredit: c.allowsCredit,
      allowsDebit: c.allowsDebit,
    }));
    const categories: Category[] = dbCategories.map((c) => ({ id: c.id, name: c.name, parent: c.parent?.name ?? null }));

    const newWallets: (Wallet & { description: string | null })[] = [];
    const newAccounts: (Account & { initialBalance: Money })[] = [];
    const newCards: (Card & { creditLimit: Money | null; closingDay: number | null; dueDay: number | null })[] = [];
    const newCategories: (Category & { isEssential: boolean; monthlyTarget: Money | null })[] = [];

    for (const { at, get } of rows(wb, 'wallets', errors)) {
      const name = get('name');
      if (!name) { errors.push(`${at}: Nome é obrigatório`); continue; }
      if (wallets.some((w) => same(w.name, name))) continue;
      const w = { name, description: get('description') || null };
      wallets.push(w);
      newWallets.push(w);
    }

    for (const { at, get, cell } of rows(wb, 'accounts', errors)) {
      const name = get('name');
      if (!name) { errors.push(`${at}: Nome é obrigatório`); continue; }
      const walletName = get('wallet') || null;
      if (walletName && !wallets.some((w) => same(w.name, walletName))) { errors.push(`${at}: carteira "${walletName}" não existe na aba Carteiras`); continue; }
      const wallet = walletName ? wallets.find((w) => same(w.name, walletName))!.name : null;
      if (accounts.some((a) => same(a.name, name) && sameOrNull(a.wallet, wallet))) continue;
      const type = ACCOUNT_TYPES[norm(get('type'))];
      if (!type) { errors.push(`${at}: Tipo deve ser Conta bancária, Dinheiro ou Dívida`); continue; }
      const initialBalance = optionalMoney(cell('initialBalance'), true);
      if (initialBalance === undefined) { errors.push(`${at}: Saldo inicial inválido`); continue; }
      const a = { name, wallet, type, currency: (get('currency') || 'BRL').toUpperCase().slice(0, 3), initialBalance: initialBalance ?? ('0.00' as Money) };
      accounts.push(a);
      newAccounts.push(a);
    }

    for (const { at, get, cell } of rows(wb, 'cards', errors)) {
      const name = get('name');
      if (!name) { errors.push(`${at}: Nome é obrigatório`); continue; }
      const account = resolveAccount(accounts, get('account'));
      if (typeof account === 'string') { errors.push(`${at}: ${account}`); continue; }
      if (cards.some((c) => same(c.name, name) && c.account === account)) continue;
      const allowsCredit = YES.test(get('credit'));
      const allowsDebit = YES.test(get('debit'));
      if (!allowsCredit && !allowsDebit) { errors.push(`${at}: marque Crédito ou Débito (ou os dois)`); continue; }
      const creditLimit = optionalMoney(cell('limit'));
      const closingDay = day(get('closingDay'));
      const dueDay = day(get('dueDay'));
      if (creditLimit === undefined || closingDay === undefined || dueDay === undefined) { errors.push(`${at}: limite ou dias inválidos (dias de 1 a 31)`); continue; }
      if (allowsCredit && (!creditLimit || !closingDay || !dueDay)) { errors.push(`${at}: cartão de crédito precisa de Limite, Dia de fechamento e Dia de vencimento`); continue; }
      const c = { name, account, allowsCredit, allowsDebit, creditLimit: allowsCredit ? creditLimit : null, closingDay: allowsCredit ? closingDay : null, dueDay: allowsCredit ? dueDay : null };
      cards.push(c);
      newCards.push(c);
    }

    // Parents first, so a child row may come before its parent in the sheet.
    const catRows = [...rows(wb, 'categories', errors)].sort((x, y) => Number(!!x.get('parent')) - Number(!!y.get('parent')));
    for (const { at, get, cell } of catRows) {
      const name = get('name');
      if (!name) { errors.push(`${at}: Nome é obrigatório`); continue; }
      const parentName = get('parent') || null;
      let parent: string | null = null;
      if (parentName) {
        const p = categories.find((c) => same(c.name, parentName) && c.parent === null);
        if (!p) { errors.push(`${at}: categoria pai "${parentName}" não existe (ou já é uma subcategoria)`); continue; }
        parent = p.name;
      }
      if (categories.some((c) => same(c.name, name) && sameOrNull(c.parent, parent))) continue;
      const monthlyTarget = optionalMoney(cell('target'));
      if (monthlyTarget === undefined) { errors.push(`${at}: Meta mensal inválida`); continue; }
      const c = { name, parent, isEssential: YES.test(get('essential')), monthlyTarget };
      categories.push(c);
      newCategories.push(c);
    }

    // Lançamentos, validated against the model.
    type ToCreate = {
      at: string;
      ref: string;
      build: () => Parameters<TransactionsService['create']>[1];
    };
    const toCreate: ToCreate[] = [];
    const seen = new Map<string, number>();
    for (const { at, get, cell } of rows(wb, 'entries', errors)) {
      let date: string;
      let amount: Money;
      try {
        date = readDate(cell('date'));
      } catch {
        errors.push(`${at}: Data inválida`);
        continue;
      }
      try {
        amount = readAmount(cell('amount')).amount.replace('-', '') as Money;
        if (Number(amount) <= 0) throw new Error();
      } catch {
        errors.push(`${at}: Valor inválido`);
        continue;
      }
      const kind = KINDS[norm(get('kind'))];
      if (!kind) { errors.push(`${at}: Tipo deve ser Despesa, Receita ou Transferência`); continue; }
      const description = get('description') || undefined;
      const installments = get('installments') ? Number(get('installments')) : 1;
      if (!Number.isInteger(installments) || installments < 1 || installments > 120) { errors.push(`${at}: Parcelas deve ser um número de 1 a 120`); continue; }

      let category: Category | null = null;
      if (get('category')) {
        const c = resolveCategory(categories, get('category'));
        if (typeof c === 'string') { errors.push(`${at}: ${c}`); continue; }
        category = c;
      }

      const accountText = get('account');
      const cardText = get('card');
      let source: { account: Account } | { card: Card; fn: 'CREDIT' | 'DEBIT' } | null = null;
      if (accountText && cardText) { errors.push(`${at}: preencha Conta OU Cartão, não os dois`); continue; }
      if (accountText) {
        const a = resolveAccount(accounts, accountText);
        if (typeof a === 'string') { errors.push(`${at}: ${a}`); continue; }
        source = { account: a };
      } else if (cardText) {
        const c = resolveCard(cards, cardText);
        if (typeof c === 'string') { errors.push(`${at}: ${c}`); continue; }
        const chosen = norm(get('cardFunction'));
        const fn = chosen === 'debito' ? 'DEBIT' : chosen === 'credito' ? 'CREDIT' : c.allowsCredit ? 'CREDIT' : 'DEBIT';
        if (fn === 'CREDIT' ? !c.allowsCredit : !c.allowsDebit) { errors.push(`${at}: o cartão "${c.name}" não tem a função ${fn === 'CREDIT' ? 'crédito' : 'débito'}`); continue; }
        source = { card: c, fn };
      }
      if (!source) { errors.push(`${at}: preencha a Conta${kind === 'EXPENSE' ? ' ou o Cartão' : ''}`); continue; }
      if (installments > 1 && !('card' in source && source.fn === 'CREDIT')) { errors.push(`${at}: Parcelas só vale para compra no cartão de crédito`); continue; }
      if (kind !== 'EXPENSE' && 'card' in source) { errors.push(`${at}: ${kind === 'INCOME' ? 'receita' : 'transferência'} usa Conta, não Cartão`); continue; }

      let destination: Account | null = null;
      if (kind === 'TRANSFER') {
        const d = resolveAccount(accounts, get('destination'));
        if (typeof d === 'string') { errors.push(`${at}: Conta destino — ${d}`); continue; }
        if ('account' in source && d === source.account) { errors.push(`${at}: Conta destino é a mesma da origem`); continue; }
        destination = d;
      }

      const src = 'account' in source ? `a:${label(source.account)}` : `c:${source.card.name}:${source.fn}`;
      const key = [date, kind, amount, description ?? '', src, destination ? label(destination) : '', installments].join('|');
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n); // identical rows in one file are distinct purchases
      const ref = `wb:${createHash('sha256').update(`${key}|${n}`).digest('hex').slice(0, 29)}`;
      const s = source;
      const currency = 'account' in s ? s.account.currency : s.card.account.currency;

      toCreate.push({
        at,
        ref,
        build: () => {
          const sourceEntry = 'account' in s ? { accountId: s.account.id! } : { cardId: s.card.id!, cardFunction: s.fn };
          const entries =
            kind === 'INCOME'
              ? [{ side: 'DESTINATION' as const, accountId: (s as { account: Account }).account.id!, amount }]
              : kind === 'EXPENSE'
                ? [{ side: 'SOURCE' as const, ...sourceEntry, amount, installmentCount: installments }]
                : [
                    { side: 'SOURCE' as const, ...sourceEntry, amount },
                    { side: 'DESTINATION' as const, accountId: destination!.id!, amount },
                  ];
          return {
            kind,
            occurrenceType: installments > 1 ? 'INSTALLMENT' : 'OCCASIONAL',
            categoryId: category?.id ?? null,
            description,
            occurredOn: date,
            totalAmount: amount,
            currency,
            entries,
          } as Parameters<TransactionsService['create']>[1];
        },
      });
    }

    // Previstos (BR40): source and destination are only expectations, so optional.
    type Plan = {
      key: string;
      kind: 'EXPENSE' | 'INCOME' | 'TRANSFER';
      description: string;
      amount: Money;
      expectedOn: string;
      category: Category | null;
      account: Account | null;
      card: Card | null;
      fn: 'CREDIT' | 'DEBIT' | null;
      destination: Account | null;
      notify: number;
    };
    const plans: Plan[] = [];
    for (const { at, get, cell } of rows(wb, 'planned', errors)) {
      let expectedOn: string;
      let amount: Money;
      try {
        expectedOn = readDate(cell('date'));
      } catch {
        errors.push(`${at}: Data prevista inválida`);
        continue;
      }
      try {
        amount = readAmount(cell('amount')).amount.replace('-', '') as Money;
        if (Number(amount) <= 0) throw new Error();
      } catch {
        errors.push(`${at}: Valor inválido`);
        continue;
      }
      const kind = KINDS[norm(get('kind'))];
      if (!kind) { errors.push(`${at}: Tipo deve ser Despesa, Receita ou Transferência`); continue; }
      const description = get('description');
      if (!description) { errors.push(`${at}: Descrição é obrigatória`); continue; }
      const notify = get('notify') ? Number(get('notify')) : 3;
      if (!Number.isInteger(notify) || notify < 0 || notify > 60) { errors.push(`${at}: Avisar dias antes deve ser de 0 a 60`); continue; }

      let category: Category | null = null;
      if (get('category') && kind !== 'TRANSFER') {
        const c = resolveCategory(categories, get('category'));
        if (typeof c === 'string') { errors.push(`${at}: ${c}`); continue; }
        category = c;
      }
      let account: Account | null = null;
      let card: Card | null = null;
      let fn: 'CREDIT' | 'DEBIT' | null = null;
      if (get('account') && get('card')) { errors.push(`${at}: preencha Conta OU Cartão, não os dois`); continue; }
      if (get('account')) {
        const a = resolveAccount(accounts, get('account'));
        if (typeof a === 'string') { errors.push(`${at}: ${a}`); continue; }
        account = a;
      } else if (get('card')) {
        if (kind !== 'EXPENSE') { errors.push(`${at}: cartão só para despesa`); continue; }
        const c = resolveCard(cards, get('card'));
        if (typeof c === 'string') { errors.push(`${at}: ${c}`); continue; }
        const chosen = norm(get('cardFunction'));
        fn = chosen === 'debito' ? 'DEBIT' : chosen === 'credito' ? 'CREDIT' : c.allowsCredit ? 'CREDIT' : 'DEBIT';
        if (fn === 'CREDIT' ? !c.allowsCredit : !c.allowsDebit) { errors.push(`${at}: o cartão "${c.name}" não tem a função ${fn === 'CREDIT' ? 'crédito' : 'débito'}`); continue; }
        card = c;
      }
      let destination: Account | null = null;
      if (kind === 'TRANSFER' && get('destination')) {
        const d = resolveAccount(accounts, get('destination'));
        if (typeof d === 'string') { errors.push(`${at}: Conta destino — ${d}`); continue; }
        destination = d;
      }
      plans.push({ key: [kind, norm(description), amount, expectedOn].join('|'), kind, description, amount, expectedOn, category, account, card, fn, destination, notify });
    }

    if (errors.length > 0) {
      const message = `${errors.length} erro(s) — nada foi importado`;
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, message, { message, errors: errors.slice(0, 100) });
    }

    // ── Write ──
    // A plan already present (same kind, description, amount, date) is skipped;
    // the n-th identical row in the file is new only if fewer than n exist.
    const existingPlans = new Map<string, number>();
    if (plans.length > 0) {
      for (const p of await this.prisma.plannedTransaction.findMany({ where: { userId }, select: { kind: true, description: true, amount: true, expectedOn: true } })) {
        const k = [p.kind, norm(p.description), p.amount.toFixed(2), p.expectedOn.toISOString().slice(0, 10)].join('|');
        existingPlans.set(k, (existingPlans.get(k) ?? 0) + 1);
      }
    }
    const mainCurrency = plans.length > 0 ? (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).mainCurrency : 'BRL';
    let plansCreated = 0;
    let plansSkipped = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const w of newWallets) w.id = (await tx.wallet.create({ data: { userId, name: w.name, description: w.description } })).id;
      for (const a of newAccounts) {
        a.id = (
          await tx.account.create({
            data: { userId, name: a.name, type: a.type, currency: a.currency, initialBalance: a.initialBalance, walletId: a.wallet ? wallets.find((w) => w.name === a.wallet)!.id! : null },
          })
        ).id;
      }
      for (const c of newCards) {
        c.id = (
          await tx.card.create({
            data: { accountId: c.account.id!, name: c.name, allowsCredit: c.allowsCredit, allowsDebit: c.allowsDebit, creditLimit: c.creditLimit, closingDay: c.closingDay, dueDay: c.dueDay },
          })
        ).id;
      }
      for (const c of newCategories) {
        c.id = (
          await tx.category.create({
            data: { userId, name: c.name, parentId: c.parent ? categories.find((p) => p.name === c.parent && p.parent === null)!.id! : null, isEssential: c.isEssential, monthlyTarget: c.monthlyTarget },
          })
        ).id;
      }
      const seenPlans = new Map<string, number>();
      for (const p of plans) {
        const n = (seenPlans.get(p.key) ?? 0) + 1;
        seenPlans.set(p.key, n);
        if ((existingPlans.get(p.key) ?? 0) >= n) {
          plansSkipped += 1;
          continue;
        }
        await tx.plannedTransaction.create({
          data: {
            userId,
            kind: p.kind,
            description: p.description,
            amount: p.amount,
            currency: p.card?.account.currency ?? p.account?.currency ?? mainCurrency,
            expectedOn: new Date(p.expectedOn),
            categoryId: p.category?.id ?? null,
            accountId: p.account?.id ?? null,
            cardId: p.card?.id ?? null,
            cardFunction: p.fn,
            destinationAccountId: p.destination?.id ?? null,
            notifyDaysBefore: p.notify,
          },
        });
        plansCreated += 1;
      }
    });

    const already = new Set(
      (await this.prisma.transaction.findMany({ where: { userId, externalRef: { in: toCreate.map((p) => p.ref) } }, select: { externalRef: true } })).map((t) => t.externalRef),
    );
    let imported = 0;
    const failed: string[] = [];
    for (const p of toCreate) {
      if (already.has(p.ref)) continue;
      try {
        const t = await this.transactions.create(userId, p.build());
        await this.prisma.transaction.update({ where: { id: t.id }, data: { externalRef: p.ref } });
        imported += 1;
      } catch (e) {
        failed.push(`${p.at}: ${e instanceof Error ? e.message : 'falhou'}`);
      }
    }

    return {
      created: { wallets: newWallets.length, accounts: newAccounts.length, cards: newCards.length, categories: newCategories.length, transactions: imported, planned: plansCreated },
      skipped: already.size + plansSkipped,
      errors: failed,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Rows of one sheet with values looked up by column key, matched on header text. */
function* rows(wb: ExcelJS.Workbook, key: keyof typeof SHEETS, errors: string[]) {
  const def = SHEETS[key];
  const sheet = wb.getWorksheet(def.name);
  if (!sheet) return;
  const index = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const text = norm(safeText(cell).replace('*', ''));
    const c = def.cols.find((x) => norm(x.header) === text);
    if (c) index.set(c.key, col);
  });
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    if (isBlank(onlyInputs(row, index))) continue;
    const at = `${def.name}, linha ${r}`;
    const cell = (k: string) => row.getCell(index.get(k) ?? 999);
    const get = (k: string) => {
      try {
        return cellText(cell(k)).trim();
      } catch {
        errors.push(`${at}: fórmula sem valor calculado na coluna ${k}`);
        return '';
      }
    };
    yield { row, at, cell, get };
  }
}

/** A row whose only content is the formula column counts as blank. */
function onlyInputs(row: ExcelJS.Row, index: Map<string, number>): ExcelJS.Row {
  const cols = new Set(index.values());
  return { eachCell: (opts: unknown, fn: (c: ExcelJS.Cell, n: number) => void) => row.eachCell(opts as { includeEmpty: boolean }, (c, n) => cols.has(n) && fn(c, n)) } as unknown as ExcelJS.Row;
}

function safeText(cell: ExcelJS.Cell): string {
  try {
    return cellText(cell);
  } catch {
    return '';
  }
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
const same = (a: string, b: string) => norm(a) === norm(b);
const sameOrNull = (a: string | null, b: string | null) => (a === null || b === null ? a === b : same(a, b));
const yn = (v: boolean) => (v ? 'Sim' : 'Não');

/** Blank → null; unreadable → undefined. */
function optionalMoney(cell: ExcelJS.Cell, allowNegative = false): Money | null | undefined {
  if (safeText(cell).trim() === '') return null;
  try {
    const { amount, sign } = readAmount(cell);
    if (sign < 0 && !allowNegative) return undefined;
    return (sign < 0 ? `-${amount.replace('-', '')}` : amount) as Money;
  } catch {
    return undefined;
  }
}

function day(text: string): number | null | undefined {
  if (!text) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : undefined;
}

/** Plain name when unique, "scope › name" when the name repeats. */
function labeller(items: { name: string; scope: string }[]) {
  return (name: string, scope: string) =>
    items.filter((i) => same(i.name, name)).length > 1 ? `${scope}${SEP}${name}` : name;
}

const label = (a: Account) => `${a.wallet ?? NO_WALLET}${SEP}${a.name}`;

function split(text: string): [string | null, string] {
  const i = text.lastIndexOf(SEP.trim());
  return i < 0 ? [null, text.trim()] : [text.slice(0, i).trim(), text.slice(i + 1).trim()];
}

function resolveAccount(accounts: Account[], text: string): Account | string {
  if (!text) return 'Conta é obrigatória';
  const [scope, name] = split(text);
  const found = accounts.filter(
    (a) => same(a.name, name) && (scope === null || (same(scope, NO_WALLET) ? a.wallet === null : a.wallet !== null && same(a.wallet, scope))),
  );
  if (found.length === 1) return found[0]!;
  if (found.length === 0) return `conta "${text}" não existe na aba Contas`;
  return `existe mais de uma conta "${name}" — escolha na lista (Carteira${SEP}Conta)`;
}

function resolveCard(cards: Card[], text: string): Card | string {
  const [scope, name] = split(text);
  const found = cards.filter((c) => same(c.name, name) && (scope === null || same(scope, c.account.name) || same(scope, label(c.account))));
  if (found.length === 1) return found[0]!;
  if (found.length === 0) return `cartão "${text}" não existe na aba Cartões`;
  return `existe mais de um cartão "${name}" — escolha na lista (Conta${SEP}Cartão)`;
}

function resolveCategory(categories: Category[], text: string): Category | string {
  const [scope, name] = split(text);
  const found = categories.filter((c) => same(c.name, name) && (scope === null || (c.parent !== null && same(c.parent, scope))));
  if (found.length === 1) return found[0]!;
  if (found.length === 0) return `categoria "${text}" não existe na aba Categorias`;
  return `existe mais de uma categoria "${name}" — escolha na lista (Pai${SEP}Categoria)`;
}
