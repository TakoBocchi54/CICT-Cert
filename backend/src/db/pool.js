import pg from "pg";
import "dotenv/config";

export const pool = new pg.Pool ({
    connectionString: process.env.DATABASE_URL,
});

// An idle connection that drops (database restart, network blip) is reported here; without a listener Node
// crashes the whole backend. The pool replaces the connection on its own.
pool.on("error", err => console.error("Idle database connection failed:", { code: err.code || "IDLE_CLIENT_ERROR" }));
