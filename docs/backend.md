# Signal Hunt backend and client integration contract

This document describes what is implemented in this repository: the Fastify API (`apps/server`),
the shared contracts (`packages/contracts`) and the private content tooling
(`packages/content-tools`). The Expo application is **not** implemented. Requirements come from the
[specifications](../specifications); this file records the decisions the specifications left open.

## 1. Setup and commands

Requires Node.js 22.12 or newer and npm. All commands run from the repository root.

```sh
npm install
npm run setup        # env:init + db:migrate + content:load
npm run dev          # API on http://127.0.0.1:3000 (restarts on change)
```

| Command                                      | What it does                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run env:init`                           | Creates `.env` from `.env.example` with a random `FINGERPRINT_SECRET` (never overwrites)     |
| `npm run db:migrate`                         | Applies SQL migrations from `apps/server/drizzle` to `DATABASE_PATH`                         |
| `npm run content:validate -- <dir>`          | Validates a content directory without touching the database                                  |
| `npm run content:load`                       | Validates `CONTENT_DIR` and registers it transactionally; exits non-zero unless ready        |
| `npm run content:new-qr-token`               | Prints a new 256-bit QR token and its payload for authors                                    |
| `npm run dev` / `npm start`                  | Runs the API (with / without file watching)                                                  |
| `npm run maintenance`                        | Inactivity expiry and retention purge (see [Retention](#7-retention-expiry-and-maintenance)) |
| `npm run db:reset`                           | **Development only.** Deletes the SQLite file; refused when `NODE_ENV=production`            |
| `npm run openapi`                            | Prints the OpenAPI 3.1 document (also served at `GET /v1/openapi.json`)                      |
| `npm run check`                              | Type check, lint (incl. dependency boundaries), format check and all tests                   |
| `npm run db:generate -w @signal-hunt/server` | Generates a new migration after editing `src/infrastructure/db/schema.ts`                    |

The repository's `.npmrc` sets `ignore-scripts=true`: dependencies install without lifecycle scripts.
`better-sqlite3` ships prebuilt binaries, so no compiler or Python is needed; with a lockfile npm
would otherwise attempt `node-gyp rebuild`.

Configuration is read from the environment and from `<repo>/.env`; see [.env.example](../.env.example)
for every variable. Relative paths resolve from the repository root. The database lives in the
git-ignored `data/` directory, outside any build output, and persists across restarts.

**Reaching the API from a phone.** On a phone `localhost` is the phone. Set `HOST=0.0.0.0`, keep
`ALLOW_INSECURE_HTTP=true` for the LAN demo, and use `http://<computer-LAN-IP>:3000` as the client's
base URL. No tunnel or hosted service is involved.

**Transport policy.** HTTPS is required by default: the server refuses to start unless it runs behind
a TLS-terminating proxy (`TRUST_PROXY=true`) or `ALLOW_INSECURE_HTTP=true` is set explicitly. That
flag is a local-development exception and is rejected together with `NODE_ENV=production`. Without
it, every non-HTTPS request except `/health` gets `400 INSECURE_TRANSPORT`. Public exposure still
needs the separate operations review named in the specifications (gate G09).

## 2. Repository architecture

```text
packages/contracts      Zod schemas, inferred types, error vocabulary, route table   (zod only)
packages/content-tools  Private content schema, validation, compilation, loading     (contracts, zod, Node)
apps/server             Fastify API                                                   (both packages)
content/synthetic       Public synthetic bilingual fixtures (answers and QR token are NOT secret)
content/private         Git-ignored place for real content
```

Dependency direction is enforced, not just documented:

- `packages/contracts` compiles with no Node/DOM types and ESLint allows it to import only `zod` and
  its own files. A future Expo app depends on this package and nothing else from this repository.
- `apps/server/src/modules/*/domain.ts` holds pure rules and may import only `@signal-hunt/contracts`.
- `apps/server/src/modules/**` (application use cases, repositories) may not import Fastify.
- Only `src/app.ts` and `src/infrastructure/http/route.ts` touch HTTP.
- `src/composition.ts` builds the one production context (system clock, `crypto` randomness,
  GeographicLib geodesy, SQLite). Test doubles live in `apps/server/test/` and cannot be imported from
  `src/`. There is no environment variable or flag that enables fake GPS, QR or clock behaviour.

Server modules follow the technical specification:

| Module         | Files                                                    | Owns                                                             |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Installations  | `modules/installations/service.ts`                       | Provisioning, credential verification, expiry, deletion receipts |
| Catalog        | `modules/catalog/use-cases.ts`                           | Safe discovery metadata and availability                         |
| Runs           | `modules/runs/{domain,repository,snapshot,use-cases}.ts` | State machine, ownership, revisions, switching, safe snapshots   |
| Checkpoints    | `modules/checkpoints/{domain,use-cases}.ts`              | Proximity gate, unbiased draw, persisted selection               |
| Questions      | `modules/questions/{domain,use-cases}.ts`                | Text/numeric/choice evaluation, hints, assistance                |
| Finales        | `modules/finales/{domain,use-cases}.ts`                  | QR parsing and binding, completion conjunction                   |
| Content        | `modules/content/{store,release}.ts`                     | Version registration, immutability, readiness verification       |
| Infrastructure | `infrastructure/**`                                      | SQLite/Drizzle, config, adapters, idempotency, error mapping     |

A request flows `route.ts` (validate → locale → authenticate → idempotency) → use case (one
`BEGIN IMMEDIATE` transaction) → domain rules + repository → allowlisted response schema.

## 3. Client integration contract

Import everything from `@signal-hunt/contracts`: `ROUTES` (method, path, auth, schemas for every
endpoint), request/response schemas and types, `ERRORS`, `HEADERS`, `LIMITS`, `PROXIMITY`, and the
public format helpers `normalizeAnswerText`, `parseDecimalInput`, `parseQrPayload`. The same table
drives the server's routes and `GET /v1/openapi.json`.

### Headers

| Header                               | When                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `Authorization: Bearer <credential>` | Every route with `auth: "bearer"`                                             |
| `Accept-Language: pl` or `en`        | Every route with `localized: true`; anything else is `400 LOCALE_UNSUPPORTED` |
| `Idempotency-Key`                    | Every route with an `operation`; 16-64 URL-safe characters (a UUID)           |
| `X-Deletion-Receipt-Id`              | `DELETE /v1/me`                                                               |
| `X-Deletion-Receipt-Proof`           | `GET /v1/deletions/:receiptId`                                                |

Responses carry `X-Correlation-Id`, `Cache-Control: no-store`, and for localized routes
`Content-Language` and `Vary: Accept-Language`. A replayed idempotent response has
`Idempotency-Replayed: true`. Credentials and proofs are never accepted in URLs.

### Identity

`POST /v1/installations` returns the credential (`sh1_` + 256 random bits) exactly once; the server
stores only a SHA-256 verifier. Persist it in OS secure storage before starting a run. Provisioning
is not idempotent: a lost response leaves an orphan installation that inactivity expiry removes.
`401 CREDENTIAL_INVALID` and `401 INSTALLATION_EXPIRED` both mean recovery is impossible; the
client should offer an explicit reset, not silently re-provision over existing local data.

### Runs and revisions

- `POST /v1/runs` needs `huntId`, the `huntVersion` shown to the player (from catalog/detail) and
  `expectedInstallationRevision` (from `GET /v1/me`, `GET /v1/runs` or any mutation response).
  The server assigns the run ID. A superseded version yields `409 HUNT_VERSION_SUPERSEDED` with
  `params.currentVersion`.
- Every run mutation needs `expectedRunRevision`; resume also needs `expectedInstallationRevision`.
  A stale value yields `409 RUN_REVISION_CONFLICT` / `INSTALLATION_REVISION_CONFLICT`: refresh, keep
  compatible drafts, do not auto-resubmit.
- Every mutation response contains `installationRevision`, the full authoritative `run` snapshot and
  `affectedRuns` (for example the run suspended by a switch). Never apply a response whose
  `run.revision` is lower than the one already stored.
- A wrong answer is `200` with `evaluation.result: "incorrect"` and an unchanged revision.
- `abandon` and `reveal` require `"confirm": true` in the body.
- At most 20 suspended runs per installation: a start that would exceed it returns
  `409 SUSPENDED_RUN_LIMIT` and changes nothing.

### What a snapshot contains

`RunSnapshot.checkpoints` holds only checkpoints up to the current target. A `reachable` checkpoint
exposes its coordinates and radius but no questions; `unlocked`/`resolved` ones expose exactly the
persisted selection. `SelectedQuestion` never contains accepted answers, tolerance, correctness
flags or unrevealed hints; `assistance` appears only after a confirmed reveal. `finale` reports the
two independent conditions (`questionsResolved`, `qrValidated`). Localized strings follow the
request's `Accept-Language`; IDs, order, hint cursor and progress do not depend on it, and no locale
is stored with a run.

### Location and QR input

`LocationFix` = `latitude`, `longitude`, `accuracyMeters`, `capturedAt` (ISO 8601 with offset).
Thresholds are exported as `PROXIMITY`. Failures are `422` with a specific code:
`LOCATION_TOO_FAR`, `LOCATION_ACCURACY_INSUFFICIENT`, `LOCATION_FIX_STALE`, `LOCATION_FIX_IN_FUTURE`.
Send the raw scanned text as `payload`; anything outside the grammar
`signal-hunt:qr:v1:<22-86 base64url chars>` is `422 QR_FORMAT_INVALID`, a valid token for another
cache is `422 QR_WRONG_CACHE`. Scanned text is never treated as a URL.

### Idempotency and uncertain outcomes

1. Generate and persist the `Idempotency-Key` (plus the locale used) before sending.
2. On a timeout, retry the **identical** request with the same key while the original body is still
   in memory; an accepted operation is replayed even if its fix is stale by then.
3. After a crash, do not persist or resend GPS/QR input. Call `GET /v1/operations/:key`:
   `committed` returns the original body (validate with `OPERATION_OUTCOME_SCHEMAS[operation]`);
   `unknown` is **not** proof of failure. Refresh `GET /v1/runs/:id` and `GET /v1/me`, then, if the
   effect is absent, send a new request with a new key and fresh input.
4. Reusing a key with a different body, route or locale is `409 IDEMPOTENCY_KEY_CONFLICT`.

Only successful operations are recorded. A rejected request (4xx/5xx) had no effect and its key may
be reused.

### Deletion

1. `POST /v1/me/deletion-receipt` → persist `receiptId` and `receiptProof` securely. Calling it again
   invalidates the previous pending receipt, so it is safe to repeat after a lost response.
2. `DELETE /v1/me` with `X-Deletion-Receipt-Id` deletes runs, selections and operation records and
   revokes the credential in one transaction.
3. If that response is lost, the credential now returns `401`. Confirm with
   `GET /v1/deletions/:receiptId` + `X-Deletion-Receipt-Proof` (`status: "completed"`), and only then
   clear local data. `404` means the receipt is unknown, wrong or expired: deletion is not confirmed.

The proof authenticates only that status lookup. It cannot read runs or mutate anything.

### Errors

Every non-2xx body is `{ code, messageKey, params, retryable, correlationId }`. `code` and
`messageKey` are stable and language-independent (`ERRORS` lists them with their HTTP status); the
client translates `messageKey` and interpolates `params`, which contain only safe values such as
thresholds or field paths, never submitted input. Status classes: 400 invalid input, 401 credential,
404 inaccessible (identical for "not yours" and "does not exist"), 409 state/revision conflict,
410 hunt unavailable, 413 body too large, 422 failed gameplay condition, 429 throttled (with
`Retry-After` and `params.retryAfterSeconds`), 503 transient.

## 4. Decisions on open specification points

| Topic (gate)                | Decision                                                                                                                                                                                                                                           | Evidence                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Versions (G01, server side) | Node 22.19, TypeScript 6.0, Fastify 5.12, Zod 4.6, Drizzle ORM 0.45, npm workspaces; packages are consumed as TypeScript source via `tsx`/Vitest (no build step)                                                                                   | `npm run check` on Windows 11                             |
| SQLite driver (G02)         | `better-sqlite3` 13 (synchronous). WAL, `foreign_keys=ON`, `busy_timeout=5000`. Each mutation is one `BEGIN IMMEDIATE` transaction; lock timeout maps to `503 SERVICE_UNAVAILABLE`                                                                 | `api-recovery.test.ts` "transactions"                     |
| Decimal strategy (G02)      | No library: input is parsed by a strict grammar into digit strings and compared as `BigInt` scaled integers. Comma or dot accepted from players; authored values use dot only                                                                      | `domain.test.ts`, `contracts.test.ts`                     |
| Unicode strategy (G02)      | NFC → collapse Unicode whitespace → `toUpperCase().toLowerCase()` → NFC. No NFKC and no diacritic stripping                                                                                                                                        | `contracts.test.ts` edge vectors                          |
| Geospatial utility (G02)    | `geographiclib-geodesic` 2.2 (Karney, WGS84) behind the `DistanceMeters` adapter                                                                                                                                                                   | reference vectors in `domain.test.ts`                     |
| OpenAPI (G02)               | Generated from `ROUTES` with Zod 4's `z.toJSONSchema`; no Fastify schema plugin                                                                                                                                                                    | `api-privacy.test.ts` "OpenAPI"                           |
| DTOs and errors (G04)       | As defined in `packages/contracts`. `huntVersion` is a positive integer; timestamps are ISO 8601 strings; request bodies are strict objects                                                                                                        | contract and API tests                                    |
| QR grammar (G04)            | `signal-hunt:qr:v1:<token>`, token 22-86 base64url characters; fixtures and `content:new-qr-token` use 256 bits. Server stores `SHA-256("signal-hunt:qr-token:v1:" + token)` bound to (hunt, version)                                              | `contracts.test.ts`, `api-gameplay.test.ts`               |
| Resource limits (G04)       | The proposed capacities are adopted as `LIMITS` (incl. draw count 1-5 and 20 suspended runs). Body limit 16 KiB, request timeout 15 s. Rate limits per client IP: 300/min overall, 120/min for mutations, 20/h for provisioning (all configurable) | `content.test.ts`, `api-identity.test.ts`                 |
| Idempotency retention (G05) | Outcomes are kept 7 days after commit (`IDEMPOTENCY_RETENTION_DAYS`), removed only by `npm run maintenance` or with their installation. Fingerprints are HMAC-SHA-256 under `FINGERPRINT_SECRET`                                                   | `api-identity.test.ts` maintenance, `api-privacy.test.ts` |
| Deletion receipts (G05)     | Proof = 256 random bits, stored as SHA-256. Pending receipts expire after 24 h; completed ones are kept 30 days as an identity-free tombstone                                                                                                      | `api-identity.test.ts` "deletion"                         |
| Operational logs (G05)      | One allowlisted JSON line per request to stdout: correlation ID, method, route pattern, status, error code, duration. The server writes no log files, so retention is whatever the operator's terminal/collector keeps                             | `api-privacy.test.ts`                                     |

Further implementation choices worth knowing:

- **Content storage.** Each immutable version is stored as one validated JSON document in
  `hunt_versions` with its digest, instead of separate checkpoint/question/choice/hint tables. Runs
  reference versions by foreign key and questions by stable ID. Readiness re-verifies every digest.
- **Expiry at the API boundary** deletes the expired installation immediately. That request gets
  `INSTALLATION_EXPIRED`; later ones get `CREDENTIAL_INVALID`.
- **Check order for mutations:** ownership (404) → run state (`RUN_TERMINAL`, `RUN_NOT_ACTIVE`) →
  revision → availability → action-specific prerequisites → transient input.
- **Availability** blocks start, resume, unlock, answer, hint, reveal and scan. Reads, suspend,
  abandon and deletion stay available. Replays of already accepted operations still return their
  recorded outcome.

## 5. Content release

Content is published only by deployment: there is no upload, import or admin endpoint.

```text
<content-dir>/release.json                     current version + availability per hunt
<content-dir>/hunts/<huntId>/v<version>.json   one immutable version (schema: packages/content-tools/src/schema.ts)
<content-dir>/media/...                        optional images referenced by media[].file
```

`npm run content:load` validates the whole directory, then in one transaction registers new
versions and applies `release.json`. It refuses, changing nothing, when a registered version's
content differs from its digest or a registered hunt disappears from the release. To withdraw a hunt
set `"available": false` with an `unavailableReason` (`withdrawn`, `maintenance`, `safety`) and load
again. Validation covers IDs and references, coordinates and radii (15-150 m, reason required when
not 40), pool and draw counts, complete `pl`/`en` text for every field, exactly one correct choice,
alias and decimal syntax, hint limits, media paths/alt text/provenance, QR token format, and one QR
token never serving two hunts. Human review is still needed for meaning (for example that final
questions are about the surroundings).

For real content, author files under `content/private/` (git-ignored), set
`CONTENT_DIR=content/private`, and generate tokens with `npm run content:new-qr-token`. The raw
token exists only in the private source file and on the printed code.

## 6. Privacy properties

- Player fixes, submitted answers and scanned payloads are used in memory and discarded. They are
  not written to any table and not logged; idempotency rows hold an HMAC and the public response.
- `run_checkpoints` and `run_finales` store only "unlocked at", "resolved at" and "QR validated at".
- Logs never contain URLs, headers or bodies. Internal errors log the error class and driver code
  only, because driver messages can embed query parameters.
- Public DTOs are built field by field from private content and then parsed by the response schema,
  which strips anything undeclared.

## 7. Retention, expiry and maintenance

An installation expires 180 days after its last authenticated request (health checks and catalog
browsing do not count). Expiry happens when the stale credential is next presented and through
`npm run maintenance`, which also purges idempotency outcomes older than the retention period,
expired pending deletion receipts and completed receipts older than 30 days. Nothing runs
automatically: schedule the command yourself (Task Scheduler, cron) on the machine hosting the demo.
There are no backups. SQLite does not guarantee erasure of deleted rows from free pages or copied
files.

## 8. Not implemented or not verified

- No Expo application, screens, sensors, scanner or map code. No React Native or Expo dependency was
  installed, so compatibility of `@signal-hunt/contracts` with Metro/Hermes is **unverified**; it uses
  only Zod 4, `String.prototype.normalize` and standard regular expressions.
- No real-device or field validation of the GPS thresholds (gates G03, G07, G08).
- Media: content validation and `MediaRef` (ID + alt text) exist, but there is no endpoint that
  serves image bytes and the fixtures contain no images. Authorized media delivery is undecided.
- Rate limits are per client IP in process memory; they reset on restart.
- Verified on Windows 11 with Node 22.19 only.
