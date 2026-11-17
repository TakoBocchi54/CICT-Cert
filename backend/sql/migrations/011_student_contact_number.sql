BEGIN;

-- Contact number collected on the seminar registration page (digits with an optional leading +).
-- Existing students and accounts created by faculty keep NULL until they register through a link.
ALTER TABLE student ADD COLUMN "contactNumber" VARCHAR(16);

COMMIT;
