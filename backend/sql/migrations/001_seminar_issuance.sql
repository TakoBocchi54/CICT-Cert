-- Run once through scripts/migrateSeminarSchema.js with the original timestamp timezone.
BEGIN;

DO $$
BEGIN
    IF current_setting('cict.legacy_timezone', true) IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = current_setting('cict.legacy_timezone', true)) THEN
        RAISE EXCEPTION 'Set cict.legacy_timezone to the timezone used for existing timestamps';
    END IF;
    IF EXISTS (SELECT 1 FROM certificate) OR EXISTS (SELECT 1 FROM blockchain_record) THEN
        RAISE EXCEPTION 'Existing certificate history needs a reviewed seminar and consent backfill; migration cancelled';
    END IF;
    IF EXISTS (SELECT lower(btrim("email")) FROM users GROUP BY lower(btrim("email")) HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Resolve duplicate normalized email addresses before migrating';
    END IF;
END;
$$;

UPDATE users SET "email" = lower(btrim("email"));
ALTER TABLE student ADD COLUMN "fullName" VARCHAR(255);
UPDATE student SET "fullName" = btrim(concat_ws(' ', btrim("firstName"), btrim("lastName")));
ALTER TABLE student ALTER COLUMN "fullName" SET NOT NULL,
    DROP COLUMN "firstName", DROP COLUMN "lastName";

ALTER TABLE users ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ
    USING "createdAt" AT TIME ZONE current_setting('cict.legacy_timezone');
ALTER TABLE student_wallet ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ
    USING "createdAt" AT TIME ZONE current_setting('cict.legacy_timezone');
ALTER TABLE issuer_wallet ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ
    USING "createdAt" AT TIME ZONE current_setting('cict.legacy_timezone');

CREATE TABLE seminar (
    "seminarID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "seminarTitle" VARCHAR(255) NOT NULL CHECK (btrim("seminarTitle") <> ''),
    "seminarDate" DATE NOT NULL,
    "createdBy" BIGINT NOT NULL REFERENCES cict_faculty ("facultyID"),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE seminar_registration (
    "seminarID" BIGINT NOT NULL REFERENCES seminar ("seminarID"),
    "studentID" BIGINT NOT NULL REFERENCES student ("studentID"),
    "attended" BOOLEAN NOT NULL DEFAULT FALSE,
    "registeredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("seminarID", "studentID")
);

CREATE SEQUENCE certificate_number_seq;

ALTER TABLE certificate
    ADD COLUMN "seminarID" BIGINT NOT NULL,
    ADD COLUMN "consentMessage" TEXT,
    ADD COLUMN "consentSignature" TEXT,
    ADD COLUMN "consentedAt" TIMESTAMPTZ,
    ADD COLUMN "replacesCertificateID" BIGINT,
    ADD COLUMN "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "studentWalletID" DROP NOT NULL,
    ALTER COLUMN "authorizedBy" DROP NOT NULL,
    ALTER COLUMN "certificateHash" DROP NOT NULL,
    ALTER COLUMN "certificateHash" TYPE VARCHAR(66),
    ALTER COLUMN "certificateNo" SET DEFAULT nextval('certificate_number_seq'),
    ALTER COLUMN "status" SET DEFAULT 'PENDING',
    ALTER COLUMN "issuedAt" TYPE TIMESTAMPTZ USING "issuedAt" AT TIME ZONE current_setting('cict.legacy_timezone'),
    ALTER COLUMN "revokedAt" TYPE TIMESTAMPTZ USING "revokedAt" AT TIME ZONE current_setting('cict.legacy_timezone');
ALTER SEQUENCE certificate_number_seq OWNED BY certificate."certificateNo";

ALTER TABLE blockchain_record RENAME COLUMN "issuedAt" TO "createdAt";
ALTER TABLE blockchain_record
    ADD COLUMN "requestedBy" BIGINT NOT NULL,
    ADD COLUMN "revocationReason" TEXT,
    ADD COLUMN "failureReason" TEXT,
    ALTER COLUMN "transactionHash" DROP NOT NULL,
    ALTER COLUMN "transactionHash" TYPE VARCHAR(66),
    ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE current_setting('cict.legacy_timezone');

ALTER TABLE users ADD CONSTRAINT chk_normalized_email
    CHECK ("email" = lower(btrim("email")) AND "email" <> '');
ALTER TABLE student ADD CONSTRAINT chk_student_full_name CHECK (btrim("fullName") <> '');
ALTER TABLE student_wallet ADD CONSTRAINT chk_student_wallet_address
    CHECK ("studentWalletAddress" ~ '^0x[0-9A-Fa-f]{40}$');
ALTER TABLE issuer_wallet ADD CONSTRAINT chk_issuer_wallet_address
    CHECK ("issuerWalletAddress" ~ '^0x[0-9A-Fa-f]{40}$');
CREATE UNIQUE INDEX uq_student_wallet_address_lower ON student_wallet (lower("studentWalletAddress"));
CREATE UNIQUE INDEX uq_issuer_wallet_address_lower ON issuer_wallet (lower("issuerWalletAddress"));

ALTER TABLE certificate
    ADD CONSTRAINT fk_certificate_registration FOREIGN KEY ("seminarID", "studentID")
        REFERENCES seminar_registration ("seminarID", "studentID"),
    ADD CONSTRAINT fk_certificate_replacement FOREIGN KEY ("replacesCertificateID")
        REFERENCES certificate ("certificateID"),
    ADD CONSTRAINT chk_certificate_number CHECK ("certificateNo" > 0),
    ADD CONSTRAINT chk_certificate_snapshots
        CHECK (btrim("recipientName") <> '' AND btrim("seminarTitle") <> ''),
    ADD CONSTRAINT uq_certificate_hash UNIQUE ("certificateHash"),
    ADD CONSTRAINT chk_certificate_hash CHECK ("certificateHash" ~ '^0x[0-9a-f]{64}$'),
    ADD CONSTRAINT chk_certificate_consent CHECK (
        ("consentMessage" IS NULL AND "consentSignature" IS NULL AND "consentedAt" IS NULL)
        OR ("consentMessage" IS NOT NULL AND btrim("consentMessage") <> ''
            AND "consentSignature" IS NOT NULL AND btrim("consentSignature") <> ''
            AND "consentedAt" IS NOT NULL AND "studentWalletID" IS NOT NULL AND "certificateHash" IS NOT NULL)
    ),
    ADD CONSTRAINT chk_certificate_issuance CHECK (
        ("status" IN ('PENDING', 'FAILED') AND "issuedAt" IS NULL)
        OR ("status" IN ('ISSUED', 'REVOKED') AND "studentWalletID" IS NOT NULL
            AND "certificateHash" IS NOT NULL AND "authorizedBy" IS NOT NULL
            AND "consentedAt" IS NOT NULL AND "issuedAt" IS NOT NULL AND "issuedAt" >= "consentedAt")
    ),
    ADD CONSTRAINT chk_certificate_revocation CHECK (
        ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokedAt" >= "issuedAt")
        OR ("status" <> 'REVOKED' AND "revokedAt" IS NULL)
    );

-- Failed attempts retry the same certificate number; replacements follow revocation.
CREATE UNIQUE INDEX uq_certificate_active_registration
    ON certificate ("seminarID", "studentID") WHERE "status" <> 'REVOKED';
CREATE INDEX idx_certificate_replacement ON certificate ("replacesCertificateID");
CREATE INDEX idx_registration_student ON seminar_registration ("studentID");
CREATE INDEX idx_seminar_created_by ON seminar ("createdBy");

ALTER TABLE blockchain_record
    ADD CONSTRAINT fk_blockchain_requested_by FOREIGN KEY ("requestedBy") REFERENCES cict_faculty ("facultyID"),
    ADD CONSTRAINT chk_transaction_hash CHECK ("transactionHash" ~ '^0x[0-9a-f]{64}$'),
    ADD CONSTRAINT chk_transaction_confirmation CHECK (
        "transactionStatus" <> 'CONFIRMED' OR ("transactionHash" IS NOT NULL AND "blockNum" IS NOT NULL AND "tokenID" IS NOT NULL)
    ),
    ADD CONSTRAINT chk_transaction_revocation_reason CHECK (
        ("transactionType" = 'MINT' AND "revocationReason" IS NULL)
        OR ("transactionType" = 'REVOKE' AND "revocationReason" IS NOT NULL AND btrim("revocationReason") <> '')
    );
CREATE UNIQUE INDEX uq_blockchain_pending_certificate
    ON blockchain_record ("certificateID") WHERE "transactionStatus" = 'PENDING';
CREATE INDEX idx_blockchain_requested_by ON blockchain_record ("requestedBy");

CREATE FUNCTION protect_certificate() RETURNS trigger LANGUAGE plpgsql AS $$
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
        ELSIF OLD."consentedAt" IS NOT NULL AND NEW."consentedAt" IS NOT NULL
            AND (NEW."certificateNo", NEW."studentID", NEW."seminarID", NEW."studentWalletID", NEW."issuerWalletID",
                 NEW."recipientName", NEW."seminarTitle", NEW."seminarDate", NEW."certificateHash", NEW."replacesCertificateID")
                IS DISTINCT FROM
                (OLD."certificateNo", OLD."studentID", OLD."seminarID", OLD."studentWalletID", OLD."issuerWalletID",
                 OLD."recipientName", OLD."seminarTitle", OLD."seminarDate", OLD."certificateHash", OLD."replacesCertificateID") THEN
            RAISE EXCEPTION 'Clear the previous consent before changing certificate details';
        END IF;
    END IF;

    IF NEW."replacesCertificateID" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM certificate original
        WHERE original."certificateID" = NEW."replacesCertificateID"
          AND original."certificateID" <> NEW."certificateID"
          AND original."studentID" = NEW."studentID" AND original."seminarID" = NEW."seminarID"
          AND original."status" = 'REVOKED'
    ) THEN
        RAISE EXCEPTION 'A replacement must reference a revoked certificate for the same registration';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER certificate_history_guard BEFORE INSERT OR UPDATE ON certificate
    FOR EACH ROW EXECUTE FUNCTION protect_certificate();

COMMIT;
