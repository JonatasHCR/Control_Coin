-- BR14/BR21: a credit purchase counts in the month it was MADE, not the month
-- its bill falls due. `v_monthly_expense` was moved onto the competence month
-- by an earlier migration; category_variance was left grouping by the raw due
-- date, so the two disagreed about the same purchase and a category's variance
-- read as untouched in the month it was actually spent.
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
          AND settlement_competence_month(s.invoice_id, s.due_on)
              = date_trunc('month', p_month)::date
        GROUP BY t.category_id
    ) x ON x.category_id = c.id
    WHERE c.user_id = p_user AND NOT c.archived;
$$ LANGUAGE sql STABLE;
