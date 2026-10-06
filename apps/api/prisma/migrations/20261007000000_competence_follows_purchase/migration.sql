-- BR14: a card purchase counts on the PURCHASE date, each installment part in
-- the month it falls (1st part in the purchase month, 2nd a month later…).
-- The previous definition used the invoice's reference month, which equals the
-- purchase month only before the closing day: a purchase made after closing
-- vanished from its own month and showed up in the next one.
CREATE OR REPLACE FUNCTION settlement_competence_month(
    p_invoice_id UUID, p_due_on DATE, p_occurred_on DATE, p_sequence_no INT)
RETURNS DATE AS $$
  SELECT CASE
    WHEN p_invoice_id IS NULL THEN date_trunc('month', p_due_on)::date
    ELSE date_trunc('month', p_occurred_on + make_interval(months => p_sequence_no - 1))::date
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE VIEW v_monthly_expense AS
SELECT t.user_id,
       a.wallet_id,
       settlement_competence_month(s.invoice_id, s.due_on, t.occurred_on, s.sequence_no) AS month,
       SUM(s.amount)                               AS expense_total,
       SUM(s.amount) FILTER (WHERE c.is_essential) AS essential_total
FROM settlement s
JOIN entry e         ON e.id = s.entry_id
JOIN transaction t   ON t.id = e.transaction_id
LEFT JOIN category c ON c.id = t.category_id
LEFT JOIN account a  ON a.id = COALESCE(
       e.account_id, (SELECT c2.account_id FROM card c2 WHERE c2.id = e.card_id))
WHERE t.kind = 'EXPENSE'
  AND e.side = 'SOURCE'
GROUP BY t.user_id, a.wallet_id, settlement_competence_month(s.invoice_id, s.due_on, t.occurred_on, s.sequence_no);

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
          AND e.side = 'SOURCE'
          AND settlement_competence_month(s.invoice_id, s.due_on, t.occurred_on, s.sequence_no)
              = date_trunc('month', p_month)::date
        GROUP BY t.category_id
    ) x ON x.category_id = c.id
    WHERE c.user_id = p_user AND NOT c.archived;
$$ LANGUAGE sql STABLE;

DROP FUNCTION settlement_competence_month(UUID, DATE);
