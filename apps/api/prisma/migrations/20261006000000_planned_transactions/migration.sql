-- BR40: planned transactions — a forecast that becomes a real transaction only
-- when confirmed. Nothing derived (views, functions) reads this table.
CREATE TABLE "planned_transaction" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expected_on" DATE NOT NULL,
    "account_id" UUID,
    "card_id" UUID,
    "card_function" TEXT,
    "destination_account_id" UUID,
    "notify_days_before" SMALLINT NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transaction_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planned_transaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT planned_kind_valid      CHECK (kind IN ('INCOME', 'EXPENSE', 'TRANSFER')),
    CONSTRAINT planned_status_valid    CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED')),
    CONSTRAINT planned_amount_positive CHECK (amount > 0),
    CONSTRAINT planned_notify_range    CHECK (notify_days_before BETWEEN 0 AND 60),
    CONSTRAINT planned_one_source      CHECK (account_id IS NULL OR card_id IS NULL),
    CONSTRAINT planned_card_function   CHECK ((card_id IS NULL) = (card_function IS NULL)),
    -- A confirmed plan points at what it became; a pending one at nothing.
    CONSTRAINT planned_resolution      CHECK ((status = 'PENDING') = (resolved_at IS NULL))
);

CREATE INDEX "planned_transaction_user_id_status_expected_on_idx"
    ON "planned_transaction"("user_id", "status", "expected_on");

ALTER TABLE "planned_transaction" ADD CONSTRAINT "planned_transaction_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planned_transaction" ADD CONSTRAINT "planned_transaction_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "planned_transaction" ADD CONSTRAINT "planned_transaction_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "planned_transaction" ADD CONSTRAINT "planned_transaction_card_id_fkey"
    FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "planned_transaction" ADD CONSTRAINT "planned_transaction_destination_account_id_fkey"
    FOREIGN KEY ("destination_account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "planned_transaction" ADD CONSTRAINT "planned_transaction_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
