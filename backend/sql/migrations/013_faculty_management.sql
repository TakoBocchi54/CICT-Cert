BEGIN;

-- Faculty accounts are switched off, never deleted: seminars, certificates and the audit log keep pointing at them.
-- NULL = active. temporaryPassword is true after an administrator generated the password, until its owner sets one.
ALTER TABLE cict_faculty
    ADD COLUMN "deactivatedAt" TIMESTAMPTZ,
    ADD COLUMN "temporaryPassword" BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
