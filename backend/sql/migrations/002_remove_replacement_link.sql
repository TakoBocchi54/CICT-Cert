-- Databases that already applied 001 run this migration once.
BEGIN;

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

-- Dropping this column also removes its foreign key and index.
ALTER TABLE certificate DROP COLUMN "replacesCertificateID";

COMMIT;
