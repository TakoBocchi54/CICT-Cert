CREATE TABLE users (
    "userID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "email" VARCHAR(255) NOT NULL UNIQUE,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(20) NOT NULL
        CHECK ("role" IN ('FACULTY', 'STUDENT')),
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "firstName" VARCHAR(255) NOT NULL,
    "lastName" VARCHAR(255) NOT NULL,
    "program" VARCHAR(255) NOT NULL,
    CONSTRAINT fk_student_user
        FOREIGN KEY ("userID")
        REFERENCES users ("userID")
);

CREATE TABLE student_wallet (
    "walletID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "studentID" BIGINT NOT NULL UNIQUE,
    "studentWalletAddress" VARCHAR(42) NOT NULL UNIQUE,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_student_wallet_student
        FOREIGN KEY ("studentID")
        REFERENCES student ("studentID")
);

CREATE TABLE issuer_wallet (
    "issuerWalletID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "issuerWalletAddress" VARCHAR(42) NOT NULL UNIQUE,
    "label" VARCHAR(100) NOT NULL,
    "network" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_issuer_wallet_user
        FOREIGN KEY ("userID")
        REFERENCES users ("userID")
);

CREATE TABLE certificate (
    "certificateID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "certificateNO" BIGINT NOT NULL UNIQUE,
    "studentID" BIGINT NOT NULL,
    "studentWalletID" BIGINT NOT NULL,
    "authorizedBy" BIGINT NOT NULL,
    "issuerWalletID" BIGINT NOT NULL,
    "recipientName" VARCHAR(255) NOT NULL,
    "seminarTitle" VARCHAR(255) NOT NULL,
    "seminarDate" DATE NOT NULL,
    "certificateHash" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL
        CHECK ("status" IN ('PENDING', 'ISSUED', 'REVOKED', 'FAILED')),
    "issuedAt" TIMESTAMP,
    "revokedAt" TIMESTAMP,
    CONSTRAINT fk_certificate_student
        FOREIGN KEY ("studentID")
        REFERENCES student ("studentID"),
    CONSTRAINT fk_certificate_wallet
        FOREIGN KEY ("studentWalletID")
        REFERENCES student_wallet ("walletID"),
    CONSTRAINT fk_certificate_faculty
        FOREIGN KEY ("authorizedBy")
        REFERENCES cict_faculty ("facultyID"),
    CONSTRAINT fk_certificate_issuer_wallet
        FOREIGN KEY ("issuerWalletID")
        REFERENCES issuer_wallet ("issuerWalletID")
);

ALTER TABLE student_wallet
ADD CONSTRAINT uq_student_wallet_pair
UNIQUE ("studentID", "walletID");

ALTER TABLE certificate
ADD CONSTRAINT fk_certificate_student_wallet_match
FOREIGN KEY ("studentID", "studentWalletID")
REFERENCES student_wallet ("studentID", "walletID");

CREATE TABLE blockchain_record (
    "transactionID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "certificateID" BIGINT NOT NULL,
    "transactionType" VARCHAR(10) NOT NULL
        CHECK ("transactionType" IN ('MINT', 'REVOKE')),
    "transactionHash" VARCHAR(100) NOT NULL UNIQUE,
    "tokenID" BIGINT,
    "contractAddress" VARCHAR(42),
    "fromAddress" VARCHAR(42),
    "toAddress" VARCHAR(42),
    "network" VARCHAR(50) NOT NULL,
    "blockNum" BIGINT,
    "transactionStatus" VARCHAR(20) NOT NULL
        CHECK ("transactionStatus" IN ('PENDING', 'CONFIRMED', 'FAILED')),
    "issuedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP,
    CONSTRAINT fk_blockchain_certificate
        FOREIGN KEY ("certificateID")
        REFERENCES certificate ("certificateID")
);