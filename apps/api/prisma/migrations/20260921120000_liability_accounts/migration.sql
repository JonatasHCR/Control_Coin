-- BR39: an account may record a debt instead of money held. What is owed must
-- never be netted against what is held, so liabilities leave every figure that
-- answers "how much do I have".

-- A wallet is the sum of the money in it (BR08), not money minus debt.
CREATE OR REPLACE VIEW v_wallet_balance AS
SELECT w.id AS wallet_id, w.user_id, w.name,
       COALESCE(SUM(b.balance) FILTER (WHERE a.type <> 'LIABILITY'), 0) AS balance
FROM wallet w
LEFT JOIN v_account_balance b ON b.wallet_id = w.id
LEFT JOIN account a          ON a.id = b.account_id
GROUP BY w.id;

-- The period's opening and its movements both skip liabilities (BR34, BR39).
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
