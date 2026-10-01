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
