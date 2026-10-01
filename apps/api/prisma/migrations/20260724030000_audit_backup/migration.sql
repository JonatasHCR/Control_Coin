-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_run" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "location" TEXT NOT NULL,
    "checksum" TEXT,
    "restore_tested_at" TIMESTAMPTZ(6),

    CONSTRAINT "backup_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_event_entity_type_entity_id_changed_at_idx" ON "audit_event"("entity_type", "entity_id", "changed_at");

