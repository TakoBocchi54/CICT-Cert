BEGIN;

-- IDs, certificate numbers, token IDs and block numbers move from BIGINT to INTEGER.
-- Fails (and rolls back) if any stored value is above 2147483647. Identity sequences follow their column type.

ALTER SEQUENCE certificate_number_seq AS INTEGER;

ALTER TABLE users ALTER COLUMN "userID" TYPE INTEGER;
ALTER TABLE cict_faculty ALTER COLUMN "facultyID" TYPE INTEGER, ALTER COLUMN "userID" TYPE INTEGER;
ALTER TABLE student ALTER COLUMN "studentID" TYPE INTEGER, ALTER COLUMN "userID" TYPE INTEGER;
ALTER TABLE student_wallet ALTER COLUMN "studentWalletID" TYPE INTEGER, ALTER COLUMN "studentID" TYPE INTEGER;
ALTER TABLE issuer_wallet ALTER COLUMN "issuerWalletID" TYPE INTEGER;
ALTER TABLE certificate_template ALTER COLUMN "templateID" TYPE INTEGER, ALTER COLUMN "createdBy" TYPE INTEGER;
ALTER TABLE certificate_template_signature ALTER COLUMN "signatureID" TYPE INTEGER, ALTER COLUMN "templateID" TYPE INTEGER;
ALTER TABLE seminar ALTER COLUMN "seminarID" TYPE INTEGER, ALTER COLUMN "createdBy" TYPE INTEGER, ALTER COLUMN "templateID" TYPE INTEGER;
ALTER TABLE seminar_registration ALTER COLUMN "seminarID" TYPE INTEGER, ALTER COLUMN "studentID" TYPE INTEGER;
ALTER TABLE certificate
    ALTER COLUMN "certificateID" TYPE INTEGER,
    ALTER COLUMN "certificateNo" TYPE INTEGER,
    ALTER COLUMN "studentID" TYPE INTEGER,
    ALTER COLUMN "studentWalletID" TYPE INTEGER,
    ALTER COLUMN "authorizedBy" TYPE INTEGER,
    ALTER COLUMN "issuerWalletID" TYPE INTEGER,
    ALTER COLUMN "seminarID" TYPE INTEGER;
ALTER TABLE blockchain_record
    ALTER COLUMN "transactionID" TYPE INTEGER,
    ALTER COLUMN "certificateID" TYPE INTEGER,
    ALTER COLUMN "requestedBy" TYPE INTEGER,
    ALTER COLUMN "tokenID" TYPE INTEGER,
    ALTER COLUMN "blockNum" TYPE INTEGER;

COMMIT;
