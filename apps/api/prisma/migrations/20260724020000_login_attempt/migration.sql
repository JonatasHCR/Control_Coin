-- CreateTable
CREATE TABLE "login_attempt" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeeded" BOOLEAN NOT NULL,
    "ip" TEXT,

    CONSTRAINT "login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_attempt_username_attempted_at_idx" ON "login_attempt"("username", "attempted_at");

