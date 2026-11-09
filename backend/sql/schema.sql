-- Fresh databases only. Existing databases use scripts/migrateSeminarSchema.js.
BEGIN;

CREATE TABLE users (
    "userID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "email" VARCHAR(255) NOT NULL UNIQUE,
    -- Students log in through the embedded wallet, so they have no password.
    "passwordHash" VARCHAR(255),
    "role" VARCHAR(20) NOT NULL
        CHECK ("role" IN ('FACULTY', 'STUDENT')),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Faculty must always have a password.
    CONSTRAINT chk_faculty_has_password
        CHECK ("role" = 'STUDENT' OR "passwordHash" IS NOT NULL)
);

CREATE TABLE cict_faculty (
    "facultyID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "userID" BIGINT NOT NULL UNIQUE,
    "firstName" VARCHAR(255) NOT NULL,
    "lastName" VARCHAR(255) NOT NULL,
    "canIssue" BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_faculty_user
        FOREIGN KEY ("userID")
        REFERENCES users ("userID")
);

CREATE TABLE student (
    "studentID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "userID" BIGINT NOT NULL UNIQUE,
    "fullName" VARCHAR(255) NOT NULL,
    "program" VARCHAR(255) NOT NULL,
    CONSTRAINT fk_student_user
        FOREIGN KEY ("userID")
        REFERENCES users ("userID")
);

CREATE TABLE student_wallet (
    "studentWalletID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "studentID" BIGINT NOT NULL UNIQUE,
    "studentWalletAddress" VARCHAR(42) NOT NULL UNIQUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_student_wallet_student
        FOREIGN KEY ("studentID")
        REFERENCES student ("studentID"),
    CONSTRAINT uq_student_wallet_pair
        UNIQUE ("studentID", "studentWalletID")
);

CREATE TABLE issuer_wallet (
    "issuerWalletID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "issuerWalletAddress" VARCHAR(42) NOT NULL UNIQUE,
    "label" VARCHAR(100) NOT NULL,
    "network" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE certificate (
    "certificateID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "certificateNo" BIGINT NOT NULL DEFAULT nextval('certificate_number_seq') UNIQUE,
    "studentID" BIGINT NOT NULL,
    "studentWalletID" BIGINT,
    "authorizedBy" BIGINT,
    "issuerWalletID" BIGINT NOT NULL,
    "recipientName" VARCHAR(255) NOT NULL,
    "seminarTitle" VARCHAR(255) NOT NULL,
    "seminarDate" DATE NOT NULL,
    "certificateHash" VARCHAR(66),
    "seminarID" BIGINT NOT NULL,
    "consentMessage" TEXT,
    "consentSignature" TEXT,
    "consentedAt" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK ("status" IN ('PENDING', 'ISSUED', 'REVOKED', 'FAILED')),
    "issuedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    CONSTRAINT fk_certificate_student
        FOREIGN KEY ("studentID")
        REFERENCES student ("studentID"),
    CONSTRAINT fk_certificate_wallet
        FOREIGN KEY ("studentWalletID")
        REFERENCES student_wallet ("studentWalletID"),
    CONSTRAINT fk_certificate_faculty
        FOREIGN KEY ("authorizedBy")
        REFERENCES cict_faculty ("facultyID"),
    CONSTRAINT fk_certificate_issuer_wallet
        FOREIGN KEY ("issuerWalletID")
        REFERENCES issuer_wallet ("issuerWalletID"),
    CONSTRAINT fk_certificate_student_wallet_match
        FOREIGN KEY ("studentID", "studentWalletID")
        REFERENCES student_wallet ("studentID", "studentWalletID")
);

CREATE TABLE blockchain_record (
    "transactionID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "certificateID" BIGINT NOT NULL,
    "transactionType" VARCHAR(10) NOT NULL
        CHECK ("transactionType" IN ('MINT', 'REVOKE')),
    "transactionHash" VARCHAR(66) UNIQUE,
    "signedTransaction" TEXT,
    "requestedBy" BIGINT NOT NULL,
    "revocationReason" TEXT,
    "tokenID" BIGINT,
    "contractAddress" VARCHAR(42),
    "fromAddress" VARCHAR(42),
    "toAddress" VARCHAR(42),
    "network" VARCHAR(50) NOT NULL,
    "blockNum" BIGINT,
    "transactionStatus" VARCHAR(20) NOT NULL
        CHECK ("transactionStatus" IN ('PENDING', 'CONFIRMED', 'FAILED')),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_blockchain_certificate
        FOREIGN KEY ("certificateID")
        REFERENCES certificate ("certificateID")
);

-- The composite index also covers the certificate's studentID-only foreign key.
CREATE INDEX IF NOT EXISTS idx_certificate_student_wallet
    ON certificate ("studentID", "studentWalletID");

CREATE INDEX IF NOT EXISTS idx_certificate_student_wallet_id
    ON certificate ("studentWalletID");

CREATE INDEX IF NOT EXISTS idx_certificate_authorized_by
    ON certificate ("authorizedBy");

CREATE INDEX IF NOT EXISTS idx_certificate_issuer_wallet_id
    ON certificate ("issuerWalletID");

CREATE INDEX IF NOT EXISTS idx_blockchain_record_certificate_id
    ON blockchain_record ("certificateID");

ALTER SEQUENCE certificate_number_seq OWNED BY certificate."certificateNo";

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
                 NEW."recipientName", NEW."seminarTitle", NEW."seminarDate", NEW."certificateHash")
                IS DISTINCT FROM
                (OLD."certificateNo", OLD."studentID", OLD."seminarID", OLD."studentWalletID", OLD."issuerWalletID",
                 OLD."recipientName", OLD."seminarTitle", OLD."seminarDate", OLD."certificateHash") THEN
            RAISE EXCEPTION 'Clear the previous consent before changing certificate details';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
CREATE TRIGGER certificate_history_guard BEFORE INSERT OR UPDATE ON certificate
    FOR EACH ROW EXECUTE FUNCTION protect_certificate();

COMMIT;
