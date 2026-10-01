/**
 * The business rules, by id, shared by both applications.
 *
 * These strings are developer-facing: they appear in error codes, test names
 * and logs. User-facing wording is translated in the web app from the code —
 * the API returns codes, never sentences (BR29).
 *
 * Source of truth: docs/Business Rules.md. Append, never renumber.
 */
export const RULES = {
  BR01: 'BR01 — a transaction names at least one account; a category is optional',
  BR02: 'BR02 — balance = initial + income − expenses ± transfers',
  BR03: 'BR03 — transfers do not change net worth',
  BR04: 'BR04 — goals and budgets are tied to a period',
  BR05: 'BR05 — conversions use the rate of the transaction date',
  BR06: 'BR06 — hierarchy is wallet → account → card',
  BR07: 'BR07 — settlement follows the function used, not the card',
  BR08: 'BR08 — a wallet balance is the sum of its accounts',
  BR09: 'BR09 — a card enables at least one function, and stores the one used',
  BR10: 'BR10 — one occurrence type: occasional, recurring or installment',
  BR11: 'BR11 — an entry names exactly one source: an account, or a card and its function',
  BR12: 'BR12 — split parts must sum exactly to the transaction total',
  BR13: 'BR13 — categories are untyped; income and expense are never netted',
  BR14: 'BR14 — cost of living averages complete months only',
  BR15: 'BR15 — a goal reads a wallet, an account, or manual contributions',
  BR16: 'BR16 — reports are scoped to all wallets by default',
  BR17: 'BR17 — categories and subcategories carry their own essential flag',
  BR18: 'BR18 — the essential cost of living is BR14 restricted to essential categories',
  BR19: 'BR19 — future periods show commitments only, labelled projected',
  BR20: 'BR20 — a category may carry an optional monthly target',
  BR21: 'BR21 — variance is target − actual; no target means no verdict',
  BR22: 'BR22 — the forecast uses targets where set, historical averages elsewhere',
  BR23: 'BR23 — a budget with no limit inherits the category target',
  BR24: 'BR24 — imported rows are deduplicated and never merged',
  BR25: 'BR25 — exports are produced at transaction or settlement level',
  BR26: 'BR26 — spreadsheet money is parsed as exact decimal, never a float',
  BR27: 'BR27 — the automatic export is a scheduled export, not a system backup',
  BR28: 'BR28 — nothing is ever sent out of the system',
  BR29: 'BR29 — pt-BR and en; user data is never translated',
  BR30: 'BR30 — language sets formatting, never value',
  BR31: 'BR31 — an invoice payment is a transfer, never funded by credit',
  BR32: 'BR32 — invoice status is derived; overdue escalates without duplicating',
  BR33: 'BR33 — the system never calculates interest or late fees',
  BR34: 'BR34 — closing = opening + income − expenses; closing opens the next period',
  BR35: 'BR35 — a carried balance is never income or expense of the period',
  BR36: 'BR36 — no derived money value is ever stored',
} as const satisfies Record<string, string>;

export type RuleId = keyof typeof RULES;

/** Stable error codes returned by the API and translated by the web app. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  SPLIT_NOT_BALANCED: 'SPLIT_NOT_BALANCED',
  CARD_FUNCTION_DISABLED: 'CARD_FUNCTION_DISABLED',
  INVALID_SETTLEMENT_TARGET: 'INVALID_SETTLEMENT_TARGET',
  CREDIT_CANNOT_PAY: 'CREDIT_CANNOT_PAY',
  OVERPAYMENT: 'OVERPAYMENT',
  DUPLICATE: 'DUPLICATE',
  NOT_FOUND: 'NOT_FOUND',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
