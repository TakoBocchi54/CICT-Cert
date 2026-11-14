BEGIN;

-- Merkle batch issuance and sparse Merkle revocation (new contract deployment).
-- Students no longer sign each certificate: the wallet-link signature is their standing consent.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM student_wallet) THEN
        RAISE EXCEPTION 'Existing wallet links have no saved consent. Back up, run "node scripts/resetTestData.js --yes", then migrate again.';
    END IF;
END;
$$;

ALTER TABLE student_wallet
    ADD COLUMN "consentMessage" TEXT NOT NULL CHECK (btrim("consentMessage") <> ''),
    ADD COLUMN "consentSignature" TEXT NOT NULL CHECK (btrim("consentSignature") <> '');

CREATE OR REPLACE FUNCTION protect_certificate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD."status" IN ('ISSUED', 'REVOKED') THEN
            IF (to_jsonb(NEW) - 'status' - 'revokedAt') IS DISTINCT FROM
               (to_jsonb(OLD) - 'status' - 'revokedAt')
               OR NEW."status" NOT IN ('ISSUED', 'REVOKED')
               OR (OLD."status" = 'REVOKED' AND (NEW."status", NEW."revokedAt") IS DISTINCT FROM (OLD."status", OLD."revokedAt"))
               OR (NEW."status" = 'ISSUED' AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN
                RAISE EXCEPTION 'Issued certificate details are immutable; revoke and replace it';
            END IF;
        -- The hash is set when the batch transaction is signed; from then on the hashed facts are frozen.
        ELSIF OLD."certificateHash" IS NOT NULL AND NEW."certificateHash" IS NOT NULL
            AND (NEW."certificateNo", NEW."studentID", NEW."seminarID", NEW."studentWalletID", NEW."issuerWalletID",
                 NEW."recipientName", NEW."seminarTitle", NEW."seminarDate", NEW."certificateHash")
                IS DISTINCT FROM
                (OLD."certificateNo", OLD."studentID", OLD."seminarID", OLD."studentWalletID", OLD."issuerWalletID",
                 OLD."recipientName", OLD."seminarTitle", OLD."seminarDate", OLD."certificateHash") THEN
            RAISE EXCEPTION 'Clear the certificate hash before changing certificate details';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER TABLE certificate
    DROP CONSTRAINT chk_certificate_consent,
    DROP CONSTRAINT chk_certificate_issuance,
    DROP COLUMN "consentMessage",
    DROP COLUMN "consentSignature",
    DROP COLUMN "consentedAt";

ALTER TABLE certificate
    ADD CONSTRAINT chk_certificate_hash_wallet CHECK ("certificateHash" IS NULL OR "studentWalletID" IS NOT NULL),
    ADD CONSTRAINT chk_certificate_issuance CHECK (
        ("status" IN ('PENDING', 'FAILED') AND "issuedAt" IS NULL)
        OR ("status" IN ('ISSUED', 'REVOKED') AND "studentWalletID" IS NOT NULL
            AND "certificateHash" IS NOT NULL AND "authorizedBy" IS NOT NULL AND "issuedAt" IS NOT NULL)
    );

-- Every certificate of a batch gets its own row with the batch's transaction hash.
DO $$
DECLARE name text;
BEGIN
    FOR name IN SELECT conname FROM pg_constraint
        WHERE conrelid = 'blockchain_record'::regclass AND contype = 'u'
          AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'blockchain_record'::regclass AND attname = 'transactionHash')]
    LOOP
        EXECUTE format('ALTER TABLE blockchain_record DROP CONSTRAINT %I', name);
    END LOOP;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_blockchain_record_transaction_hash ON blockchain_record ("transactionHash");

COMMIT;
