BEGIN;

-- In-app notifications are derived from existing timestamps; this is each account's "read up to" mark.
ALTER TABLE users ADD COLUMN "notificationsSeenAt" TIMESTAMPTZ;
-- Set when the issuer balance is first seen below the low-balance threshold (the notification's time);
-- cleared once the balance is back above it, so the next drop is a new notification.
ALTER TABLE issuer_wallet ADD COLUMN "lowBalanceSince" TIMESTAMPTZ;

COMMIT;
