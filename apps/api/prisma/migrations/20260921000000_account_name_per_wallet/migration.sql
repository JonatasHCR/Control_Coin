-- BR37: an account name is unique within its wallet, not across the user.
--
-- Two partial indexes, not one composite: wallet_id is NULLABLE, and Postgres
-- treats NULLs as distinct in a unique index, so UNIQUE (user_id, wallet_id,
-- name) alone would let a user keep any number of wallet-less accounts all
-- called "Itau". The second index gives those their own namespace, which is
-- what BR16 makes them — one report scope.
--
-- Prisma declared the old rule as a bare UNIQUE INDEX, not a table constraint,
-- so it is dropped as an index. The guard covers a database where an older
-- Prisma emitted it the other way.
ALTER TABLE account DROP CONSTRAINT IF EXISTS account_user_id_name_key;
DROP INDEX IF EXISTS account_user_id_name_key;

CREATE UNIQUE INDEX account_name_in_wallet
    ON account (user_id, wallet_id, name)
 WHERE wallet_id IS NOT NULL;

CREATE UNIQUE INDEX account_name_no_wallet
    ON account (user_id, name)
 WHERE wallet_id IS NULL;
