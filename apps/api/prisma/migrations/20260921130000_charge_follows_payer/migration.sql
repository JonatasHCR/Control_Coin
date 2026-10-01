-- BR39 + BR07: a credit charge leaves the account that PAID THE INVOICE, which
-- is not always the card's parent account. When a third party settled the bill
-- (a liability, BR39), the money never left the user's own accounts, so the
-- period must not report it as their spending — otherwise the balance falls by
-- money that was never theirs to lose and the debt gets counted twice.
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
               e.account_id,
               -- whoever's account funded the invoice this charge sits on
               (SELECT payer.account_id
                  FROM settlement ps
                  JOIN entry pd    ON pd.id = ps.entry_id AND pd.side = 'DESTINATION'
                  JOIN entry payer ON payer.transaction_id = pd.transaction_id
                                  AND payer.side = 'SOURCE'
                                  AND payer.account_id IS NOT NULL
                 WHERE ps.invoice_id = s.invoice_id
                 LIMIT 1),
               (SELECT c.account_id FROM card c WHERE c.id = e.card_id))
        WHERE t.user_id = p_user
          AND s.settled_on IS NOT NULL
          AND (a.type IS NULL OR a.type <> 'LIABILITY')
          AND (p_wallets IS NULL OR a.wallet_id = ANY (p_wallets))
        GROUP BY 1
    ),
    opening AS (
        SELECT COALESCE((SELECT SUM(initial_balance) FROM account
                          WHERE user_id = p_user
                            AND type <> 'LIABILITY'
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
