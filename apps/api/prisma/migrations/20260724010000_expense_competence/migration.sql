-- BR14: a card purchase counts on the month it was CHARGED, not the month the
-- bill falls due. Grouping by settlement.due_on pushed every credit expense one
-- cycle later, so July's spending appeared in August.
--
-- The competence month is the invoice cycle for a credit charge, and the
-- settlement date for anything else. Derived, never stored (BR36).

CREATE OR REPLACE FUNCTION settlement_competence_month(p_invoice_id UUID, p_due_on DATE)
RETURNS DATE AS $$
  SELECT COALESCE(
    (SELECT i.reference_month FROM invoice i WHERE i.id = p_invoice_id),
    date_trunc('month', p_due_on)::date
  );
$$ LANGUAGE sql STABLE;

DROP VIEW IF EXISTS v_monthly_expense;

CREATE VIEW v_monthly_expense AS
SELECT t.user_id,
       a.wallet_id,
       settlement_competence_month(s.invoice_id, s.due_on) AS month,
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
GROUP BY t.user_id, a.wallet_id, settlement_competence_month(s.invoice_id, s.due_on);

-- Same correction for the per-category variance (BR21).
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
          AND settlement_competence_month(s.invoice_id, s.due_on)
              = date_trunc('month', p_month)::date
        GROUP BY t.category_id
    ) x ON x.category_id = c.id
    WHERE c.user_id = p_user AND NOT c.archived;
$$ LANGUAGE sql STABLE;
