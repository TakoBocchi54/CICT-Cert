BEGIN;

-- Persist before broadcasting so interrupted requests can resend the same transaction.
ALTER TABLE blockchain_record ADD COLUMN IF NOT EXISTS "signedTransaction" TEXT;

COMMIT;
