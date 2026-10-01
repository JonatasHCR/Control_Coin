-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "main_currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_id" UUID,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "initial_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "allows_credit" BOOLEAN NOT NULL DEFAULT false,
    "allows_debit" BOOLEAN NOT NULL DEFAULT false,
    "credit_limit" DECIMAL(14,2),
    "closing_day" SMALLINT,
    "due_day" SMALLINT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "is_essential" BOOLEAN NOT NULL DEFAULT false,
    "monthly_target" DECIMAL(14,2),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "frequency" TEXT NOT NULL,
    "interval_count" SMALLINT NOT NULL DEFAULT 1,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source_format" TEXT NOT NULL,
    "file_name" TEXT,
    "sheet_name" TEXT,
    "number_locale" TEXT,
    "date_system" TEXT,
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID,
    "series_id" UUID,
    "import_batch_id" UUID,
    "kind" TEXT NOT NULL,
    "occurrence_type" TEXT NOT NULL DEFAULT 'OCCASIONAL',
    "description" TEXT,
    "occurred_on" DATE NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "external_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID,
    "card_id" UUID,
    "side" TEXT NOT NULL,
    "card_function" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "installment_count" SMALLINT NOT NULL DEFAULT 1,

    CONSTRAINT "entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "reference_month" DATE NOT NULL,
    "closes_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "invoice_id" UUID,
    "sequence_no" SMALLINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "due_on" DATE NOT NULL,
    "settled_on" DATE,

    CONSTRAINT "settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "period_type" TEXT NOT NULL DEFAULT 'MONTHLY',
    "period_start" DATE NOT NULL,
    "limit_amount" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL,

    CONSTRAINT "budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_id" UUID,
    "account_id" UUID,
    "name" TEXT NOT NULL,
    "target_amount" DECIMAL(14,2) NOT NULL,
    "deadline" DATE NOT NULL,
    "source_type" TEXT NOT NULL,
    "counts_initial_balance" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_contribution" (
    "id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "contributed_on" DATE NOT NULL,
    "note" TEXT,

    CONSTRAINT "goal_contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rule" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" UUID,
    "threshold_percent" SMALLINT,
    "days_before" SMALLINT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "alert_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "alert_rule_id" UUID,
    "type" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" UUID,
    "message" TEXT NOT NULL,
    "raised_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "dismissed_at" TIMESTAMPTZ(6),
    "withdrawn_at" TIMESTAMPTZ(6),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_code" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_run" (
    "id" UUID NOT NULL,
    "job_name" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL,
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rate" (
    "base_currency" CHAR(3) NOT NULL,
    "quote_currency" CHAR(3) NOT NULL,
    "rate_date" DATE NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,

    CONSTRAINT "exchange_rate_pkey" PRIMARY KEY ("base_currency","quote_currency","rate_date")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_username_key" ON "app_user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_user_id_name_key" ON "wallet"("user_id", "name");

-- CreateIndex
CREATE INDEX "account_wallet_id_idx" ON "account"("wallet_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_user_id_name_key" ON "account"("user_id", "name");

-- CreateIndex
CREATE INDEX "card_account_id_idx" ON "card"("account_id");

-- CreateIndex
CREATE INDEX "transaction_user_id_occurred_on_idx" ON "transaction"("user_id", "occurred_on");

-- CreateIndex
CREATE INDEX "entry_transaction_id_idx" ON "entry"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_card_id_reference_month_key" ON "invoice"("card_id", "reference_month");

-- CreateIndex
CREATE INDEX "settlement_due_on_idx" ON "settlement"("due_on");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_entry_id_sequence_no_key" ON "settlement"("entry_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "budget_user_id_category_id_period_type_period_start_key" ON "budget"("user_id", "category_id", "period_type", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- AddForeignKey
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card" ADD CONSTRAINT "card_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contribution" ADD CONSTRAINT "goal_contribution_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rule" ADD CONSTRAINT "alert_rule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_alert_rule_id_fkey" FOREIGN KEY ("alert_rule_id") REFERENCES "alert_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Rules Prisma cannot express (see prisma/sql/) ──────────────────────────

-- Rules Prisma cannot express. Applied by migration, reviewed as SQL.
-- The database is the authority; the zod schemas in @cc/domain are fast feedback.

-- ── BR09 ────────────────────────────────────────────────────────────────────
-- A card enables at least one function, and credit terms exist only with credit.
ALTER TABLE card
  ADD CONSTRAINT card_has_a_function
    CHECK (allows_credit OR allows_debit),
  ADD CONSTRAINT card_credit_terms
    CHECK (NOT allows_credit OR
           (credit_limit IS NOT NULL AND closing_day IS NOT NULL AND due_day IS NOT NULL)),
  ADD CONSTRAINT card_closing_day_range CHECK (closing_day BETWEEN 1 AND 31),
  ADD CONSTRAINT card_due_day_range     CHECK (due_day     BETWEEN 1 AND 31);

-- ── BR11 ────────────────────────────────────────────────────────────────────
-- An entry names exactly one source, and a card entry always names its function.
ALTER TABLE entry
  ADD CONSTRAINT entry_one_source
    CHECK ((account_id IS NULL) <> (card_id IS NULL)),
  ADD CONSTRAINT entry_function_iff_card
    CHECK ((card_id IS NULL) = (card_function IS NULL)),
  ADD CONSTRAINT entry_amount_positive     CHECK (amount > 0),
  ADD CONSTRAINT entry_installments_valid  CHECK (installment_count >= 1);

ALTER TABLE transaction
  ADD CONSTRAINT transaction_total_positive CHECK (total_amount > 0),
  -- BR10: a recurring transaction belongs to a series; nothing else does.
  ADD CONSTRAINT transaction_series_match
    CHECK ((occurrence_type = 'RECURRING') = (series_id IS NOT NULL));

ALTER TABLE settlement
  ADD CONSTRAINT settlement_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT settlement_sequence_valid  CHECK (sequence_no >= 1);

-- BR20: a target is absent or meaningful, never zero.
ALTER TABLE category
  ADD CONSTRAINT category_target_positive CHECK (monthly_target IS NULL OR monthly_target > 0),
  ADD CONSTRAINT category_not_self_parent CHECK (parent_id IS DISTINCT FROM id);

-- BR23: a budget limit may be absent (inheriting the target) but never zero.
ALTER TABLE budget
  ADD CONSTRAINT budget_limit_positive CHECK (limit_amount IS NULL OR limit_amount > 0);

-- BR15: exactly one goal source, and never a card.
ALTER TABLE goal
  ADD CONSTRAINT goal_target_positive CHECK (target_amount > 0),
  ADD CONSTRAINT goal_source_match CHECK (
       (source_type = 'WALLET'  AND wallet_id IS NOT NULL AND account_id IS NULL)
    OR (source_type = 'ACCOUNT' AND account_id IS NOT NULL AND wallet_id IS NULL)
    OR (source_type = 'MANUAL'  AND wallet_id IS NULL     AND account_id IS NULL));

-- BR29/BR30: language is one of two, and is not a currency.
ALTER TABLE app_user
  ADD CONSTRAINT user_language_supported CHECK (language IN ('pt-BR', 'en')),
  ADD CONSTRAINT user_theme_supported    CHECK (theme IN ('system', 'light', 'dark'));

-- BR24: import de-duplication, per user.
CREATE UNIQUE INDEX transaction_external_ref_unique
  ON transaction (user_id, external_ref) WHERE external_ref IS NOT NULL;

-- BR28: one live notification per rule and subject — a condition that persists
-- updates the existing row instead of raising a new one every day.
CREATE UNIQUE INDEX notification_one_live
  ON notification (alert_rule_id, subject_id)
  WHERE read_at IS NULL AND dismissed_at IS NULL AND withdrawn_at IS NULL;

CREATE INDEX ix_notification_unread
  ON notification (user_id, raised_at DESC)
  WHERE read_at IS NULL AND withdrawn_at IS NULL;

CREATE INDEX ix_settlement_unsettled ON settlement (due_on) WHERE settled_on IS NULL;
CREATE INDEX ix_settlement_invoice   ON settlement (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX ix_category_essential   ON category (user_id) WHERE is_essential;

-- One nesting level: a parent must itself be top level (UC04).
CREATE OR REPLACE FUNCTION category_depth_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL
     AND (SELECT parent_id FROM category WHERE id = NEW.parent_id) IS NOT NULL THEN
    RAISE EXCEPTION 'categories nest only one level deep';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER category_depth_guard_trg
  BEFORE INSERT OR UPDATE ON category
  FOR EACH ROW EXECUTE FUNCTION category_depth_guard();

-- ── BR09 ────────────────────────────────────────────────────────────────────
-- The function used must be one the card actually enables.
CREATE OR REPLACE FUNCTION entry_function_enabled() RETURNS TRIGGER AS $$
DECLARE c card%ROWTYPE;
BEGIN
  IF NEW.card_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO c FROM card WHERE id = NEW.card_id;
  IF (NEW.card_function = 'CREDIT' AND NOT c.allows_credit)
     OR (NEW.card_function = 'DEBIT' AND NOT c.allows_debit) THEN
    RAISE EXCEPTION 'CARD_FUNCTION_DISABLED: card % does not enable %', c.name, NEW.card_function;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER entry_function_enabled_trg
  BEFORE INSERT OR UPDATE ON entry
  FOR EACH ROW EXECUTE FUNCTION entry_function_enabled();

-- ── BR07 ────────────────────────────────────────────────────────────────────
-- Credit charges land on an invoice; debit and direct settlements never do.
CREATE OR REPLACE FUNCTION settlement_invoice_rule() RETURNS TRIGGER AS $$
DECLARE fn TEXT; sd TEXT;
BEGIN
  SELECT card_function, side INTO fn, sd FROM entry WHERE id = NEW.entry_id;
  -- A destination entry pointing at an invoice is a payment (UC12), not a charge.
  IF sd = 'DESTINATION' THEN RETURN NEW; END IF;
  IF fn IS NOT DISTINCT FROM 'CREDIT' AND NEW.invoice_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_SETTLEMENT_TARGET: a credit charge must land on an invoice';
  END IF;
  IF fn IS DISTINCT FROM 'CREDIT' AND NEW.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_SETTLEMENT_TARGET: only credit charges land on an invoice';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER settlement_invoice_rule_trg
  BEFORE INSERT OR UPDATE ON settlement
  FOR EACH ROW EXECUTE FUNCTION settlement_invoice_rule();

-- ── BR12 ────────────────────────────────────────────────────────────────────
-- The split rule. DEFERRABLE INITIALLY DEFERRED, so a transaction and all its
-- entries are written first and the sums are checked at COMMIT.
CREATE OR REPLACE FUNCTION transaction_balanced() RETURNS TRIGGER AS $$
DECLARE
  t transaction%ROWTYPE;
  src NUMERIC(14,2); dst NUMERIC(14,2);
  n_src INT; n_dst INT;
BEGIN
  SELECT * INTO t FROM transaction
   WHERE id = COALESCE(NEW.transaction_id, OLD.transaction_id);
  IF NOT FOUND THEN RETURN NULL; END IF;   -- transaction deleted; nothing to check

  SELECT COALESCE(SUM(amount) FILTER (WHERE side = 'SOURCE'), 0),
         COALESCE(SUM(amount) FILTER (WHERE side = 'DESTINATION'), 0),
         COUNT(*) FILTER (WHERE side = 'SOURCE'),
         COUNT(*) FILTER (WHERE side = 'DESTINATION')
    INTO src, dst, n_src, n_dst
    FROM entry WHERE transaction_id = t.id;

  IF t.kind = 'EXPENSE' THEN
    IF src <> t.total_amount OR n_dst > 0 THEN
      RAISE EXCEPTION 'SPLIT_NOT_BALANCED: expense sources total %, expected %', src, t.total_amount;
    END IF;

  ELSIF t.kind = 'INCOME' THEN
    IF dst <> t.total_amount OR n_src > 0 THEN
      RAISE EXCEPTION 'SPLIT_NOT_BALANCED: income destinations total %, expected %', dst, t.total_amount;
    END IF;

  ELSE  -- TRANSFER
    IF src <> t.total_amount OR dst <> t.total_amount THEN
      RAISE EXCEPTION 'SPLIT_NOT_BALANCED: transfer sides total % and %, expected %',
        src, dst, t.total_amount;
    END IF;
    IF n_src > 1 AND n_dst > 1 THEN
      RAISE EXCEPTION 'SPLIT_NOT_BALANCED: a transfer may be split on only one side';
    END IF;
    -- BR31: debt cannot pay debt.
    IF EXISTS (SELECT 1 FROM entry
                WHERE transaction_id = t.id AND side = 'SOURCE' AND card_function = 'CREDIT') THEN
      RAISE EXCEPTION 'CREDIT_CANNOT_PAY: a transfer cannot be funded by a credit function';
    END IF;
  END IF;

  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER transaction_balanced_trg
  AFTER INSERT OR UPDATE OR DELETE ON entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transaction_balanced();

-- The installment plan must match the entry it belongs to (BR10, BR12).
CREATE OR REPLACE FUNCTION entry_settlements_match() RETURNS TRIGGER AS $$
DECLARE e entry%ROWTYPE; total NUMERIC(14,2); n INT;
BEGIN
  SELECT * INTO e FROM entry WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(amount), 0), COUNT(*) INTO total, n
    FROM settlement WHERE entry_id = e.id;

  IF total <> e.amount THEN
    RAISE EXCEPTION 'SPLIT_NOT_BALANCED: settlements total %, entry is %', total, e.amount;
  END IF;
  IF n <> e.installment_count THEN
    RAISE EXCEPTION 'SPLIT_NOT_BALANCED: % settlements for an entry planned in %',
      n, e.installment_count;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER entry_settlements_match_trg
  AFTER INSERT OR UPDATE OR DELETE ON settlement
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION entry_settlements_match();

-- ── BR23 ────────────────────────────────────────────────────────────────────
-- A budget needs its own limit, or a target on its category to inherit.
CREATE OR REPLACE FUNCTION budget_has_a_limit() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.limit_amount IS NULL
     AND (SELECT monthly_target FROM category WHERE id = NEW.category_id) IS NULL THEN
    RAISE EXCEPTION 'a budget needs an explicit limit, or a monthly target on its category';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER budget_has_a_limit_trg
  BEFORE INSERT OR UPDATE ON budget
  FOR EACH ROW EXECUTE FUNCTION budget_has_a_limit();

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
