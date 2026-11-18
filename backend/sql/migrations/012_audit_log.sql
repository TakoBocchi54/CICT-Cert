BEGIN;

-- Append-only record of successful faculty changes (written by middleware/auditLog.js). No foreign key to
-- cict_faculty, so history survives an account being removed.
CREATE TABLE audit_log (
    "auditID" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "actorFacultyID" INTEGER,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "ids" JSONB NOT NULL DEFAULT '[]',
    "details" JSONB NOT NULL DEFAULT '{}'
);

CREATE FUNCTION protect_audit_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'The audit log is append-only';
END;
$$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION protect_audit_log();

COMMIT;
