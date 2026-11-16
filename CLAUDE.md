# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CICT-Cert is a seminar certificate system for CICT, University of Batangas. Faculty register students for seminars, import final attendance, and issue soulbound ERC-5484 certificates on **Polygon Amoy (chain ID 80002)**. Students sign in with Google through Web3Auth (embedded wallet); the wallet-link signature is their one-time consent. Certificates are issued in Merkle batches (one transaction per batch) and revoked in batches through a sparse Merkle tree root. Students download a PDF and a Merkle proof file. Anyone can verify a certificate publicly.

`PROJECT_PROGRESS.md` (root) is the detailed handoff: settled decisions, completed work, what's unfinished, and the exact next step. `backend/README.md` is the authoritative spec for the database, CSV formats, API endpoints, and the issuance/verification invariants. Read the relevant section before changing those flows.

## Layout and commands

There are three independent npm projects with no root package.json. Run commands inside the subproject. The shell is Windows; PROJECT_PROGRESS uses `npm.cmd`/`npx.cmd` in PowerShell.

**backend/** (Express 5, ES modules, `pg`, `viem`, `jose`). Port 5000 by default.
- `npm run dev` runs nodemon; `npm start`.
- `npm test` runs `node --test` over all `*.test.js` files.
- Single test file: `node --test src/routes/seminars.test.js`.
- `node scripts/createFaculty.js ...` / `node scripts/createStudent.js <email> "<Full Name>" "<Program>"` create accounts manually.
- `node scripts/migrateSeminarSchema.js "<original TZ>"` is a one-time migration of a legacy DB. See backend/README before running it.

**frontend/** (React 19, Vite, Tailwind v4, React Query, wagmi/viem, `@web3auth/modal`).
- `npm run dev`. Vite proxies `/api` to `http://localhost:5000`.
- `npm run build`, `npm run lint`.
- Tests (plain node:test, no runner configured): `node --test src/lib/certificatePdf.test.js src/lib/certificateVerificationUrl.test.js src/lib/registrationLink.test.js`.

**smart_contract/** (Hardhat 3, TypeScript, ethers v6, mocha). It has its own `CLAUDE.md`/`AGENTS.md` and a `hardhat` skill. Use them when working there.
- `npx hardhat build`, `npx tsc --noEmit`, `npx hardhat test mocha`.
- Deploy (real Amoy, spends POL): `npx hardhat run scripts/deploy.ts --network amoy`. The deployer becomes the immutable `issuer`.

## Testing notes

- Account/session route tests use mocked DB responses.
- Seminar, attendance, certificate, issuance, and schema tests need a real PostgreSQL. Each one creates a temporary `cict_*_test_<uuid>` schema, loads `sql/schema.sql`, swaps `pool.query`/`pool.connect` to point at it, and drops it afterward. They **skip unless `DATABASE_URL`'s host is localhost/127.0.0.1/[::1]**. They intentionally refuse remote databases, so never weaken that guard.
- Blockchain-dependent tests spin up a local JSON-RPC fixture server and set `AMOY_RPC_URL` to it. No real Amoy calls are made.
- Tests mount individual routers onto a fresh Express app and sign session cookies with a test `SESSION_SECRET`. Follow that pattern for new route tests.

## Architecture

**Request flow.** The frontend calls relative `/api/...` paths through `src/lib/api.js` (`credentials: "include"`). In dev, Vite proxies these. In production, `frontend/vercel.json` rewrites them to the Render backend (`cict-cert-backend.onrender.com`). The DB is Supabase Postgres in production. Every router in `backend/src/routes/` is mounted under `/api` in `src/app.js`.

**Auth.** Both roles get the same `cict_session` HS256 JWT cookie (8h, `src/utils/session.js`).
- Faculty log in with email/password (bcrypt).
- Students log in with a Web3Auth ID token, which the backend verifies against the JWKS in `src/services/web3auth.js`. They then link a wallet by signing a server message (`walletConsentMessage`); the message and signature are stored on `student_wallet` as their standing consent.
- `middleware/requireFaculty.js` and `requireStudent.js` gate routes. `requireCanIssue` re-reads `cict_faculty.canIssue` from the DB on every request, so permission changes take effect immediately.

**Certificate lifecycle** (DB tables are in `backend/sql/schema.sql`):
1. Faculty create a `seminar` with a registration deadline (`registrationClosesAt`, NULL = closed) and share its link `/register/<registrationToken>`. Students sign in with Google there (`routes/registration.js`, public, ID-token verified); this creates their `users`/`student` rows if missing (or saves their edited name/program) and an unattended `seminar_registration` row. It is the only non-faculty way to create a student account; the login page still 403s unregistered accounts.
2. Faculty tick attendance per registrant (`PATCH .../registrations/:studentID`) and remove non-students (`DELETE`). Fallback until cutover: the Students tab (`routes/students.js`, `services/students.js`) and the attendance CSV import (preview → confirm against **all** student accounts, with "did you mean" `aliases`; confirm must echo the server's `previewHash`, stale → 409; it replaces the whole attendance list).
3. A `canIssue` faculty member runs "prepare". This reads `issuer()` from the contract and creates PENDING certificates with sequence-generated numbers and snapshots of the name, title, and date.
4. Review: faculty see every printed name and may correct one before issuance (`PATCH .../certificates/:certificateID`, `correctRecipientName` in `services/revocation.js`; clears the hash). Students see certificates only once issued (`GET /student/certificates` in `routes/certificateApprovals.js`). There is no per-certificate signature.
5. Faculty issue the seminar (`issueSeminarBatch` in `services/issuance.js`): up to `ISSUE_BATCH_SIZE` (default 100) eligible certificates per transaction, each transaction its own batch. The backend computes the hashes and the Merkle root (`utils/merkle.js`), simulates `issueBatch`, signs with `ISSUER_PRIVATE_KEY`, and **commits the signed tx + hash (one `blockchain_record` row per certificate, shared hash) before broadcasting**. It then waits for the receipt block to be past the RPC's `finalized` tag before marking ISSUED. "Check transaction" reconciles the batch or rebroadcasts the same signed payload.
6. Revocation (`revokeCertificates` in `services/revocation.js`, up to 200 per transaction) requires the on-chain `revocationRoot` to equal the SMT root of the DB's revoked token IDs, then signs `revokeBatch` with the new root. Tokens are not burned.
7. Public `GET /api/certificates/verify/:certHash` (`services/certificates.js`) rebuilds the inclusion and revocation proofs from the DB and calls the contract's `verify`. It returns the DB snapshot only when that snapshot re-hashes to the hash (`detailsStatus`). Students can download the inclusion proof (`GET /api/student/certificates/:certificateID/proof`).

**Invariants to preserve:**
- **Canonical certificate hash.** It is defined once in `backend/src/utils/certificateConsent.js`: Keccak-256 of JSON with a fixed field order (version 2, `burnAuth: "Neither"`). Issuance, the proof file and verification must reuse it and must never re-encode independently.
- **Merkle encoding.** Defined once in `backend/src/utils/merkle.js` and checked against the contract by `smart_contract/test/CICTCertificate.ts`. Batch leaf = `keccak256(abi.encode(index, certHash))`, leaves in certificate-number order, sorted-pair hashing. SMT depth 64 keyed by token ID. Change both sides together.
- **Locking.** Attendance import and ticking, registrant removal, prepare, name correction, issuance and revocation all take `SELECT ... FROM seminar ... FOR UPDATE` on the seminar row (student self-registration takes `FOR SHARE`) (revocation locks several in ID order). Issuance and revocation also take `pg_advisory_xact_lock` keyed on `amoy:<issuerAddress>` to serialize the wallet nonce, and allow only one pending issuer transaction.
- **Uncertain transactions stay pending.** Never mark a tx FAILED because a request timed out. Only a finalized revert marks it failed (for a batch, every certificate in it).
- **Issued certificates are immutable.** A correction means revoke plus a new certificate number. There is at most one non-revoked certificate per registration.
- **Certificate numbers** come from a DB sequence. Never use `MAX + 1`.
- **Schema changes** need both an edit to `sql/schema.sql` (fresh installs) and a new numbered file in `sql/migrations/`. Register the migration in `scripts/migrateSeminarSchema.js` and document it in backend/README.

**Contract** (`smart_contract/contracts/CICTCertificate.sol`): ERC-721 + ERC-5484 (`burnAuth` = Neither). It has a single immutable `issuer`; `issueBatch(seminarId, root, recipients, certHashes)` and `revokeBatch(newRoot, tokenIds)` are issuer-only; `verify(tokenId, certHash, merkleProof, smtBitmap, smtSiblings)` is a public view. Each token stores only its batch ID; batch roots are immutable; one revocation root. Transfers and approvals revert (soulbound). `contracts/bench/` and `test/GasBenchmark.ts` are benchmark-only. The backend uses a committed copy of the ABI at `backend/src/contracts/CICTCertificate.abi.json`, so update it when the contract interface changes.

**Frontend.** Routing and session restore (`/api/auth/me`) live in `src/App.jsx`. Server data is fetched with React Query. Shared visual components are in `src/components/design-system/` (reuse them). Seminars are created in the Seminars tab (`NewSeminarDialog.jsx`); the Issue wizard (`IssuancePage.jsx`) starts by picking a seminar, then Attendance (`Registrants.jsx`, name search + checkboxes, CSV import as fallback). Its Review/Issue steps are `CertificatePreparation.jsx` (`mode="review" | "issue"`); batch revoke is in `RegistryPage.jsx`. PDF export (`src/lib/certificatePdf.js`) rasterizes `Certificate.jsx` with `html-to-image` and embeds it with `pdf-lib` at a fixed 1.414:1 aspect ratio. The QR encodes `<current origin>/verify?id=<hash>`. `/verify` and `/register/:token` (`RegisterPage.jsx`) are public and skip the session gate.

## Conventions (from PROJECT_PROGRESS)

- Keep frontend/backend in JavaScript and the Hardhat project in TypeScript. Use Tailwind for new UI.
- Make small, incremental changes. Reuse existing helpers and components. Avoid new dependencies, abstractions, speculative schema fields, and features.
- Match students by normalized Google email only, never by name or student number. Don't store section or school student number.
- `ISSUER_PRIVATE_KEY` is backend-only and must never go into `VITE_*` variables. Env variable names are listed in each subproject's `.env.example`.
