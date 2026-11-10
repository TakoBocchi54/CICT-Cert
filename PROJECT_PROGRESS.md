# CICT-Cert: Project context, progress, and next steps

Updated: **10 November 2026 (Asia/Manila)**: faculty revocation and correction-by-replacement implemented; auto-issuance on student approval proposed (not started). See section 10 for where to resume.

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
- Import seminar registrations before the seminar; import a final attendance list afterward.
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
2. **Faculty imports registration CSV.** Student accounts and seminar registrations are created or reused.
3. **Students sign in with the registered Google account** and link their embedded wallet by signing a server-provided message.
4. **Faculty imports final attendance**, reviews matches, then confirms the full list.
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
- Faculty creation is available through `backend/scripts/createFaculty.js`; registration import creates student accounts.

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

### Seminar registration and attendance

- Faculty can create seminars, list them, and view registrations.
- Registration accepts UTF-8 CSV with quoted values, escaped quotes, BOM, and CRLF support, up to 1 MB.
- Required registration fields are `full_name`, `program`, and `google_account`. Extra columns are ignored.
- Emails are trimmed and lowercased; Gmail dots/plus tags are preserved, and Google Workspace domains are allowed.
- Identical duplicate emails count once. Conflicting profiles for the same email within a file reject the import.
- Existing names/programs/wallets and attendance are preserved when reusing accounts.
- Reimports are idempotent. Faculty email conflicts and incomplete student accounts reject the entire import.
- Final attendance matches Google emails to that seminar's registered students.
- Preview does not write. Confirmation requires the reviewed CSV and its server-generated preview hash.
- Changed CSV/registration/attendance/certificate state requires a fresh preview rather than silently saving stale results.
- The confirmed attendance file replaces the full attendance list: omitted registered students become absent.
- Empty lists and unmatched emails are rejected. Attendance import never creates student accounts.
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

- [ ] **Commit this session's work.** Nothing from 10 November is committed (one commit attempt was declined). Uncommitted:
  - modified: `backend/README.md`, `backend/src/app.js`, `backend/src/middleware/requireFaculty.js`, `backend/src/routes/seminars.js`, `backend/src/services/issuance.js`, `frontend/src/App.jsx`, `frontend/src/pages/RevocationPage.jsx`
  - new: `backend/src/services/revocation.js`, `backend/src/routes/revocations.js`, `backend/src/routes/revocation.test.js`, root `CLAUDE.md` (created this session for Claude Code), and this `PROJECT_PROGRESS.md` (also untracked)
- [ ] Manually test the replacement flow end to end:
  1. Look up revoked No. 1 and prepare a replacement. It should get the next number, likely No. 12.
  2. Approve it as the student.
  3. Issue it from the seminar page. This is a real Amoy mint.
  4. Confirm `/verify` shows the corrected facts and that No. 1 shows "Replaced by".
- [ ] No browser automation was run for the new Revocations page or the replacement dialog. An automated check was prepared, but signing a local faculty session cookie was declined. Options: the user logs in through a visible browser, or checks manually.

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

### Proposed next: auto-issuance on student approval (awaiting decision)

The user asked whether a student's approval could issue the certificate automatically. The proposed design has not been started:

- Treat faculty **Prepare certificates** (which already requires `canIssue` and records `authorizedBy`) as the issuance authorization. Auto-mints use that faculty as `requestedBy`, rechecking their current `canIssue`.
- Do **not** mint inside the approval request. The issuer allows only one pending transaction at a time, so concurrent approvals would conflict. Instead, run a small in-process worker every ~20–30 s, and also trigger it right after each approval. It:
  1. reconciles any pending issuer transaction
  2. if none is pending, issues the oldest approved certificate through the existing `issueCertificate` path
  3. repeats
- The existing advisory lock keeps it safe across instances. The faculty issue and check buttons remain as a manual fallback.
- Add an on/off switch (`AUTO_ISSUE=true` in `backend/.env`), an "Issuing…" state for students, and a note on the faculty seminar page when auto-issuance is waiting (for example, no POL or a pending transaction). Add tests using the existing fake RPC server, and update the settled decision in section 2.
- Trade-offs to accept:
  - there is no faculty review just before minting; the student's own review on the approval screen is the last check
  - Render's free tier sleeps when idle, delaying mints until the next request wakes it
  - POL exhaustion leaves approvals waiting
  - batches are still minted one at a time

### Priority 3: connect remaining faculty certificate views and sharing

- [ ] Connect the faculty dashboard's recently issued/revoked sections and counts to real backend certificate data. Seminar counts are connected; the certificate summaries still receive the static `INITIAL_CERTS` (empty) constant in `App.jsx`.
- [x] Replace the revocation page's sample credential-number placeholder with the numeric format (done with the revocation rewrite).
- [ ] Implement or remove **Share credential**. Its current handler is a placeholder; verification and PDF download already work.
- [ ] Remove obsolete sample-data helpers/local state after their remaining consumers are connected.

### Priority 4: integration, presentation, and release checks

- [ ] Address deferred UI/UX issues after the functional workflows are complete.
- [ ] Check longer names/seminar titles, small screens, keyboard navigation, dialogs, loading/error states, and target browsers beyond the Edge checks performed so far.
- [ ] Confirm whether an actual coordinator signature/name or other final artwork changes are required; the current coordinator area is a design placeholder.
- [ ] Resolve existing `App.jsx` lint findings as part of finishing its placeholder wiring. Targeted changed-file lint passes; the project-wide lint baseline is not clean.
- [ ] Review existing build warnings: CSS font import order and large bundles. Builds pass, but these warnings remain.
- [ ] Update the template root/Hardhat READMEs and stale early paragraphs in the backend README. In particular, older paragraphs still call already-implemented consent/issuance/PDF work future work and mention migration 001-004, while the runner now includes 005.
- [ ] Review and commit the current tracked modifications **and new untracked implementation/test/migration files** before handing the branch to another developer.
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
| Backend `npm test` | **88 passed** on 10 November (79 earlier + 9 for revocation/replacement), including PostgreSQL integration tests and public verification checks |
| Revocations page (frontend) | ESLint clean and production build passes on 10 November; no browser automation run yet |
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
```

Frontend `.env`: `VITE_WEB3AUTH_CLIENT_ID`.

Hardhat `.env`: RPC/issuer values required by its config, and `ETHERSCAN_API_KEY` for source-verification tooling. The explorer API key is not a wallet private key and is not needed by a member of the public to read a certificate through the explorer.

Keep `.env`, issuer private keys, passwords, cookie values, identity tokens, consent signatures, and signed transaction payloads out of this handoff and public screenshots. No live credential is included here. A newly pulled repository needs its own environment configuration, installed dependencies, generated contract outputs, and the correct database migration state.

## 9. Short adviser/demo walkthrough

1. Explain that student identity, certificate presentation, and blockchain verification are separate parts of the system.
2. Sign in as authorized faculty. Show a seminar and registration import; explain that registration is not attendance or issuance.
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

Resume on 11 November in this order:

1. **Review and commit** the uncommitted 10 November work listed under Priority 0. Ask the user before committing; a commit was declined once this session.
2. **Manually test the replacement flow** with No. 1: prepare the replacement, have the student approve it, issue it on Amoy, then verify it.
3. **Decide on auto-issuance on approval**, using the proposed design in section 6. If approved, implement it behind `AUTO_ISSUE` with the background worker, never minting inline in the approval request.
4. Then continue with Priority 3: the faculty dashboard's real issued/revoked data and the **Share credential** decision.
