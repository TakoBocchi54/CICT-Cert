// An error a route answers with its own status and message; anything else is a 500.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A PostgreSQL INTEGER id (1 to 2^31 - 1), as a string or a number.
export const isId = value => /^[1-9]\d{0,9}$/.test(String(value)) && BigInt(value) <= 2147483647n;

// A real calendar date written YYYY-MM-DD (rejects 2026-02-30 and year 0000).
export const isIsoDate = value => typeof value === "string" && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
