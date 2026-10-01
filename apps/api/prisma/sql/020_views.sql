-- Derived figures. BR36: none of these is ever stored — they are computed from
-- `settlement` at read time, so nothing can drift from the movements.

-- BR02: only settled movements count toward a balance.
CREATE VIEW v_account_balance AS
SELECT a.id AS account_id, a.user_id, a.wallet_id, a.currency,
       a.initial_balance
     + COALESCE(SUM(s.amount) FILTER (WHERE e.side = 'DESTINATION'), 0)
     - COALESCE(SUM(s.amount) FILTER (WHERE e.side = 'SOURCE'),      0) AS balance
FROM account a
LEFT JOIN entry e      ON e.account_id = a.id
LEFT JOIN settlement s ON s.entry_id = e.id AND s.settled_on IS NOT NULL
GROUP BY a.id;

-- BR08: a wallet is the sum of its accounts.
CREATE VIEW v_wallet_balance AS
SELECT w.id AS wallet_id, w.user_id, w.name,
       COALESCE(SUM(b.balance), 0) AS balance
FROM wallet w
LEFT JOIN v_account_balance b ON b.wallet_id = w.id
GROUP BY w.id;

-- BR32/BR36: charged, paid, open and overdue are all derived.
CREATE VIEW v_invoice_total AS
WITH charged AS (
    SELECT s.invoice_id, SUM(s.amount) AS total
    FROM settlement s JOIN entry e ON e.id = s.entry_id
    WHERE e.side = 'SOURCE'
    GROUP BY s.invoice_id
),
paid AS (
    SELECT s.invoice_id, SUM(s.amount) AS total
    FROM settlement s JOIN entry e ON e.id = s.entry_id
    WHERE e.side = 'DESTINATION' AND s.settled_on IS NOT NULL
    GROUP BY s.invoice_id
)
SELECT i.id AS invoice_id, i.card_id, i.reference_month, i.status,
       i.closes_on, i.due_on,
       COALESCE(c.total, 0)                        AS charged,
       COALESCE(p.total, 0)                        AS paid,
       COALESCE(c.total, 0) - COALESCE(p.total, 0) AS open_amount,
       (COALESCE(c.total, 0) - COALESCE(p.total, 0) > 0
        AND i.due_on < CURRENT_DATE)               AS is_overdue,
       GREATEST(CURRENT_DATE - i.due_on, 0)        AS days_overdue
FROM invoice i
LEFT JOIN charged c ON c.invoice_id = i.id
LEFT JOIN paid    p ON p.invoice_id = i.id;

-- BR14/BR18: expenses by the month each settlement falls due, carrying the
-- wallet scope (BR16) and the essential split (BR17).
CREATE VIEW v_monthly_expense AS
SELECT t.user_id,
       a.wallet_id,
       date_trunc('month', s.due_on)::date AS month,
       SUM(s.amount)                              AS expense_total,
       SUM(s.amount) FILTER (WHERE c.is_essential) AS essential_total
FROM settlement s
JOIN entry e        ON e.id = s.entry_id
JOIN transaction t  ON t.id = e.transaction_id
LEFT JOIN category c ON c.id = t.category_id
LEFT JOIN account a  ON a.id = COALESCE(
       e.account_id, (SELECT c2.account_id FROM card c2 WHERE c2.id = e.card_id))
WHERE t.kind = 'EXPENSE'
GROUP BY t.user_id, a.wallet_id, date_trunc('month', s.due_on);

-- BR19: a future period shows commitments only — never actuals, never a balance.
CREATE VIEW v_committed_future AS
SELECT t.user_id,
       date_trunc('month', s.due_on)::date AS month,
       t.id AS transaction_id, t.description, t.occurrence_type, t.category_id,
       s.sequence_no, e.installment_count, s.amount, s.due_on
FROM settlement s
JOIN entry e       ON e.id = s.entry_id
JOIN transaction t ON t.id = e.transaction_id
WHERE s.settled_on IS NULL
  AND s.due_on >= date_trunc('month', CURRENT_DATE) + INTERVAL '1 month';

-- BR14/BR18: the average over complete past months only.
CREATE OR REPLACE FUNCTION cost_of_living(
    p_user UUID, p_months INT DEFAULT 6, p_wallets UUID[] DEFAULT NULL)
RETURNS TABLE (months_used INT, average_expense NUMERIC, average_essential NUMERIC,
               average_discretionary NUMERIC, min_month NUMERIC, max_month NUMERIC) AS $$
    WITH complete AS (
        SELECT month,
               SUM(expense_total)               AS total,
               COALESCE(SUM(essential_total),0) AS essential
        FROM v_monthly_expense
        WHERE user_id = p_user
          AND month < date_trunc('month', CURRENT_DATE)
          AND (p_wallets IS NULL OR wallet_id = ANY (p_wallets))
        GROUP BY month
        ORDER BY month DESC
        LIMIT p_months
    )
    SELECT COUNT(*)::INT,
           ROUND(AVG(total), 2),
           ROUND(AVG(essential), 2),
           ROUND(AVG(total) - AVG(essential), 2),
           MIN(total), MAX(total)
    FROM complete;
$$ LANGUAGE sql STABLE;

-- BR21: target − actual. A null target yields a null variance, never a verdict
-- invented from the average.
CREATE OR REPLACE FUNCTION category_variance(p_user UUID, p_month DATE)
RETURNS TABLE (category_id UUID, name TEXT, is_essential BOOLEAN,
               monthly_target NUMERIC, actual NUMERIC, variance NUMERIC) AS $$
    SELECT c.id, c.name, c.is_essential, c.monthly_target,
           COALESCE(x.spent, 0),
           CASE WHEN c.monthly_target IS NULL THEN NULL
                ELSE c.monthly_target - COALESCE(x.spent, 0) END
    FROM category c
    LEFT JOIN (
        SELECT t.category_id, SUM(s.amount) AS spent
        FROM settlement s
        JOIN entry e       ON e.id = s.entry_id
        JOIN transaction t ON t.id = e.transaction_id
        WHERE t.kind = 'EXPENSE'
          AND date_trunc('month', s.due_on) = date_trunc('month', p_month)
        GROUP BY t.category_id
    ) x ON x.category_id = c.id
    WHERE c.user_id = p_user AND NOT c.archived;
$$ LANGUAGE sql STABLE;

-- BR34/BR35: opening + income − expenses = closing. The carry is its own line
-- and is never folded into income.
CREATE OR REPLACE FUNCTION period_balance(
    p_user UUID, p_month DATE, p_wallets UUID[] DEFAULT NULL)
RETURNS TABLE (opening_balance NUMERIC, income NUMERIC, expenses NUMERIC,
               available NUMERIC, closing_balance NUMERIC) AS $$
    WITH movements AS (
        SELECT date_trunc('month', s.settled_on)::date AS month,
               SUM(s.amount) FILTER (WHERE t.kind = 'INCOME')  AS inc,
               SUM(s.amount) FILTER (WHERE t.kind = 'EXPENSE') AS exp
        FROM settlement s
        JOIN entry e        ON e.id = s.entry_id
        JOIN transaction t  ON t.id = e.transaction_id
        LEFT JOIN account a ON a.id = COALESCE(
               e.account_id, (SELECT c.account_id FROM card c WHERE c.id = e.card_id))
        WHERE t.user_id = p_user
          AND s.settled_on IS NOT NULL
          AND (p_wallets IS NULL OR a.wallet_id = ANY (p_wallets))
        GROUP BY 1
    ),
    opening AS (
        SELECT COALESCE((SELECT SUM(initial_balance) FROM account
                          WHERE user_id = p_user
                            AND (p_wallets IS NULL OR wallet_id = ANY (p_wallets))), 0)
             + COALESCE((SELECT SUM(COALESCE(inc,0) - COALESCE(exp,0)) FROM movements
                          WHERE month < date_trunc('month', p_month)), 0) AS bal
    ),
    this_month AS (
        SELECT COALESCE(inc, 0) AS inc, COALESCE(exp, 0) AS exp
        FROM movements WHERE month = date_trunc('month', p_month)
    )
    SELECT o.bal,
           COALESCE(c.inc, 0),
           COALESCE(c.exp, 0),
           o.bal + COALESCE(c.inc, 0),
           o.bal + COALESCE(c.inc, 0) - COALESCE(c.exp, 0)
    FROM opening o LEFT JOIN this_month c ON TRUE;
$$ LANGUAGE sql STABLE;
