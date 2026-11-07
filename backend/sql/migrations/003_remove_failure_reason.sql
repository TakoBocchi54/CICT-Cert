BEGIN;

ALTER TABLE blockchain_record DROP COLUMN IF EXISTS "failureReason";

COMMIT;
