# CICT-Cert: Project context, progress, and next steps

Updated: **16 November 2026 (Asia/Manila)**: students register per seminar through a shareable link, and faculty tick attendance on the registrant list (CSV import kept as a fallback until tested; see "Done (16 November)" in section 4). Earlier, 15 November: Merkle batch issuance and sparse Merkle tree batch revocation replace per-certificate approval, issuance and revocation (new contract, not yet deployed; see "Done (15 November)" in section 4). Earlier, 12 November: student accounts are now separate from seminars (Students tab; attendance matched against all accounts, with a guarded "register them?" prompt), and the 4-step wizard tab is now called **Issue**, next to a read-only **Seminars** tab. Earlier: revocation, replacement, optional auto-issuance, real faculty dashboard data and a test-data reset script. See section 10 for where to resume.

This is a handoff for continuing the project. It records the agreed scope, the implementation currently in the workspace, checks completed during development, known gaps, and the recommended next task. Working locally does not mean the same changes are already deployed.

## 1. Project context

CICT-Cert is a seminar certificate system for the College of Information and Communications Technology at the University of Batangas. Faculty register students, confirm seminar attendance, and issue blockchain-backed certificates. Students sign in through their Google account, connect an embedded wallet (signing a one-time consent to receive certificates), and download them as PDFs. Anyone can verify a certificate without logging in.

The blockchain provides a persistent issuance and revocation record. PostgreSQL stores accounts, seminar registrations, attendance, certificate details, wallet-link consent, and transaction history. The PDF is the presentation of a certificate; verification reads the current blockchain status.

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
- Burn authorization is **Neither** (15 November; was IssuerOnly): nobody burns a token. Only the configured issuer may revoke, by updating the on-chain sparse Merkle revocation root.
- Issuance is batched: one transaction per batch stores an immutable Merkle root (linked to the seminar) and mints one token per certificate. Revocation is batched through the single revocation root. Tokens are never burned.
- The contract has one immutable issuer address, without ownership transfer or multiple issuer roles.
- Keep Solidity source pragma `^0.8.24`. This is a compatible compiler range, not an exact compiler pin. The current Hardhat configuration selects compiler **0.8.34** and EVM target `cancun`.
- Use the guide `blockchain-smart-contract-guide.md` as background, adjusted to the actual repository and later decisions. Its sample counts, paths, optional functions, and older recommendations are not proof of implemented behavior.
- Students **register themselves per seminar through a link** faculty share (16 November; replaces "no per-seminar sign-up list" from 12 November). Students use personal Gmail, so faculty can't list their emails in advance. Registering through an open link is the only way, besides faculty, that a student account is created; the login page still refuses unregistered Google accounts. Faculty tick who attended on the registrant list and remove anyone who isn't a CICT student. The Students tab and the attendance CSV import remain as a fallback until link registration has been tried with a small group (see section 4, "Done (16 November)").
- Attendance/eligibility calculation is outside scope. The final attendance CSV determines recipients.
- Match registrations and attendance using the **Google account email**. Do not match using names or school student numbers.
- Students without a linked wallet can remain pending. They are issued certificates only after wallet setup and faculty confirmation. Linking the wallet is the student's standing consent; there is no per-certificate approval (15 November).
- Issuance is never triggered by login or wallet connection. It is triggered only by a faculty button after reviewing the list. Auto-issuance was removed on 15 November.
- Certificate details are recipient name, seminar title, seminar date, and an automatically generated numeric certificate number.
- Use the portal/PDF presentation approach. Rich certificate artwork/metadata in external wallets is deferred.
- A corrected issued certificate requires revoking the original and issuing a new certificate number. The explicit replacement workflow is implemented (10 November).
- Corrected facts (recipient name, seminar title, seminar date) are **entered by faculty on the replacement** and saved only on that new certificate. Student profiles and seminar records are not edited by this workflow (chosen over adding profile/seminar editing). Separately, students may edit their own name and program when they register for a seminar (16 November); that changes future certificates only.
- The revocation reason is stored in PostgreSQL (`blockchain_record.revocationReason`), not on-chain.
- Retain certificate snapshots of recipient name and seminar details, even though the certificate also references its seminar. They preserve the facts issued at that time.
- Keep `seminar.createdBy`; it comes from the signed-in faculty account.
- Do not store section or school student number for this workflow.
- Do not keep `certificate.createdAt`, `replacesCertificateID`, or a database `failureReason` field. Keep `certificate.issuedAt` and `revokedAt`.
- Participant counts may be below or above 100. There is no hard-coded 100-person limit; CSV imports have a size limit.

## 3. Intended workflow and what currently works

1. **Faculty creates a seminar** with title, date, venue (required) and a registration deadline. The backend records the faculty creator. Seminars are created in the Seminars tab (New seminar), which shows the registration link to share; the Issue wizard starts by picking the seminar.
2. **Students open the link and sign in with Google.** New students enter their full name (as printed on the certificate) and program, which creates their account; existing students confirm or correct theirs. Either way they are registered for the seminar.
3. **Students link their embedded wallet** right after registering, by signing a server-provided message, which also records their consent to receive certificates.
4. **Faculty tick who attended** on the registrant list and remove registrants who aren't CICT students. Registration closes at the deadline or when faculty close it. (Fallback until cutover: the attendance CSV import and the Students tab.)
5. **Faculty prepares pending certificates.** Each attendee receives a numbered certificate snapshot; missing wallets remain pending.
6. **Faculty reviews the printed names** (and corrects any before issuance); students see the same names read-only in their portal.
7. **Faculty confirms issuance on Amoy.** All ready certificates go out in Merkle batches (one transaction each). The backend validates, signs, submits, and reconciles them.
8. **Students see issued certificates** on the dashboard and in their collection.
9. **Students download a certificate PDF** containing the design, certificate hash, and verification QR.
10. **Anyone verifies publicly**, using the QR/hash, or reads the contract through the block explorer.
11. **Faculty revokes an issued certificate** from the Registry tab: a row's **Revoke** opens the revocation page for that certificate, which needs a reason, or ticks several rows and revokes them in one transaction. The backend signs, broadcasts and reconciles `revokeBatch(newRoot, tokenIds)` and marks certificates `REVOKED` only after finality.
12. **Faculty prepares a replacement** for a revoked certificate with corrected facts and a new number. Faculty issue it through step 7, in a new batch.

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

### Mockup integration (finished; the `design/CICT-Cert-Ui.html` mockup was removed from the repo on 16 November)

The mockup was the original prototype and was never committed; global CSS and the login, student, revocation and nav pages already match it. The user is integrating the rest **one step at a time, approving each feature first**. Not integrated by choice: the faculty issue wizard (our flow is CSV-driven), the fake "attendance processing" panel, the "upcoming seminars" list, the Verifications activity page (needs new logging), and the simulated QR scan. Share modal: not yet decided.

- [x] **Step 1, faculty dashboard hero.**
  - `GET /api/faculty/seminars` now also returns `readyCount` (attended, student-approved, `PENDING`/`FAILED`), `awaitingCount` (attended, prepared, not yet approved) and `issuedCount` per seminar.
  - Compact dark hero (no certificate preview) for the **latest seminar** (newest date, then newest created), showing its next step in workflow order: ready to issue ("Begin issuance"), awaiting student approval, attendance not imported, certificates to prepare, or all issued.
  - The button opens `/faculty/issue?seminar=<id>`, which preselects that seminar.
  - Beside it, an **Issuance progress** panel replaces the mockup's fake attendance-processing panel: the 3 latest seminars, sorted latest to oldest, each with an issued-of-attended bar and ready and awaiting counts.
  - Test added to `issuance.test.js`. Not yet viewed in a browser.
- [x] **Seminars tab as a wizard** (renamed **Issue** on 12 November; `pages/IssuancePage.jsx`; 5 steps on 11 November, **4 steps since 12 November** after the Registrations step moved to the Students tab), following the mockup's stage rail but mapped to the real flow: Seminar (pick or create), Registrations, Attendance, Approvals, Issue. The mockup's Eligibility and Template stages were left out (no attendance rule; one certificate design).
  - The rail is always clickable. A seminar opens at its first unfinished step, worked out from the seminar-list counts, and each step shows a done tick and a short count.
  - All step panels stay mounted (hidden when inactive), so switching steps keeps files and running issuance batches.
  - Shared `components/CsvDropZone.jsx` (drag-and-drop or browse) replaces the file inputs.
  - Unsaved registration/attendance CSVs and the attendance preview are kept in session storage per seminar (`lib/sessionDraft.js`), surviving tab switches and reloads until imported or confirmed. A stale preview is still rejected by the server on confirm.
  - Once a seminar has registrations or confirmed attendance, the upload box is replaced by a green done card (`components/DoneCard.jsx`) with **Add late registrants** / **Correct attendance** to reveal it again. A saved draft keeps the box open.
  - **Confirming attendance now also prepares certificates** (if the faculty member has `canIssue`) and jumps to Approvals. A failed preparation is reported without undoing the saved attendance.
  - `CertificatePreparation` takes `mode="approvals" | "issue"`. `GET /api/auth/faculty/me` now returns `autoIssue`. With it on, the Issue step shows "Issuing automatically", refreshes every 15 s and keeps "Issue now" as a fallback.
  - Checked with lint, build and a jsdom harness (step selection, rail clicks, draft surviving a remount). Not yet viewed in a real browser.
- [x] **Issue + Seminars tabs** (12 November). The wizard tab (`/faculty/issue`) is now labelled **Issue**; creating seminars stays there (user's choice).
  - New read-only **Seminars** tab (`pages/SeminarsPage.jsx`, `/faculty/seminars`): seminar list, and for the selected seminar the summary counts, attendees (`GET .../registrations`) and certificates (`GET .../certificates`, with Verify for issued/revoked). No backend change.
  - Issue tab: the seminar list was removed from step 1, which is now only the **New seminar** form. A **Seminar** dropdown in the header switches seminars (opening each at its first unfinished step).
  - **Edit / delete a mistaken seminar** (`components/SeminarEditDialog.jsx`, **Edit** button beside the seminar dropdown): any faculty can fix the title/date; `canIssue` faculty can delete it (its attendance rows go too). Both only until a certificate exists, since certificates copy the title and date (`PATCH`/`DELETE /api/faculty/seminars/:id`, seminar row locked; `certificateCount` added to the seminar list). Tests in `seminars.test.js`.
  - Status wording for a seminar certificate now lives in `lib/certificateProgress.js`, shared with `CertificatePreparation`.
  - Checked with lint, build and a jsdom harness. Not yet viewed in a real browser.
- [ ] Custom faculty certificate templates (upload their own design): agreed as a separate feature after the wizard.
- [x] **Step 2, public verifier restyle** (`pages/VerifierPortalPage.jsx`, 12 November). The request, hash validation and `detailsStatus` handling are unchanged.
  - Centered hero with seal and the hash form in a `sheet tick-corners` card.
  - The "Inspecting certificate…" screen lists the three checks together under one spinner (one request does all of them, so there is no fake timed ticking).
  - A colored result banner (seal, rosette) is followed, **only when the stored details re-hash to the on-chain record**, by the rendered certificate (with its QR and stamp) plus an Inspection record panel. Otherwise only the Blockchain record panel and the existing warning are shown.
  - The **QR-scan tab was skipped** (user's choice): phone camera apps already open `/verify?id=…`, and a scanner needs a new dependency.
  - `Certificate.jsx` now hides "Block #" when no block number is given, instead of showing "Block #0".
  - Checked with lint, build and a jsdom harness (Valid, Revoked, Mismatch and NotFound results, plus the idle form). Not yet viewed in a real browser.
- [x] **Step 3, faculty Registry page** (`pages/RegistryPage.jsx`, `/faculty/registry`, nav item **Registry**, 12 November).
  - `GET /api/faculty/certificates?q=&status=` (in `routes/revocations.js`) lists only certificates that reached the chain (`ISSUED`/`REVOKED`), newest issued first, first 200 matches (`shortcut:` comment, like the Students list). Search covers name, email, seminar title and exact certificate number.
  - Status chips (All / Verified / Revoked), debounced search, and a **fixed-height table** (560 px, scrolls inside the card, sticky header), as the user asked.
  - Each row has **Verify** (public verifier in a new tab) and **Revoke** / **Details**, which opens the Revocations page at `?no=<number>` with that certificate already looked up (`RevocationPage` takes `initialNo`).
  - Test added to `revocation.test.js`; checked with lint, build and a jsdom harness. Not yet viewed in a real browser.
- [x] **Step 4, certificate detail page, students only** (`pages/StudentCertificatePage.jsx`, `/student/certificates/<number>`, 12 November). Faculty use the Registry's **Details** button, which opens the Revocations page.
  - Clicking a certificate on the student dashboard or collection now opens this page instead of the download popup. The **Download** buttons still open the popup, and the page's **Download PDF** reuses it.
  - The page shows the certificate with its real QR, a status seal, and a blockchain record: number, network, ERC-5484, token ID, block, and the issuing transaction linked to Polygonscan. It has **Verify** and **Back to my certificates**, plus a "Certificate not found" state for a number outside the student's collection.
  - No backend change: it uses the student certificate list App already loads. Checked with lint, build and a jsdom harness. Not yet viewed in a real browser.
- [ ] Step 5, Share modal, only if the user wants it. The mockup is gone, so this would need a new design.

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

### Done (13 November): custom certificate templates

Faculty can design certificates instead of always using the built-in layout. The backend rules are in `backend/README.md` ("Certificate templates").

- **Templates tab** (`/faculty/templates`, `TemplatesPage.jsx`, `TemplateEditor.jsx`).
  - Upload a PNG/JPG background: A4 or US Letter, landscape or portrait, detected from the proportions.
  - Drag (or move with the arrow keys) the recipient name, seminar title, date, certificate number and QR code into place, and set their font, size, color, alignment and width.
  - Title, date and number can be hidden; name and QR are always shown.
  - Up to 3 signature images (e.g. the Dean's), each with an optional printed name/title and line.
  - Templates are shared by all faculty. The creator or a `canIssue` faculty can edit one until certificates use it; then it locks.
- **Per seminar:** "Certificate design" in the New seminar form and the seminar Edit popup (`TemplatePicker.jsx`). The Seminars tab shows each seminar's design. The choice locks with the title and date once certificates are prepared.
- **Rendering:** `Certificate.jsx` draws the template (falling back to `cert.template`). The student approval preview, collection, detail page, PDF and `/verify` all use it.
  - The PDF page size follows the template's paper size: `createCertificatePdf(png, [wMm, hMm], no)`.
  - The certificate hash, consent message and contract are unchanged.
- **Schema:** migration `006_certificate_templates.sql`. Apply it to the local and Supabase databases before running this version.
- **Tests:**
  - New `templates.test.js` and `certificateTemplate.test.js`, plus a template case in `seminars.test.js` (backend: 114 pass).
  - `certificatePdf.test.js` updated.
  - jsdom harness for the editor (drag, keyboard nudge, hide field, alignment, signature upload and caption, save payload, locked read-only) and for the picker.
- **Not yet checked in a real browser:** the editor, the thumbnails, and PDF export with a template background (html-to-image must embed the same-origin image).
- **Skipped:** duplicating a locked template, extra fields (hash text, program), Legal paper, custom fonts.

### Done (13 November): Revocations tab folded into the Registry

- The faculty menu no longer has a **Revocations** tab.
- The revocation page (`/faculty/revocation?no=<number>`) is still the place to revoke, check a pending revoke transaction or prepare a replacement. It's opened from a Registry row's **Revoke** / **Details**, keeps the Registry tab highlighted, and has a **Back to registry** link.
- The dashboard's "View revoked certificates" button opens the Registry with the Revoked filter (`?status=REVOKED`).

### Done (15 November): Merkle batch issuance and sparse Merkle revocation

**Supersedes** per-certificate student approval, one-transaction-per-certificate issuance and revocation, burning on revoke, and auto-issuance (11 November). Older entries above describe the previous design. Not yet deployed to Amoy; nothing committed. The authoritative spec is `backend/README.md` ("Merkle batch issuance and sparse Merkle revocation").

- **Contract** (`CICTCertificate.sol`, rewritten; constructor and deploy script unchanged): `issueBatch(seminarId, root, recipients, certHashes)` stores an immutable Merkle root per batch (linked to the seminar) and mints one soulbound token each; each token stores only its batch ID. `revokeBatch(newRoot, tokenIds)` replaces one sparse-Merkle-tree revocation root (depth 64, keyed by token ID); tokens are not burned. `verify(tokenId, certHash, merkleProof, smtBitmap, smtSiblings)` returns Valid/Revoked/NotFound. `burnAuth` is now `Neither`. `BatchIssued` emits the batch's hashes so trees can be rebuilt from the chain.
- **Benchmarks** (`contracts/bench/Benchmarks.sol`, `test/GasBenchmark.ts`): batch of 100 costs 74,871 gas per certificate vs 100,805 for one transaction each with a stored hash (26% less). Dropping the per-token batch-ID slot would give about 48% but `verify` would then need the batch ID passed in; **left as specified, user to decide**. Revoking 1,000: SMT 459k gas, bitmap 1.0M, burn 8.5M, mapping 22.8M. Proofs: 4 hashes (128 bytes) for a batch of 100; compressed SMT proof 8 to 328 bytes vs 2,048 uncompressed.
- **Backend:** `utils/merkle.js` (viem only); migration `007_merkle_batches.sql` (consent moves to `student_wallet`, per-certificate consent columns removed, `transactionHash` non-unique); canonical hash version 2; wallet-link message now carries the consent; batch issue/check routes (`ISSUE_BATCH_SIZE`, default 100, 1 to 200); batch revoke/check routes (max 200); pre-issuance name correction (`PATCH .../certificates/:certificateID`); student proof download (`GET /api/student/certificates/:certificateID/proof`); verifier rebuilds both proofs and calls `verify`. Auto-issuance and the consent routes removed. 110 backend tests pass against local PostgreSQL; 8 contract tests pass.
- **Frontend:** wizard steps are Seminar, Attendance, **Review**, Issue. Review lists the printed names with a **Correct name** control; Issue sends all ready certificates in batches with one confirmation and a seminar-level **Check transaction**. Students got a read-only **Upcoming certificates** card instead of approvals (removed 16 November: students now see certificates only once issued), and a **Download Merkle proof (JSON)** button on a certificate's page. The Registry has checkboxes and **Revoke N** for batch revocation. The verifier shows the batch number. Lint (6 errors, all pre-existing in `useStudentSession.js` and `LoginPage.jsx`), build and the frontend tests pass. **Not tried in a browser.**

### Done (16 November): seminar registration link

**Why.** Students use personal Gmail, so faculty can't register their emails ahead of time. Each seminar gets a shareable link; students sign in with Google there, and registering is what creates their account. Faculty then tick attendance on the registrant list instead of importing a CSV. Decided with the user: no student number or section (settled decision kept); the form asks full name and program; existing students may edit their name and program while registering; after cutover the Students tab keeps its list and Remove only.

- **Schema:** migration `009_seminar_registration_link.sql` adds `seminar."venue"` (display only, never hashed), `"registrationToken"` (random UUID, the link) and `"registrationClosesAt"` (NULL = closed). No cron: openness is checked per request; closing early sets the deadline to now.
- **Backend:** public `GET`/`POST /api/register/:token` (`routes/registration.js`, ID-token verified, rate-limited, `FOR SHARE` seminar lock). Faculty: venue/deadline on seminar create/edit, `POST .../registration/close`, `PATCH`/`DELETE .../registrations/:studentID` (tick attendance, remove registrant) under the seminar row lock; the "attendance locked" rule is shared with the CSV import. Login's 403 message now points to the seminar link. 116 backend tests pass against local PostgreSQL.
- **Frontend:** `/register/:token` (`RegisterPage.jsx`, public like `/verify`): seminar details, Google sign-in, name/program form (prefilled for existing accounts), then wallet link through `useStudentSession`, then a confirmation. Create form and edit dialog have venue and deadline. `Registrants.jsx` (link + copy + close, registrant list with attended checkbox and Remove) is the Issue wizard's Attendance step and the link also shows in the Seminars tab. Lint on changed files, build and frontend tests pass. **Not tried in a browser.**
- **Streamlined flow (same day):** New seminar moved from the Issue wizard to the Seminars tab (`NewSeminarDialog.jsx`, selects the new seminar). Issue wizard step 1 is now **Select seminar** (dropdown, details, registration link; always clickable to switch). Step 2 Attendance is the registrant table with a name/email search box and attended checkboxes; the CSV import stays under "Or import an attendance CSV". Student orgs running a seminar use a faculty account without `canIssue` (ticking attendance needs no issue permission).
- **Issuer wallet balance on the dashboard:** `GET /api/faculty/certificates/issuer-wallet` (any active faculty, `routes/revocations.js`) reads the contract's `issuer()` and its POL balance; the dashboard header shows it, in place of the old Manage seminars button, linking to PolygonScan. Test in `revocation.test.js`.
- **Follow-ups (same day):** venue is now required (API on create, and on edit when sent; the column stays nullable for older seminars). The Seminars tab's seminar list has a search box (title or venue).
- **Not done yet (cutover, after testing with a small group):** remove `AttendanceImport.jsx` (now under "Or import an attendance CSV"), the attendance preview/import routes and `readAttendanceCsv`, and the Students tab's import and add-one form with `POST /faculty/students(/import)`; then `registerStudents`/`readRegistrationCsv` if nothing else uses them.

## 5. Certificate hash, statuses, and explorer context

The certificate hash is **Keccak-256 of a canonical data object**, not a hash of the PDF file. `backend/src/utils/certificateConsent.js` defines the exact encoding and field order:

```text
version, chainId, contractAddress, issuerAddress, certificateNo,
recipient, recipientName, seminarTitle, seminarDate, burnAuth
```

Version is `2` (15 November; was `1`); certificate number is a decimal string; addresses are lowercase; date is `YYYY-MM-DD`; burn authorization is `Neither` (was `IssuerOnly`). Do not change this encoding casually: issued hashes depend on it.

| Context | Values |
| --- | --- |
| On-chain verification status | `0 = NotFound`, `1 = Valid`, `2 = Revoked` |
| Database certificate state | `PENDING`, `ISSUED`, `REVOKED`, `FAILED` |
| Database transaction state | `PENDING`, `CONFIRMED`, `FAILED` |
| Public details check | `Verified`, `NotFound`, `Missing`, `Mismatch`, `Unavailable` |

Do not confuse certificate number, blockchain token ID, certificate hash, contract address, and transaction hash. They identify different things.

To check a certificate in the explorer, open the configured contract, choose **Contract -> Read Contract -> verify**, and enter the token ID, the certificate hash and the two proofs (the student's proof file has the inclusion proof; the revocation proof comes from the backend). `batchOf(recordOf(tokenId).batchId)` shows the batch root. Read `issuer()` separately for the issuing wallet. The contract does not store readable recipient names or seminar titles.

In an issuance transaction, **From** is the issuer wallet and **To** is the certificate contract. Student wallets are the `recipients` argument to `issueBatch()` and the mint recipients in its transfer events. Successful transaction status proves that transaction succeeded; `verify()` checks the current valid/revoked state.

The public portal confirms saved certificate facts against the chain. It does not upload and automatically inspect an arbitrary PDF. A verifier must compare the portal's facts with the document received; copying a valid QR onto an altered PDF does not make the altered text authentic.

## 6. What remains unfinished

### Priority 0: housekeeping before new work

- [x] 10 November work (revocation and replacement) committed by the user.
- [x] Auto-issuance, the key fix, the reset script, the dashboard summary and the Share removal are committed. Only this file's 11 November update is uncommitted.
- [ ] ~~Auto-issuance check~~ (removed 15 November). Confirm on real Amoy the replacement flow (revoke, prepare replacement, approve, issue, check `/verify` and the "Replaced by" label). The user did a round of three-Google-account testing on 11 November; the outcome of these two checks was not recorded.
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

### Auto-issuance on student approval (removed 15 November)

Removed with the per-certificate approval it depended on; faculty now review the list and issue in batches.

### Merkle batch issuance and SMT revocation (done 15 November, not deployed)

- [ ] Decide whether to drop the per-token batch-ID slot (about 48% issuance saving instead of 26%; `verify` would take the batch ID as an argument).
- [ ] Try the new UI in a browser: Review step and name correction, batch Issue, proof download, Registry batch revoke.
- [ ] Deploy and run end to end on Amoy (see section 10).

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
- [x] Backend README stale paragraphs and migration list updated (15 November). The template root/Hardhat READMEs are still unchanged.
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
ISSUE_BATCH_SIZE   (optional; certificates per issuance transaction, default 100, 1 to 200)
```

Frontend `.env`: `VITE_WEB3AUTH_CLIENT_ID`.

Hardhat `.env`: RPC/issuer values required by its config, and `ETHERSCAN_API_KEY` for source-verification tooling. The explorer API key is not a wallet private key and is not needed by a member of the public to read a certificate through the explorer.

Keep `.env`, issuer private keys, passwords, cookie values, identity tokens, consent signatures, and signed transaction payloads out of this handoff and public screenshots. No live credential is included here. A newly pulled repository needs its own environment configuration, installed dependencies, generated contract outputs, and the correct database migration state.

## 9. Short adviser/demo walkthrough

1. Explain that student identity, certificate presentation, and blockchain verification are separate parts of the system.
2. Sign in as authorized faculty. Show the Students tab and explain that registering a Google account only enables sign-in; it is not attendance or issuance.
3. Show the final attendance preview and confirmation.
4. Prepare pending certificates. Point out a recipient waiting for wallet setup versus one ready to issue, and correct a name in the Review step.
5. Sign in as a registered student, show the linked wallet (certificates appear once issued).
6. Return to faculty and issue the batch if a live mint is intended. Show its single transaction link and the token IDs.
7. Show the student's dashboard/collection, full hash, and PDF download with the QR beside the seal.
8. Open public verification in a logged-out browser. Show the recipient/seminar/number and matching blockchain details.
9. Optionally download the Merkle proof file from the student's certificate page and explain the batch root, the inclusion proof and the revocation root.
10. Optionally revoke test certificates from the Registry (tick rows, **Revoke N**, one transaction) with a reason, check the transaction until finalized, and show the public verifier reporting Revoked. Then prepare a replacement with corrected details and a new number.

Use a deployed frontend for a QR demonstration across devices. Avoid creating extra live transactions merely to demonstrate already-issued certificates.

## 10. Exact next step

Resume in this order:

1. **Review and commit** the 15 November Merkle batch work (contract, backend, frontend, docs). Nothing is committed yet.
2. **Decide** the per-token batch-ID question (section 6). Changing it means a contract, backend and test change before deploying.
3. **Deploy and reset** (spends Amoy POL and wipes test data; do it yourself): back up the database, `node scripts/resetTestData.js --yes`, `node scripts/migrateSeminarSchema.js "<original TZ>"` (or apply `007_merkle_batches.sql` alone on an already migrated database), `npx hardhat run scripts/deploy.ts --network amoy` in `smart_contract`, set `CONTRACT_ADDRESS`, restart the backend.
4. **Manual run with three test Google accounts:** apply migration `009`, create a seminar with a deadline, register each account through the link in a private window (wallet links with consent), tick attendance for all three (and check a fourth, unticked registrant gets nothing), review and correct a name, issue the batch, open `/verify` for each, download a proof file, revoke two in one transaction from the Registry, confirm Revoked for those and Valid for the third, then prepare and issue a replacement as a second batch.
5. **Cutover**: once link registration works for a small group, remove the CSV import and the Students tab add/import (see "Done (16 November)").
6. **Release preparation**: migrate Supabase after a backup; deploy frontend and backend together; run one full test on the deployed portal; generate shared PDFs from the deployed frontend.
7. Priority 4 polish as time allows.

Rough progress estimate (11 November, judgment, not measured): smart contract ~95%, backend ~90%, frontend ~80%, release/ops ~15%, overall ~90% feature-complete and ~70% release-ready.
