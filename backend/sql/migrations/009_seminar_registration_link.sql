BEGIN;

-- Students register themselves through a per-seminar link. The random token (not the sequential ID) is the link,
-- and registration is open while now() < "registrationClosesAt"; NULL means closed. Venue is display only.
ALTER TABLE seminar
    ADD COLUMN "venue" VARCHAR(255) CHECK ("venue" IS NULL OR btrim("venue") <> ''),
    ADD COLUMN "registrationToken" UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    ADD COLUMN "registrationClosesAt" TIMESTAMPTZ;

COMMIT;
