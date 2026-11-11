# CICT-Cert: Project context, progress, and next steps

Updated: **12 November 2026 (Asia/Manila)**: student accounts are now separate from seminars (Students tab; attendance matched against all accounts, with a guarded "register them?" prompt), and the Seminars tab is a 4-step wizard. Earlier: revocation, replacement, optional auto-issuance, real faculty dashboard data and a test-data reset script. See section 10 for where to resume.

This is a handoff for continuing the project. It records the agreed scope, the implementation currently in the workspace, checks completed during development, known gaps, and the recommended next task. Working locally does not mean the same changes are already deployed.

## 1. Project context

CICT-Cert is a seminar certificate system for the College of Information and Communications Technology at the University of Batangas. Faculty register students, confirm seminar attendance, and issue blockchain-backed certificates. Students sign in through their Google account, connect an embedded wallet, approve receipt of their certificates, and download them as PDFs. Anyone can verify a certificate without logging in.

The blockchain provides a persistent issuance and revocation record. PostgreSQL stores accounts, seminar registrations, attendance, certificate details, recipient consent, and transaction history. The PDF is the presentation of a certificate; verification reads the current blockchain status.

### Agreed technology

| Part | Current approach |
| --- | --- |
| Frontend | React, Vite, JavaScript, Tailwind CSS, existing shared design-system components |
| Backend | Node.js, Express, JavaScript ES modules, PostgreSQL through `pg` |
| Student identity/wallet | Google sign-in through Web3Auth, embedded wallet, backend identity-token verification |
| Faculty identity | Email/password with bcrypt and a server-issued session cookie |
| Blockchain client | `viem` in the backend |
| Contract tooling | Hardhat 3, TypeScript configuration/scripts/tests, ethers |
| Contract | Solidity, OpenZeppelin ERC-721 base, ERC-5484 interface, non-transferable certificates |
| Network | Polygon Amoy testnet, chain ID `80002`, test POL for issuer gas |
| PDF | `html-to-image` and `pdf-lib`, using the existing certificate design |
| QR | `qrcode-generator`, linking to the public verifier |
| Previously reported deployment | Vercel frontend, Render backend, Supabase PostgreSQL; latest deployment state has not been checked |

### Working preferences

- Keep changes small and understandable. Reuse existing helpers and components.
- Use Tailwind for new UI work. Broader UI/UX polishing was deferred.
- Keep the frontend/backend in JavaScript and the initialized Hardhat project in TypeScript.
- Correct mistaken assumptions instead of agreeing automatically.
- Work incrementally and explain the next step. The user initially made edits manually, then authorized direct implementation to move faster.
- Avoid unnecessary dependencies, abstractions, schema fields, and speculative features.

## 2. Decisions already settled

- Use **ERC-5484**, replacing the earlier ERC-5192 idea.
- Certificates are soulbound: students cannot transfer them or approve transfers.
- Burn authorization is **IssuerOnly**. Only the configured issuer may revoke a token.
- The contract has one immutable issuer address, without ownership transfer or multiple issuer roles.
- Keep Solidity source pragma `^0.8.24`. This is a compatible compiler range, not an exact compiler pin. The current Hardhat configuration selects compiler **0.8.34** and EVM target `cancun`.
- Use the guide `blockchain-smart-contract-guide.md` as background, adjusted to the actual repository and later decisions. Its sample counts, paths, optional functions, and older recommendations are not proof of implemented behavior.
- Students are **accounts**, registered in the Students tab (bulk CSV or one at a time) or from the attendance preview; registering a Google account is what lets a student sign in. There is no per-seminar sign-up list. After each seminar, import its final attendance list, which is matched against all student accounts (12 November; replaces "import seminar registrations before the seminar").
- Attendance/eligibility calculation is outside scope. The final attendance CSV determines recipients.
- Match registrations and attendance using the **Google account email**. Do not match using names or school student numbers.
- Students without a linked wallet can remain pending. They are issued certificates only after wallet setup, certificate-specific approval, and faculty confirmation.
- Issuance is never triggered by login or wallet connection. It is triggered by a faculty button, or, with `AUTO_ISSUE=true` (implemented 11 November, untested on Amoy), by a background worker after the student's certificate-specific approval. See `backend/README.md`.
- Certificate details are recipient name, seminar title, seminar date, and an automatically generated numeric certificate number.
- Use the portal/PDF presentation approach. Rich certificate artwork/metadata in external wallets is deferred.
- A corrected issued certificate requires revoking the original and issuing a new certificate number. The explicit replacement workflow is implemented (10 November).
- Corrected facts (recipient name, seminar title, seminar date) are **entered by faculty on the replacement** and saved only on that new certificate. Student profiles and seminar records are not edited by this workflow (chosen over adding profile/seminar editing).
- The revocation reason is stored in PostgreSQL (`blockchain_record.revocationReason`), not on-chain.
- Retain certificate snapshots of recipient name and seminar details, even though the certificate also references its seminar. They preserve the facts approved and issued at that time.
- Keep `seminar.createdBy`; it comes from the signed-in faculty account.
- Do not store section or school student number for this workflow.
- Do not keep `certificate.createdAt`, `replacesCertificateID`, or a database `failureReason` field. Keep `certificate.issuedAt` and `revokedAt`.
- Participant counts may be below or above 100. There is no hard-coded 100-person limit; CSV imports have a size limit.

## 3. Intended workflow and what currently works

1. **Faculty creates a seminar** with title and date. The backend records the faculty creator.
2. **Faculty registers students** in the Students tab (bulk CSV or one at a time). This creates the account their Google sign-in needs.
3. **Students sign in with the registered Google account** and link their embedded wallet by signing a server-provided message.
4. **Faculty imports final attendance**, reviews matches (registering any unknown attendees from the preview, with typo suggestions), then confirms the full list. Confirming creates the seminar's attendance rows.
5. **Faculty prepares pending certificates.** Each attendee receives a numbered certificate snapshot; missing wallets remain pending.
6. **Students review and approve their individual certificates** with their linked wallet. This approval is distinct from wallet linking.
7. **Faculty reviews and confirms issuance on Amoy.** The backend validates, signs, submits, and reconciles transactions.
8. **Students see issued certificates** on the dashboard and in their collection.
9. **Students download a certificate PDF** containing the design, certificate hash, and verification QR.
10. **Anyone verifies publicly**, using the QR/hash, or reads the contract through the block explorer.
11. **Faculty revokes an issued certificate** on the Revocations page by certificate number, with a required reason. The backend signs, broadcasts and reconciles `revoke(tokenId)` and marks the certificate `REVOKED` only after finality.
12. **Faculty prepares a replacement** for a revoked certificate with corrected facts and a new number. The student approves it, and faculty issue it through step 7.

The user confirmed successful local registration/attendance work, student-related flows, real Amoy issuance, and PDF download during development. Public metadata and the latest layout fixes were also checked with isolated browser tests. On 10 November the user confirmed a real Amoy revocation through the new portal flow (certificate No. 1, reason "Revocation test"). The replacement flow has not yet been tried manually.

## 4. Completed progress

### Authentication, sessions, and accounts

- Faculty login validates a stored bcrypt password hash and returns a generic invalid-credentials response.
- Faculty login is rate-limited. Responses do not reveal whether an email exists.
- Students sign in through Web3Auth. The backend verifies the identity token's signature, issuer, audience, expiry, and issue time.
- A student must already be registered in the database to establish a student session; Google sign-in alone does not create an approved student account.
- The backend issues an HttpOnly session cookie, expiring after eight hours. Production cookies use `secure`; current SameSite setting is `lax`.
- Session restoration reads `/api/auth/me` and checks the current role/account against the database.
- Role checks protect faculty and student routes. Issuance requires current faculty `canIssue` permission.
- Wallet linking uses a signed server challenge bound to the student, expiring after five minutes. The backend verifies the wallet signature before storing the link.
- Wallet links cannot silently replace an existing link or reuse another student's wallet.
- Student responses use the CSV's `fullName` consistently.
- Faculty account viewing, first/last name updates, and password changes are implemented. Password changes check the existing password, reject invalid new passwords, and handle concurrent changes.
- Faculty creation is available through `backend/scripts/createFaculty.js`; the Students tab (or the attendance preview) creates student accounts.

Earlier local faculty login troubleshooting established that the local and deployed databases can contain different accounts. A successful deployed login does not prove the same account exists locally. Passwords and private credentials must not be copied into this handoff.

### Database

Current tables:

| Table | Purpose |
| --- | --- |
| `users` | Email, role, optional student/password-backed faculty authentication data |
| `student` | Full name and program, linked to a user |
| `cict_faculty` | Faculty profile and issuance permission |
| `student_wallet` | A student's linked wallet |
| `issuer_wallet` | Issuer address, network, label, active state |
| `seminar` | Title, date, creator, creation time |
| `seminar_registration` | Student/seminar join, attendance flag, registration time |
| `certificate` | Numeric number, registration links, immutable snapshots, approval evidence, status and issuance/revocation times |
| `blockchain_record` | Mint/revoke attempts, transaction state, signed payload, token and block details, requesting faculty and revocation reason |

Safeguards implemented:

- Composite registration key prevents duplicate student registration for the same seminar.
- Certificate registration/wallet foreign keys prevent mismatched student links.
- Numeric certificate numbers use a database sequence. Gaps are normal; numbers are never generated with `MAX + 1`.
- One non-revoked certificate is allowed per student/seminar registration.
- Hashes are unique and normalized; wallet uniqueness ignores hexadecimal letter case.
- Issued certificate facts are protected against editing by a database trigger.
- Signed draft facts cannot change while preserving old consent.
- Pending/failed certificates have no successful `issuedAt`; issued/revoked certificates must have their required evidence and timestamps.
- Only one unresolved transaction attempt is allowed per certificate.
- Transactional imports and locking protect against partial updates and concurrent changes.
- Event timestamps use `TIMESTAMPTZ`; seminar dates use `DATE`.

Migration files:

1. `001_seminar_issuance.sql`: seminar/registration and certificate safeguards, full student names, related schema changes.
2. `002_remove_replacement_link.sql`: removes the optional replacement link.
3. `003_remove_failure_reason.sql`: removes stored failure explanations.
4. `004_remove_certificate_created_at.sql`: removes certificate preparation time.
5. `005_signed_transaction.sql`: adds the signed transaction payload for safe retry/reconciliation.

Migration 005 was applied locally during this work. Production migration status is unverified. `schema.sql` is for a new, empty database only. The migration runner applies 001 through 005 in order and is not a general repeatable migration system. Check which migrations are already applied before running anything. Existing legacy certificate history may need a reviewed backfill; do not invent consent or rerun the initial migration over issued records.

### Student accounts and attendance

Rewritten on 12 November: see "Done (12 November): student accounts separate from seminars" below and `backend/README.md`. The CSV rules here still apply to the Students tab upload.

- Faculty can create seminars, list them, and view their attendance rows.
- Student registration accepts UTF-8 CSV with quoted values, escaped quotes, BOM, and CRLF support, up to 1 MB.
- Required registration fields are `full_name`, `program`, and `google_account`. Extra columns are ignored.
- Emails are trimmed and lowercased; Gmail dots/plus tags are preserved, and Google Workspace domains are allowed.
- Identical duplicate emails count once. Conflicting profiles for the same email within a file reject the import.
- Existing names/programs/wallets and attendance are preserved when reusing accounts.
- Reimports are idempotent. Faculty email conflicts and incomplete student accounts reject the entire import.
- Final attendance matches Google emails to all student accounts; unregistered and faculty emails block the save until resolved.
- Preview does not write. Confirmation requires the reviewed CSV and its server-generated preview hash.
- Changed CSV/aliases/accounts/attendance/certificate state requires a fresh preview rather than silently saving stale results.
- The confirmed attendance file replaces the full attendance list: omitted students become absent.
- Empty lists and unmatched emails are rejected. Attendance import itself never creates student accounts (the preview's prompt calls the Students endpoint).
- Issued certificates and unresolved mint attempts prevent clearing relevant attendance.

Registration example:

```csv
full_name,section,program,google_account
Juan Dela Cruz,CS 3-1,BS Computer Science,juan.delacruz@gmail.com
```

Attendance example, using the minimum required column:

```csv
google_account
juan.delacruz@gmail.com
```

Attendance exports may also contain full name, section, program, and student ID; those extra columns are ignored.

### Pending certificates and recipient approval

- Preparation reads the on-chain issuer and checks the configured network/issuer availability.
- Faculty must have issuance permission to prepare certificates.
- Preparation creates one numbered pending certificate per attendee, including attendees without wallets.
- Repeating preparation preserves existing numbers, snapshots, and signatures.
- Students can only access their own certificate approvals.
- The review shows the certificate facts, issuer/recipient wallets, and issuer-only burn policy.
- Approval requests are server-signed, bound to the student/certificate/domain, and expire after ten minutes.
- The backend verifies the linked wallet's signature and rechecks attendance and facts on submission.
- Exact message, signature, and approval time are saved. Approval does not send a blockchain transaction.
- A student who connects a wallet later can approve the existing pending certificate number.
- Changed certificate facts require fresh approval. Another student's wallet/signature cannot approve the record.

### Smart contract and Amoy deployment

- `CICTCertificate.sol` and `IERC5484.sol` are implemented.
- Issuer-only `issue(to, certHash)` rejects zero recipient addresses, empty hashes, and already-used hashes.
- Transfers and transfer approvals revert with `Soulbound()`.
- `revoke(tokenId)` is issuer-only, burns the token, and retains historical verification data.
- The same hash cannot be issued again, including after revocation.
- `verify(certHash)` distinguishes unknown, valid, and revoked certificates.
- `recordOf(tokenId)`, `burnAuth(tokenId)`, `issuer()`, and interface detection are available.
- Contract tests cover authorized issuance/revocation, invalid input, verification, blocked transfers/approvals, and interfaces.
- Hardhat builds generate artifacts and TypeScript definitions. Generated `artifacts`, `cache`, and types are rebuilt locally rather than committed as source. `npm install` installs dependencies; it does not replace `hardhat build`.
- Ethers was pinned to **6.16.0** after an installed declaration/type-checking issue. A successful `tsc --noEmit` prints no output.
- The contract was deployed to Amoy and its source made readable through the explorer. The user checked that `issuer()` matches their issuer wallet.
- The backend includes a contract ABI and reads this deployment.

Public configuration recorded during development:

```text
Network: Polygon Amoy
Chain ID: 80002
Contract: 0x0a6b09e3BA4465741a5F73A398b2B39fbB37A3ac
Issuer:   0x2E2d4AbB50f2b65f8DBB7d1f55636293E6c447C9
```

Explorer: <https://amoy.polygonscan.com/address/0x0a6b09e3BA4465741a5F73A398b2B39fbB37A3ac#readContract>

These addresses are public identifiers, not secrets. Reconfirm the configured deployment if the contract is ever redeployed. Do not assume a historical wallet balance is still available.

### Backend issuance

- Faculty can review and confirm eligible approved certificates for Amoy issuance.
- Before signing, the backend rechecks attendance, permission, linked wallet, exact recipient approval, canonical certificate hash, network, and issuer-key match.
- It simulates minting, prepares gas/fees/nonce, and checks the issuer's test POL balance.
- It stores the signed transaction and hash before broadcasting, so an uncertain response can resume the same transaction.
- Manual **Check transaction** reconciles or resubmits an existing signed attempt; it cannot sign a new mint.
- Locks prevent simultaneous backend requests from allocating conflicting issuer nonces across seminars.
- Confirmation checks receipt success, canonical block, finalized height, expected sender/contract, the `Issued` event, and the contract's verification result.
- Only confirmed/finalized matching issuance updates token ID, block number, transaction state, and certificate `issuedAt` together.
- A finalized revert can be retried while preserving certificate number and approval. A timeout alone does not mean failure.
- The frontend processes a selected batch sequentially and displays state, token IDs, and explorer transaction links.
- A real issuance on Amoy was reported working by the user.
- The local backend RPC was changed from a timing-out dRPC free endpoint to PublicNode: `https://polygon-amoy-bor-rpc.publicnode.com`. RPC availability is external and may change.

### Student dashboard, collection, PDF, and recent UI fixes

- Student dashboard and collection use saved certificate data and confirmed mint details, not generated sample certificates.
- Pending approvals are separate from issued certificate displays.
- Issued certificates show recipient, seminar, numeric credential number, status/block information, and the complete certificate hash.
- Selecting a certificate or **Download PDF** opens the shared download preview.
- PDF generation exports the certificate itself without a browser print dialog or surrounding portal content.
- Page width is 297 mm and the existing design ratio is 1.414:1, giving approximately 210.04 mm height. This derives from the implemented template, not an independently supplied physical design file.
- The template is rendered at fixed width 1122 px and pixel ratio 3, producing an approximately 3366 x 2379 image in a one-page PDF.
- The QR sits at the bottom right, directly beside the seal/logo, and opens `/verify?id=<certificateHash>` on the frontend origin.
- The full certificate hash is printed along the bottom.
- The exported PDF has **no clickable link annotations**. The earlier link covering the whole page was removed at the user's request.
- The hover status bar was made shorter, with smaller text/icon, so **Verified on Polygon** and the block number no longer cover the certificate hash.
- PDF filenames follow `CICT-Certificate-<certificateNo>.pdf`.
- No PDF/QR is uploaded to an external rendering service. The PDF design is embedded as an image; its text is not selectable.
- Previously downloaded PDFs do not change when the design changes. Download again for the new hash layout or removal of the full-page link.

### Public verification

- Public `/verify?id=<hash>` works without a login, including when session restoration returns no session.
- The frontend validates hash format and calls the backend's public verification endpoint.
- Backend blockchain errors return an unavailable response rather than trusting local database status.
- Public results show current status, token ID, recipient wallet, issuer wallet, and issue/revocation times.
- Recipient name, seminar title/date, and certificate number are shown only when saved details reproduce the on-chain hash with the correct recipient, issuer, contract, and chain.
- Missing details, changed details, and database outages are explained separately from blockchain status.
- No email, approval signature/message, signed transaction, or private key is exposed through this public response.
- Switching browser tabs does not automatically refetch verification; a deliberate query/retry can check again.
- A revoked chain result takes precedence over an outdated local issued status.

### Faculty revocation (10 November)

- `backend/src/services/revocation.js`, `backend/src/routes/revocations.js` (mounted in `app.js`), and `backend/src/routes/revocation.test.js`.
- `GET /api/faculty/certificates/:certificateNo`: any live faculty account. Returns facts, status, token ID, wallet, mint transaction, the latest revocation attempt (status, hash, reason), attendance and any replacement. Internal IDs are not returned.
- `POST /api/faculty/certificates/:certificateNo/revoke` with `{ reason }` (1–500 characters, trimmed): requires current `canIssue`. `POST .../revocation/check` only reconciles or rebroadcasts the saved attempt.
- Only `ISSUED` certificates with a confirmed mint from the configured contract can be revoked. Before signing, the backend checks that `verify()` shows the certificate Valid under that token.
- It uses the same safeguards as issuance. Shared helpers were extracted from `services/issuance.js`:
  - `lockIssuer` (advisory lock, outstanding-transaction check, `canIssue`, key match)
  - `signIssuerCall` (simulation, gas/fee preparation, balance check, signing)
  - `finalizedReceipt` (payload validation, rebroadcast, finality and canonical block check)
- Mint and revoke share one issuer lock, so a pending mint blocks a revoke and vice versa. Minting behavior is unchanged apart from two more generic error messages.
- The `REVOKE` record stores the signed payload, reason, `requestedBy`, token ID and recipient before broadcast.
- `REVOKED` and the on-chain `revokedAt` are written together only after the finalized receipt has the matching `Revoked` event and `verify()` reports Revoked.
- A finalized revert marks only the attempt `FAILED`; the certificate stays `ISSUED` and can be retried. Uncertain broadcasts stay pending.
- The attendance import already treated any pending transaction (including `REVOKE`) as blocking attendance removal, so no change was needed there.
- The live-faculty check was moved from `seminars.js` into `requireActiveFaculty` in `middleware/requireFaculty.js` and is reused by both routers.
- Frontend: `RevocationPage.jsx` was rewritten against these endpoints using React Query and the design-system components:
  - numeric lookup with not-found and invalid-input states
  - details card with mint, revocation and verification links
  - a confirmation dialog with a required reason, labelled "Reason (saved in CICT records, not on-chain)"
  - pending, reverted and uncertain transaction states, with **Check transaction**
- `App.jsx` no longer has the fake `handleRevoke`. `certificates` is now a constant `INITIAL_CERTS`, still feeding the unconnected dashboard summaries (Priority 3).

### Correction by replacement (10 November)

- `POST /api/faculty/certificates/:certificateNo/replacement` with `{ recipientName, seminarTitle, seminarDate }`: requires current `canIssue` and returns 201.
- Rules:
  - the original must be `REVOKED`
  - the registration must still be attended
  - no other non-revoked certificate may exist for the registration (one replacement at a time)
- Text fields are 1–255 characters with no control characters, and the date is a valid `YYYY-MM-DD`, using the same rules as seminar creation.
- It creates a new `PENDING` certificate with a new sequence number for the same registration, the student's currently linked wallet and the corrected facts. No transaction is sent.
- The student then approves it, and faculty issue it through the normal seminar issuance flow. Approval and issuance only read the certificate's own snapshot, so they needed no changes.
- There is no stored replacement link. The lookup derives `replacement` (number and status) from the registration's current non-revoked certificate.
- Issuer-wallet registration was extracted into `ensureIssuerWallet` in `services/issuance.js` and is used by both preparation and replacement. Preparation behavior is unchanged.
- Frontend: on a revoked certificate's card, **Prepare replacement** opens a dialog prefilled from the revoked snapshot. If a replacement already exists, the card shows "Replaced by certificate No. X" with a button to open it.
- `backend/README.md` documents both revocation and replacement.

### Auto-issuance, dashboard data and fixes (11 November)

- **Optional auto-issuance** (`AUTO_ISSUE=true` in `backend/.env`; off by default). `backend/src/services/autoIssue.js` runs every 30 s (started from `server.js`) and right after each student approval (`routes/certificateApprovals.js`, not awaited). Each tick reconciles pending mints with `issueCertificate(..., allowNew=false)`, then issues approved certificates oldest first through the unchanged `issueCertificate` path.
  - The issuing faculty member is `certificate.authorizedBy` (the preparer), and their `canIssue` is rechecked on every mint.
  - It stops the tick after a new pending mint, a 503 or a pending issuer transaction. Any other certificate-level error skips that certificate.
  - `FAILED` (reverted) certificates are never retried automatically. Only 20 candidates are read per tick (`shortcut:` comment in the code).
  - Tests: `backend/src/services/autoIssue.test.js` (off switch, skipping an unauthorized preparer, a pending mint blocking new ones). **Not yet exercised on real Amoy.**
  - Student card text now reads "Approved; issuance in progress". The faculty Issue/Check buttons remain a fallback.
- **Faculty dashboard is connected.** `GET /api/faculty/certificates/summary` (any active faculty, registered before `:certificateNo` in `routes/revocations.js`) returns `issuedCount`, `revokedCount`, the 4 most recently issued and the 3 most recently revoked. `FacultyDashboardPage.jsx` fetches it itself. The Revoked number now shows the real total (it was capped at 3). Test added to `revocation.test.js`.
- **Share credential removed** (handler, prop and button). Verify link and PDF download cover sharing.
- **Sample-data cleanup in `App.jsx`:** removed `hashOf`, `hex`, `mk`, `Shell`, `INITIAL_CERTS` and the stale comment. `App.jsx` now lints clean.
- **Bug fix:** the seminars/issuance page showed multiple "Import final attendance" sections. `AttendanceImport` and `CertificatePreparation` had the same `key` as siblings. They now use `attendance-<id>` and `prepare-<id>`. Reproduced and verified in a throwaway jsdom harness, not in a real browser.
- **`backend/scripts/resetTestData.js`:** pre-deployment cleanup. Without `--yes` it prints the host and row counts and deletes nothing. With `--yes` it truncates `blockchain_record`, `certificate`, `seminar_registration`, `seminar`, `student_wallet` and `student` (restarting the certificate sequence) and deletes `STUDENT` users. It keeps faculty and `issuer_wallet`. Tested on a temporary schema only. It cannot touch anything already minted on-chain.

### Mockup integration (`design/CICT-Cert-Ui.html`)

The mockup is the original prototype; global CSS and the login, student, revocation and nav pages already match it. The user is integrating the rest **one step at a time, approving each feature first**. Not integrated by choice: the faculty issue wizard (our flow is CSV-driven), the fake "attendance processing" panel, the "upcoming seminars" list, the Verifications activity page (needs new logging), and the simulated QR scan. Share modal: not yet decided.

- [x] **Step 1, faculty dashboard hero.**
  - `GET /api/faculty/seminars` now also returns `readyCount` (attended, student-approved, `PENDING`/`FAILED`), `awaitingCount` (attended, prepared, not yet approved) and `issuedCount` per seminar.
  - Compact dark hero (no certificate preview) for the **latest seminar** (newest date, then newest created), showing its next step in workflow order: ready to issue ("Begin issuance"), awaiting student approval, attendance not imported, certificates to prepare, or all issued.
  - The button opens `/faculty/issue?seminar=<id>`, which preselects that seminar.
  - Beside it, an **Issuance progress** panel replaces the mockup's fake attendance-processing panel: the 3 latest seminars, sorted latest to oldest, each with an issued-of-attended bar and ready and awaiting counts.
  - Test added to `issuance.test.js`. Not yet viewed in a browser.
- [x] **Seminars tab as a wizard** (`pages/IssuancePage.jsx`; 5 steps on 11 November, **4 steps since 12 November** after the Registrations step moved to the Students tab), following the mockup's stage rail but mapped to the real flow: Seminar (pick or create), Registrations, Attendance, Approvals, Issue. The mockup's Eligibility and Template stages were left out (no attendance rule; one certificate design).
  - The rail is always clickable. A seminar opens at its first unfinished step, worked out from the seminar-list counts, and each step shows a done tick and a short count.
  - All step panels stay mounted (hidden when inactive), so switching steps keeps files and running issuance batches.
  - Shared `components/CsvDropZone.jsx` (drag-and-drop or browse) replaces the file inputs.
  - Unsaved registration/attendance CSVs and the attendance preview are kept in session storage per seminar (`lib/sessionDraft.js`), surviving tab switches and reloads until imported or confirmed. A stale preview is still rejected by the server on confirm.
  - Once a seminar has registrations or confirmed attendance, the upload box is replaced by a green done card (`components/DoneCard.jsx`) with **Add late registrants** / **Correct attendance** to reveal it again. A saved draft keeps the box open.
  - **Confirming attendance now also prepares certificates** (if the faculty member has `canIssue`) and jumps to Approvals. A failed preparation is reported without undoing the saved attendance.
  - `CertificatePreparation` takes `mode="approvals" | "issue"`. `GET /api/auth/faculty/me` now returns `autoIssue`. With it on, the Issue step shows "Issuing automatically", refreshes every 15 s and keeps "Issue now" as a fallback.
  - Checked with lint, build and a jsdom harness (step selection, rail clicks, draft surviving a remount). Not yet viewed in a real browser.
- [ ] Custom faculty certificate templates (upload their own design): agreed as a separate feature after the wizard.
- [ ] Step 2, public verifier restyle (hero, "Inspecting credential..." steps, colored result banner). Ask about the QR-scan tab first.
- [ ] Step 3, faculty Registry page (new endpoint, route and nav item).
- [ ] Step 4, certificate detail page.
- [ ] Step 5, Share modal, only if the user wants it.

### Done (12 November): student accounts separate from seminars

**Status.** Phases 1 to 5 below are implemented. Backend `npm test`: **101 passed**. Frontend: ESLint clean on the changed files, production build passes, and the jsdom harness checked the Students page (list, search, Remove only on removable rows with confirmation, single add) and the attendance prompt (4-step rail, faculty-email error, suggested row unticked, prefilled name, "Use this account" sends an alias, Register re-runs the preview, the guard 4 file check). **Not yet viewed in a real browser.**

Differences from the plan: no separate domain-typo list, because the "same part before `@`" rule already catches `gmial.com` and the other typos (tested). The preview no longer returns `unmatched`; it returns `unregistered` and `facultyEmails`. Choosing "Use this account" re-runs the preview, which resets edits made in other prompt rows (accepted).


**Why.** Registration exists so a Google account can sign in; registering per seminar adds nothing. Students become accounts managed in a new **Students** tab. The seminar wizard drops to 4 steps (Seminar, Attendance, Approvals, Issue), and attendance is matched against **all** student accounts. Unregistered attendees are offered for registration from the attendance preview, with five guards against creating wrong accounts. This replaces the settled decision "import seminar registrations before the seminar" (section 2). There is **no schema change**: `seminar_registration` stays and is now created by confirming attendance.

**Phase 1: backend student accounts** (new `services/students.js`, `routes/students.js`, `routes/students.test.js`)
- Extract the account-creating half of today's registration import into `registerStudents(client, students)`, with the same rules: emails normalized, existing accounts reused (name/program untouched), faculty emails and incomplete profiles reject the whole batch, idempotent. Extract the per-row validation out of `readRegistrationCsv` so JSON rows get identical checks.
- `GET /api/faculty/students?q=`: search by name or email; returns name, program, email, wallet connected, number of seminars attended, number of certificates, `removable`.
- `POST /api/faculty/students/import` `{ csv }` (bulk, same CSV format) and `POST /api/faculty/students` `{ students: [{ fullName, program, googleAccount }] }` (1–N rows; used by the single-student form and the attendance prompt).
- **Guard 5, undo:** `DELETE /api/faculty/students/:studentID`, allowed only with no linked wallet (so the student never completed sign-in) and no certificate in any status. It removes the attendance rows, then the student and user rows, in one transaction. Requires `canIssue`; the others need an active faculty account (as imports do today).

**Phase 2: backend attendance against all accounts** (`routes/seminars.js`, `utils/seminarCsv.js`, tests)
- `readAttendanceCsv` also reads the optional `full_name` and `program` columns as hints for unregistered rows. Extra columns stay ignored.
- Preview/import match every listed email against all student accounts. On confirm: upsert `seminar_registration` with `attended = true` for matched students, and set `false` for this seminar's other rows. Unchanged: whole-list replacement, removal blocked for issued/pending students, `previewHash` (now also covering matched student IDs and aliases), and 409 on a stale preview.
- The preview splits unmatched emails into `unregistered` (with name/program hints) and `facultyEmails` (cannot become students).
- **Guard 1, "Did you mean?":** each unregistered email gets `suggestions` of existing students with the same part before `@`, a known domain typo (`gmial.com`, `gmai.com`, `gamil.com`, `gmail.co`, `gmail.con` → `gmail.com`), or the same normalized name as the CSV hint.
- Preview/import accept `aliases: { "<listed email>": "<existing student email>" }` so faculty can say "use the existing account". Aliases are validated server-side and included in the hash.
- Remove `POST /faculty/seminars/:id/registrations/import`. Keep `GET .../registrations` (now the seminar's attendee rows). Seminar counts keep their fields; the UI stops showing "registered".

**Phase 3: Students tab** (new `pages/StudentsPage.jsx`, `/faculty/students` route, nav item)
- Bulk upload (`CsvDropZone`, session draft), an **Add one student** form, and a searchable list with wallet status and seminar/certificate counts.
- **Remove** appears only on removable rows, behind a confirmation dialog.

**Phase 4: wizard and attendance prompt** (`IssuancePage.jsx`, `AttendanceImport.jsx`, dashboard hero)
- 4 steps; the Registrations step is gone. The dashboard hero's "attendance not imported" state shows no student count.
- The preview shows "**N students in this list aren't registered yet. Register them?**" with one row each:
  - **Guard 2:** a checkbox per row, unchecked when the row has a suggestion.
  - **Guard 3:** editable name and program, prefilled from the CSV.
  - **Guard 1:** a "Did you mean Juan Dela Cruz (juan.delacruz@gmail.com)? Use this account" button, which adds an alias.
  - Faculty-email rows are shown as errors that can't be registered.
- **Register selected** calls `POST /faculty/students`, then re-runs the preview automatically. Confirm stays disabled until everything matches.
- **Guard 4:** when at least half the list (and 10 or more rows) is unregistered, show "180 of 200 aren't registered. Is this the right file?" and require ticking "I checked this is the right attendance file" before Register is enabled.

**Phase 5: docs.** `backend/README.md` (endpoints, attendance rules), this file's settled decisions (section 2) and workflow (section 3), and the CLAUDE.md lifecycle step 1.

**Tests.** New `students.test.js` (bulk, single, validation, faculty-email rejection, idempotence, search, delete allowed/blocked, auth). Rewritten attendance tests in `seminars.test.js` (all-account matching, rows created on confirm, aliases, each suggestion rule, hints, faculty emails, stale hash after registering, removal/blocking unchanged). Registration-import tests moved to the students tests. Frontend: lint, build and the jsdom harness. Every phase ends with `npm test` green.

**Accepted limits.** No per-seminar sign-up list before the event. No profile editing outside the attendance prompt (name fixes after issuance remain revoke-and-replace). "Never signed in" is approximated by "no linked wallet".

## 5. Certificate hash, statuses, and explorer context

The certificate hash is **Keccak-256 of a canonical data object**, not a hash of the PDF file. `backend/src/utils/certificateConsent.js` defines the exact encoding and field order:

```text
version, chainId, contractAddress, issuerAddress, certificateNo,
recipient, recipientName, seminarTitle, seminarDate, burnAuth
```

Version is `1`; certificate number is a decimal string; addresses are lowercase; date is `YYYY-MM-DD`; burn authorization is `IssuerOnly`. Do not change this encoding casually: existing approvals and issued hashes depend on it.

| Context | Values |
| --- | --- |
| On-chain verification status | `0 = NotFound`, `1 = Valid`, `2 = Revoked` |
| Database certificate state | `PENDING`, `ISSUED`, `REVOKED`, `FAILED` |
| Database transaction state | `PENDING`, `CONFIRMED`, `FAILED` |
| Public details check | `Verified`, `NotFound`, `Missing`, `Mismatch`, `Unavailable` |

Do not confuse certificate number, blockchain token ID, certificate hash, contract address, and transaction hash. They identify different things.

To check a certificate in the explorer, open the configured contract, choose **Contract -> Read Contract -> verify**, paste the certificate hash once with a single `0x` prefix, and query. Read `issuer()` separately for the issuing wallet. The contract does not store readable recipient names or seminar titles.

In an issuance transaction, **From** is the issuer wallet and **To** is the certificate contract. The student wallet is the `to` argument to `issue()` and the mint recipient in its transfer event. Successful transaction status proves that transaction succeeded; `verify()` checks the current valid/revoked state.

The public portal confirms saved certificate facts against the chain. It does not upload and automatically inspect an arbitrary PDF. A verifier must compare the portal's facts with the document received; copying a valid QR onto an altered PDF does not make the altered text authentic.

## 6. What remains unfinished

### Priority 0: housekeeping before new work

- [x] 10 November work (revocation and replacement) committed by the user.
- [x] Auto-issuance, the key fix, the reset script, the dashboard summary and the Share removal are committed. Only this file's 11 November update is uncommitted.
- [ ] Confirm on real Amoy: auto-issuance (approve as a student with `AUTO_ISSUE=true`, wait about 30 s) and the replacement flow (revoke, prepare replacement, approve, issue, check `/verify` and the "Replaced by" label). The user did a round of three-Google-account testing on 11 November; the outcome of these two checks was not recorded.
- [ ] No browser automation has run on the Revocations page or the replacement dialog.

### Priority 1: real faculty revocation (done 10 November)

- [x] Backend lookup by certificate number; server-side `canIssue` recheck; required reason and confirmation dialog.
- [x] `revoke(tokenId)` with the shared signing/persistence/retry/nonce-lock/finality safeguards; `REVOKE` record with `requestedBy` and reason.
- [x] Duplicate requests, already-revoked certificates, uncertain broadcasts, reverts and failed reconciliation are handled. The lookup refreshes after each action.
- [x] Label fixed: the reason is saved in CICT records, not on-chain.
- [x] Backend integration tests added; real Amoy revocation confirmed by the user (No. 1).

### Priority 2: explicit correction/replacement (done 10 November, pending manual test)

- [x] Explicit **Prepare replacement** on a revoked certificate. The original must already be revoked. A new number is assigned and the student must approve again.
- [x] Old certificate and transaction history preserved; no replacement-link field was added.
- [x] Ordinary repeated preparation still never creates replacements; the existing test for this still passes.

### Auto-issuance on student approval (done 11 November, pending real-Amoy check)

Implemented as designed; see section 4. Accepted trade-offs: no faculty review right before minting (the student's approval is the last check), a sleeping host mints only once awakened, missing POL leaves approvals waiting, and mints are one at a time (each waits for finality).

### Priority 3: connect remaining faculty certificate views and sharing

- [x] Faculty dashboard issued/revoked sections and counts connected to real data (11 November).
- [x] Replace the revocation page's sample credential-number placeholder with the numeric format (done with the revocation rewrite).
- [x] **Share credential** removed (11 November).
- [x] Obsolete sample-data helpers removed from `App.jsx` (11 November).

### Priority 4: integration, presentation, and release checks

- [ ] Address deferred UI/UX issues after the functional workflows are complete.
- [ ] Check longer names/seminar titles, small screens, keyboard navigation, dialogs, loading/error states, and target browsers beyond the Edge checks performed so far.
- [ ] Confirm whether an actual coordinator signature/name or other final artwork changes are required; the current coordinator area is a design placeholder.
- [x] `App.jsx` lint findings resolved. The project-wide lint baseline has not been re-checked.
- [ ] Review existing build warnings: CSS font import order and large bundles. Builds pass, but these warnings remain.
- [ ] Update the template root/Hardhat READMEs and stale early paragraphs in the backend README. In particular, older paragraphs still call already-implemented consent/issuance/PDF work future work and mention migration 001-004, while the runner now includes 005.
- [ ] **Fresh contract and clean data before going live:** deploy a new contract (`npx hardhat run scripts/deploy.ts --network amoy`, spends test POL) and set `CONTRACT_ADDRESS`. Then reset the test data (`node scripts/resetTestData.js`, then `--yes`) on the right database after a backup. Do the deploy before the reset: certificate hashes include the contract address. Old test mints stay on the old contract permanently.
- [ ] Back up and migrate the deployed database through the required changes, checking its existing history and original timestamp timezone first.
- [ ] Deploy frontend/backend together and verify their API routing, HTTPS cookies, CORS, Web3Auth configuration, public `/verify` deep links, and contract/RPC settings in the actual hosting arrangement.
- [ ] Test the full workflow on the deployed portal with dedicated test accounts and a small deliberate Amoy issuance/revocation.
- [ ] Generate shared PDFs from the deployed frontend. A localhost QR points to localhost and will not work for an external verifier.
- [ ] Confirm issuer key custody, access, backups, and a process for investigating unresolved transactions. The issuer is immutable; losing control of that wallet affects future issuance and revocation.

No new schema fields are automatically needed for the next task: revocation transaction records, requesting faculty, reason, certificate state, and timestamps already have storage. Inspect the implementation needs before proposing more tables/columns.

## 7. Validation evidence and limits

These are the latest completed checks from development, not newly rerun for this document:

| Check | Latest recorded result |
| --- | --- |
| Backend `npm test` | **101 passed** on 12 November (after the student-accounts rewrite; 93 on 11 November), including PostgreSQL integration tests and public verification checks |
| Frontend lint/build | ESLint clean on the changed files and the production build passes (11 November); no real-browser run of the Revocations page, replacement dialog, new dashboard or the key fix |
| Real Amoy revocation | User confirmed through the portal on 10 November (No. 1) |
| Frontend PDF/QR Node tests | **4 passed**, including one-page dimensions and no clickable PDF annotations |
| Frontend production build | Passed; existing font-import/bundle warnings remain |
| Targeted ESLint on changed components/helpers | Passed |
| Contract suite | User previously reported **5 passing**; not rerun for this handoff |
| Contract TypeScript check | Previously passed without output after ethers pin/build; not rerun for this handoff |
| Real Amoy issuance | User reported successful issuance after RPC/configuration troubleshooting |
| Isolated Edge browser checks | Preparation, approval, issuance, student display, public verification, PDF generation, mobile layout, and status-bar/hash separation passed |
| Public verification checks | Anonymous access, bigint preservation, private-field exclusion, modified facts, domain/wallet mismatch, missing metadata, database failure, wrong network/RPC failure, and revoked chain state covered |
| PDF inspection | Actual generated image inspected; dimensions/QR placement/hash checked; no page-wide links remain |

Backend integration/browser tests use temporary local database schemas and fake RPC responses/generated test wallets. Those tests do not mint on Amoy or consume test POL. Real wallet login in the user's browser and real network behavior are separate manual checks. This is not a formal security audit or proof of production readiness.

## 8. Continue working locally

Workspace layout:

```text
CICT-Cert/
  frontend/         React portal and certificate export
  backend/          Express API, PostgreSQL schema/migrations, integration tests
  smart_contract/   Solidity contracts, Hardhat config, TypeScript tests/deploy script
```

Each subproject has its own dependencies. Run installation/build commands in the corresponding folder. Do not run Hardhat from the repository root; its config is inside `smart_contract`.

### Start the app in two terminals

Backend terminal:

```powershell
cd C:\Users\mmark\CICT-Cert\backend
npm.cmd install
npm.cmd run dev
```

Frontend terminal:

```powershell
cd C:\Users\mmark\CICT-Cert\frontend
npm.cmd install
npm.cmd run dev
```

The frontend development proxy targets `http://localhost:5000` for `/api`. A default Vite run usually serves the portal at `http://localhost:5173`; use the actual printed address.

### Verification commands

Backend, using a configured **local test database** for integration tests:

```powershell
cd C:\Users\mmark\CICT-Cert\backend
npm.cmd test
```

Frontend:

```powershell
cd C:\Users\mmark\CICT-Cert\frontend
node --test src/lib/certificatePdf.test.js src/lib/certificateVerificationUrl.test.js
npm.cmd run build
```

Contract checks; these commands do not deploy:

```powershell
cd C:\Users\mmark\CICT-Cert\smart_contract
npm.cmd install
npx.cmd hardhat build
npx.cmd tsc --noEmit
npx.cmd hardhat test mocha
```

After changing Solidity, build again so generated artifacts/types know about the updated functions. **No contracts to compile** is normal when the build is already current. Do not redeploy just to regenerate local build output.

### Configuration names, without secret values

Backend `.env`:

```text
PORT
DATABASE_URL
FRONTEND_URL
WEB3AUTH_CLIENT_ID
WEB3AUTH_JWKS_URL
WEB3AUTH_ISSUER
SESSION_SECRET
AMOY_RPC_URL
CONTRACT_ADDRESS
ISSUER_PRIVATE_KEY
AUTO_ISSUE   (optional; "true" enables auto-issuance)
```

Frontend `.env`: `VITE_WEB3AUTH_CLIENT_ID`.

Hardhat `.env`: RPC/issuer values required by its config, and `ETHERSCAN_API_KEY` for source-verification tooling. The explorer API key is not a wallet private key and is not needed by a member of the public to read a certificate through the explorer.

Keep `.env`, issuer private keys, passwords, cookie values, identity tokens, consent signatures, and signed transaction payloads out of this handoff and public screenshots. No live credential is included here. A newly pulled repository needs its own environment configuration, installed dependencies, generated contract outputs, and the correct database migration state.

## 9. Short adviser/demo walkthrough

1. Explain that student identity, certificate presentation, and blockchain verification are separate parts of the system.
2. Sign in as authorized faculty. Show the Students tab and explain that registering a Google account only enables sign-in; it is not attendance or issuance.
3. Show the final attendance preview and confirmation.
4. Prepare pending certificates. Point out a recipient waiting for wallet setup versus one awaiting approval.
5. Sign in as a registered student, show the linked wallet, and review/approve a specific certificate.
6. Return to faculty, review issuance, and explicitly confirm one test certificate if a live mint is intended. Show its transaction link/token ID.
7. Show the student's dashboard/collection, full hash, and PDF download with the QR beside the seal.
8. Open public verification in a logged-out browser. Show the recipient/seminar/number and matching blockchain details.
9. Optionally query `verify(certHash)` in the explorer; explain numeric status and contract address versus student recipient.
10. Optionally revoke a test certificate on the Revocations page with a reason, check the transaction until finalized, and show the public verifier reporting Revoked. Then prepare a replacement with corrected details and a new number.

Use a deployed frontend for a QR demonstration across devices. Avoid creating extra live transactions merely to demonstrate already-issued certificates.

## 10. Exact next step

Resume in this order:

1. **Commit** the student-accounts work (12 November), then try it in a real browser: register a student in the Students tab, upload an attendance CSV with one unknown email and one typo, use the prompt, confirm, and check the dashboard hero.
2. **Confirm auto-issuance and the replacement flow on real Amoy** (see Priority 0). Fix anything that fails before moving on.
3. **Release preparation**, in this order: deploy a fresh contract and update `CONTRACT_ADDRESS` (and the ABI if the interface changed); back up, then run the reset script and migrate Supabase; deploy frontend and backend together; run one full test on the deployed portal; generate shared PDFs from the deployed frontend.
4. Priority 4 polish as time allows: small screens, keyboard navigation, longer names, the coordinator signature placeholder, the stale README paragraphs and the bundle-size warnings.

Rough progress estimate (11 November, judgment, not measured): smart contract ~95%, backend ~90%, frontend ~80%, release/ops ~15%, overall ~90% feature-complete and ~70% release-ready.
