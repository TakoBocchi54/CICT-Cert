BEGIN;

-- Faculty-uploaded certificate designs. Rendering only: the certificate hash never includes the template.
CREATE TABLE IF NOT EXISTS certificate_template (
    "templateID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "name" VARCHAR(100) NOT NULL CHECK (btrim("name") <> ''),
    "image" BYTEA NOT NULL,
    "imageType" VARCHAR(20) NOT NULL CHECK ("imageType" IN ('image/png', 'image/jpeg')),
    "imageWidth" INTEGER NOT NULL CHECK ("imageWidth" > 0),
    "imageHeight" INTEGER NOT NULL CHECK ("imageHeight" > 0),
    "fields" JSONB NOT NULL,
    "createdBy" BIGINT NOT NULL REFERENCES cict_faculty ("facultyID"),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS certificate_template_signature (
    "signatureID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "templateID" BIGINT NOT NULL REFERENCES certificate_template ("templateID") ON DELETE CASCADE,
    "image" BYTEA NOT NULL,
    "imageType" VARCHAR(20) NOT NULL CHECK ("imageType" IN ('image/png', 'image/jpeg')),
    "imageWidth" INTEGER NOT NULL CHECK ("imageWidth" > 0),
    "imageHeight" INTEGER NOT NULL CHECK ("imageHeight" > 0)
);

-- NULL = built-in design.
ALTER TABLE seminar ADD COLUMN IF NOT EXISTS "templateID" BIGINT REFERENCES certificate_template ("templateID") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_seminar_template ON seminar ("templateID");
CREATE INDEX IF NOT EXISTS idx_template_signature_template ON certificate_template_signature ("templateID");
CREATE INDEX IF NOT EXISTS idx_template_created_by ON certificate_template ("createdBy");

COMMIT;
