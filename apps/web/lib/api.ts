import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// .trim(): a stray space from a shell export becomes ERR_INVALID_URL otherwise.
// .trim(): a stray space from a shell export becomes ERR_INVALID_URL otherwise.
const BASE = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

export const SESSION_COOKIE = 'cc_session';

/**
 * Typed client over the API. Money arrives as strings and stays that way —
 * nothing here parses an amount into a number (BR36 / ARCH06).
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });

  // An expired or revoked session is an ordinary state, not a crash: send the
  // user to sign in rather than rendering a 500 (UC01).
  if (response.status === 401) redirect('/sign-in');

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new ApiError(body.code ?? 'INTERNAL', response.status);
  }
  return response.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

/** Everything the dashboard needs for one period. */
export interface Dashboard {
  period: string;
  balance: {
    opening_balance: string;
    income: string;
    expenses: string;
    available: string;
    closing_balance: string;
  } | null;
  costOfLiving: {
    months_used: number;
    average_expense: string;
    average_essential: string;
    average_discretionary: string;
    min_month: string;
    max_month: string;
  } | null;
  /** BR14: essential spending of the month, and its monthly average for the year so far. */
  essentialCost: { month_essential: string; year_average: string; months: number };
  categories: { category_id: string | null; name: string | null; is_essential: boolean | null; total: string }[];
  variance: { category_id: string; name: string; is_essential: boolean; monthly_target: string | null; actual: string; variance: string | null }[];
  invoices: { invoice_id: string; card_id: string; reference_month: string; status: string; due_on: string; charged: string; paid: string; open_amount: string; is_overdue: boolean; days_overdue: number }[];
  wallets: { category_id: string | null; name: string | null; total: string }[];
  /** BR39 — what is owed, kept apart from what is held. */
  debts: { category_id: string | null; name: string | null; total: string }[];
}

export interface TransactionRow {
  id: string;
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  occurrenceType: string;
  description: string | null;
  occurredOn: string;
  totalAmount: string;
  category: { id: string; name: string; isEssential: boolean } | null;
  entries: {
    id: string;
    side: string;
    amount: string;
    cardFunction: string | null;
    installmentCount: number;
    account: { id: string; name: string } | null;
    card: { id: string; name: string } | null;
    settlements: { id: string; sequenceNo: number; amount: string; dueOn: string; settledOn: string | null }[];
  }[];
}

/** GET /transactions/:id — one transaction with its series, for the edit form (UC03). */
export interface FullTransaction {
  id: string;
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  occurrenceType: 'OCCASIONAL' | 'RECURRING' | 'INSTALLMENT';
  description: string | null;
  occurredOn: string;
  totalAmount: string;
  categoryId: string | null;
  series: { frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY'; intervalCount: number; endsOn: string | null } | null;
  entries: {
    id: string;
    side: 'SOURCE' | 'DESTINATION';
    amount: string;
    cardFunction: 'CREDIT' | 'DEBIT' | null;
    installmentCount: number;
    accountId: string | null;
    cardId: string | null;
  }[];
}


/** GET /accounts — the wallet → account → card tree (UC10). */
export interface CardNode {
  id: string;
  name: string;
  functions: ('CREDIT' | 'DEBIT')[];
  closingDay: number | null;
  dueDay: number | null;
  openInvoices: string;
  overdue: boolean;
}
export interface AccountNode {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: string;
  cards: CardNode[];
}
export interface AccountTree {
  wallets: { id: string; name: string; balance: string; accounts: AccountNode[] }[];
  unassigned: AccountNode[];
}

/** GET /accounts/archived — what archiving hid. */
export interface ArchivedTree {
  wallets: { id: string; name: string; hiddenAccounts: number }[];
  accounts: { id: string; name: string; walletName: string | null; hiddenCards: number }[];
  cards: { id: string; name: string; accountName: string; accountArchived: boolean }[];
}

/** GET /categories (UC04). */
export interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  isEssential: boolean;
  monthlyTarget: string | null;
  average: string;
}

/** GET /invoices (UC12). */
export interface InvoiceRow {
  id: string;
  cardId: string;
  cardName: string;
  referenceMonth: string;
  closesOn: string;
  dueOn: string;
  status: string;
  charged: string;
  paid: string;
  openAmount: string;
  isOverdue: boolean;
  daysOverdue: number;
}


/** GET /budgets (UC05). */
export interface BudgetRow {
  id: string;
  categoryId: string;
  name: string;
  isEssential: boolean;
  limit: string | null;
  inheritsTarget: boolean;
  consumed: string;
  percent: number | null;
  state: 'none' | 'ok' | 'warn' | 'over';
}

/** GET /goals (UC06). */
export interface GoalRow {
  id: string;
  name: string;
  sourceType: 'WALLET' | 'ACCOUNT' | 'MANUAL';
  target: string;
  current: string;
  remaining: string;
  percent: number;
  deadline: string;
  monthlyNeeded: string;
  complete: boolean;
}

/** GET /notifications (UC08). */
export interface NotificationFeed {
  unread: number;
  items: { id: string; type: string; message: string; raisedAt: string; read: boolean }[];
}
