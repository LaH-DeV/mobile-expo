# Technical Specification

Read the [product specification](product-specification.md) for R01-R26 and the [verification plan](verification-plan.md) for acceptance criteria and implementation prerequisites.

## 1. Architecture and ownership

Use a modular monolith, not microservices. One Fastify API process owns gameplay and one persistent server SQLite database. Mobile consumes public contracts and renders state; it never owns answer validation, random draws, or completion authority.

```text
apps/
  mobile/                    Expo application
  server/                    Fastify application and private domain modules
packages/
  contracts/                 Safe Zod schemas, inferred types, stable error codes
  content-tools/             Private-input validation and deployment preparation
specifications/              Product, technical, and verification specifications
```

Use npm workspaces and local package-name imports such as `@signal-hunt/contracts`, with no registry publishing required. Mobile and server remain separately runnable applications.

### Dependency rules

- Mobile may depend on public contracts, never server code or content-tools.
- Contracts may depend on runtime-neutral schema utilities, never database/native/Node-specific modules.
- Server domain rules do not depend on Fastify request objects, Drizzle tables, or Expo.
- Application use cases coordinate domain rules and repository transactions.
- Fastify routes adapt validated requests into use cases and map safe results/errors to HTTP.
- Database, clock, randomness, token hashing, and content loading are adapters behind explicit boundaries.
- Do not introduce a generic repository framework, microservice bus, or dependency-injection container without a concrete need.

## 2. Mobile organization

Organize by feature: discovery, hunt details, runs, checkpoint play, finale, journal, settings/privacy. Within a feature keep UI, application hooks, and data access separate where behavior warrants it; avoid ceremonial empty layers.

Expo Router route files compose screens, not gameplay rules. TanStack Query owns remote request/cache orchestration. Component state owns temporary UI state. SQLite stores safe snapshots, drafts, and pending request identities. Do not add a global state library by default.

Define replaceable ports for:

| Port              | MVP responsibility                                                                             | Future replacement boundary                                      |
| ----------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| NavigationGateway | Open checkpoint in external navigation; report missing handler                                 | External routing provider/platform changes                       |
| MapPresentation   | Render regional OSM basemap and public starts/current target; pan/zoom/recenter; text fallback | Replace renderer/data source without changing gameplay contracts |
| LocationProvider  | Foreground fix/heading, permission and accuracy states                                         | Native/provider changes without coupling screens to SDK details  |
| CodeScanner       | Parse supported payload and report camera/scanner state                                        | Alternate scanner adapter, not an authority bypass               |
| CredentialStore   | Read/write anonymous credential through OS secure storage                                      | Platform implementation and test adapter                         |
| RunCache          | Persist safe confirmed snapshots/drafts/pending keys                                           | SQLite implementation, migrations, test storage                  |
| HuntApi           | Typed public API methods and error mapping                                                     | Transport implementation without exposing private server models  |

MapPresentation accepts only public start-point DTOs or an authorized current-target DTO, not the private hunt/checkpoint model. It does not request location, draw routes, or mutate progress. Use a proven geospatial calculation utility for distance/bearing rather than inventing geodesic formulas. Exact library selection is a compatibility gate.

### Native package status

Use Expo Router and TanStack Query. Adapters to verify before installation: expo-location, expo-camera, expo-sqlite, expo-secure-store, React Native Linking, and MapLibre React Native for embedded maps. Native dependencies must work with the selected stable Expo SDK, both target platforms, and development builds. Do not guarantee Expo Go compatibility. Verify local GeoJSON/style loading, gesture/lifecycle behavior, attribution, and accessibility in actual MapLibre development builds before claiming native map support.

No paid map account, routing API key, public tile service, paid tunnel, background-location package, analytics SDK, or push service is required for the regional local demo.

### Regional map delivery

- Separate the renderer from the basemap source. The HTML sketch vendors Leaflet 1.9.4 and loads a local JavaScript-wrapped GeoJSON extract so it works directly from disk. The Expo app will use MapLibre native sources/layers with a regional GeoJSON/style asset packaged locally or served by the configured local static asset host. Leaflet is not the native implementation.
- The sketch's real OSM data covers longitude 21.006-21.015 and latitude 52.228-52.234 in central Warsaw. Fictional hunt landmarks are not assertions about actual objects, accessible paths, or container placement. A simplified ways-only dataset omits relations/POIs and is not usable as a routing graph.
- Build-time acquisition uses an appropriately small OSM bounding-box data extract, not public raster tiles. Keep the extract's source URL, coverage, snapshot timestamp, license, and transformation script. Publish the derived dataset under ODbL with contributor attribution; keep vendor licenses separately. Do not send contributor account metadata to clients unnecessarily.
- Package all required style/font/sprite/data assets locally; no hidden CDN, analytics, font, or tile requests. Display linked OpenStreetMap attribution on every map in both themes. Expose coverage and text/list alternatives; renderer or asset failure must not block otherwise permitted gameplay. Dispose map instances on unmount and react to theme/size changes without losing drafts.
- Regional GeoJSON is adequate for this small demo, not a scalable worldwide basemap. Extending coverage requires obtaining a licensed regional extract, generating appropriate vector tiles/styles, and serving those assets from a self-hosted static/tile service. Keep tile/source URLs configurable and independent from domain/API contracts; test memory, load time, and native compatibility for the new dataset. No global tile infrastructure is implemented by the sketch.
- Map assets contain general basemap geometry, never checkpoint IDs, hidden target markers/lines, answers, QR tokens, or private hunt annotations. Only authorized marker data is supplied at runtime. Do not include player position or bearer credentials in map URLs. Disable unnecessary map-host access logs. A third-party source is a deliberate privacy/terms decision, not an automatic failure fallback.
- Stored map geometry does not enable offline unlocks, answers, scans, or completion. External navigation remains the routing action; MapLibre and Leaflet are renderers, not routing engines. Do not bulk-download, prefetch, or bundle tiles from `tile.openstreetmap.org`.

### Localization

- Maintain complete `pl` and `en` UI dictionaries with stable English semantic keys such as `checkpoint.location.tooFar`. English keys are identifiers, not a substitute for English translations.
- Resolve supported device locale initially, with Polish fallback; persist an explicit settings override. Include navigation labels, permissions rationale, errors, accessibility labels, confirmations, plural forms, and locale-aware number/date formatting.
- API error codes and message keys are language-independent; the client translates keys and safe structured parameters. Do not return hardcoded Polish or English UI sentences as the API contract.
- Content declares both `pl` and `en` variants. Localized title/story, prompts, choices, hints, reveal text, access notes, and image alternatives must be complete in both. Stable question/choice IDs, pool/draw structure, ordered hints, and location facts must match between translations. Accepted answer aliases remain private and language-scoped.
- Settings owns the only language preference. Resolve every content view and submission from that preference, including existing runs and history; do not persist an independent run locale or expose a hunt-language selector. Language changes preserve the pinned content version, selected IDs/order, hint cursor, resolutions, QR state, and drafts.
- Send the current Settings locale as `Accept-Language: pl` or `Accept-Language: en` on localized API reads and gameplay requests; the server validates it and selects the corresponding representation or answer aliases. Locale is request context, not run identity/state. Capture it with pending request/idempotency metadata: a language change must not reinterpret or resubmit an in-flight answer under a different locale. Reconcile its original result, then refresh localized content in the current Settings language.
- Key cached localized content by hunt version and content locale. Missing UI keys fail translation checks; missing content translations are not silently substituted. Include bilingual digital and QR synthetic fixtures.
- Select an Expo-compatible localization library during dependency review; it must support interpolation, pluralization, and React Native without introducing a server/native dependency into contracts.

## 3. Server modules

| Module         | Owns                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| Installations  | Anonymous provisioning, credential verification, activity/expiry, deletion |
| Catalog        | Safe discovery metadata, availability, immutable hunt versions             |
| Runs           | Ownership, active/suspended/terminal states, revisions, switching, history |
| Checkpoints    | Ordered reachability, proximity gate, saved question selection             |
| Questions      | Text/numeric/choice evaluation, hints, assisted resolution                 |
| Finales        | QR parsing/binding/hash verification, final completion conditions          |
| Content        | Private source validation and deployment-time version registration         |
| Infrastructure | SQLite, migrations, safe logging, rate limits, clocks, randomness          |

Use Fastify + TypeScript + Zod + Drizzle + SQLite. Exact SQLite driver, schema integration plugin, decimal comparison tool, and geospatial utility require compatibility review. A synchronous driver such as better-sqlite3 is a candidate to evaluate.

## 4. Trust model and credentials

The server, not mobile, owns authoritative progression. Keep accepted answers and unrevealed content out of mobile builds, shared packages, public asset manifests, and unauthenticated API responses.

Anonymous provisioning issues a cryptographically random 256-bit opaque credential. Store only its verifier hash in the server database and the raw credential in device secure storage. A credential authenticates an installation, not a verified human. Never authorize by run ID alone. No player-list or public admin endpoint.

Provisioning can fail after server creation but before device secure persistence. Do not proceed to start a run until secure persistence succeeds. Retry may create an orphan anonymous installation; rate limits and inactive-identity expiry handle it. Do not log or persist raw provisioning-response credentials in idempotency payloads.

Secure-storage persistence can differ across uninstall/reinstall and device backup behavior. Never promise uninstall clears credentials or recovers progress. Explicit in-app reset is the supported deletion path. If a credential is invalid/expired, explain that recovery is unavailable; discard stale authenticated snapshots only through an explicit reset/reinitialization flow, not by mislabeling them as live server state.

A client can spoof coordinates, alter device clocks, copy static QR codes, or request answer assistance. This design prevents trivial answer delivery and unauthorized run access, not determined cheating. No competition or prize integrity claim.

## 5. State machines and invariants

### Run state

```text
start -> active
active -> suspended -> active
active/suspended -> abandoned
active -> completed
completed/abandoned -> terminal
replay -> new active run, not a mutation of a terminal run
```

Only active runs can perform gameplay mutations. A single transaction switches active runs, revising both affected runs and the installation lifecycle revision. Enforce at most one active run with a database constraint, not just a UI check.

### Checkpoint state

```text
unrevealed -> reachable -> unlocked -> resolved
```

- Reachable exposes coordinates, not the question pool.
- Unlock validates proximity, persists a distinct question selection, and reveals only selected question DTOs.
- Questions within the selected set can be answered in any order.
- A question resolves correctly or with assistance; hints alone do not resolve it.
- A normal checkpoint resolves when all selected questions resolve.
- A physical final checkpoint also requires its valid QR condition.
- Resolution exposes only the next checkpoint. Completing the final checkpoint atomically completes the run.

### Core invariants

1. Every run belongs to one installation and one immutable hunt version.
2. At most one active run per installation; suspended runs do not lose selections.
3. Only the current reachable checkpoint can unlock.
4. No pool question is selected twice in one checkpoint selection.
5. Draw count is between 1 and pool size and never changes within a run.
6. A retry cannot draw new questions, advance twice, consume another hint, or create another run.
7. No answer, hint, reveal, or QR operation bypasses its prerequisite state.
8. Terminal runs cannot be resumed, answered, or rewritten by delayed requests.
9. QR and question conditions are independent facts; completion requires their conjunction when applicable.
10. No raw player location, accepted-answer data, or cache token is stored in public snapshots/logs.
11. Availability gates progression, not the ability to view history, suspend, abandon, or delete.

## 6. Authoritative transactions and idempotency

For gameplay mutations use a persisted random idempotency key and expected run revision. For start/resume/switch operations also require the installation lifecycle revision so racing requests cannot activate two runs. Starting/replaying creates a run; clients cannot choose authoritative run IDs.

Request processing order:

1. Validate bounded input and authenticate installation.
2. Check ownership, idempotency-key scope, and request fingerprint.
3. If already accepted, return the recorded safe outcome without repeating effects. A mismatched payload/key is a conflict. Include current availability/state context where necessary without rewriting the historical outcome.
4. In a database transaction validate expected revisions, availability, active/prerequisite state, and any required fresh location.
5. Apply domain changes, persist selections/progress and safe idempotency result, increment affected revisions, and commit atomically.
6. Return safe authoritative snapshots and affected-run/lifecycle revisions.

Recheck idempotency inside the transaction and enforce unique operation keys so concurrent duplicates cannot both apply. Provide an owned operation-status lookup by key; after process termination the client can retrieve a committed safe outcome without retaining or resending raw GPS/QR data. An unknown key is not proof that an in-flight request failed. Refresh run/lifecycle state and reconcile before retrying; a newly acquired fix with changed input must never silently overwrite an accepted key's fingerprint.

No network/media fetch occurs inside a database write transaction. Never put raw coordinates or tokens in persisted idempotency bodies. Fingerprints can hash sensitive input with server-side secret material instead of storing it; safe response records contain only public result data. Evaluate replay of accepted requests before rechecking transient fix age, otherwise a timeout retry could incorrectly fail an already committed unlock. A new unaccepted request still requires fresh valid data.

Stale revision returns 409 and a refresh path. Duplicate accepted requests return the existing outcome even if the original response was lost. A withdrawal prevents new effects but does not erase committed history. Bound idempotency storage and retry lifetime explicitly during implementation review; do not silently discard unresolved pending requests on an undocumented timer.

Mobile persists request identity before sending, never claims optimistic completion, refreshes after reconnect/focus, and does not automatically submit queued stale GPS mutations. Draft answer input is not a persisted accepted answer. Request timeouts do not establish whether a transaction committed.

## 7. Persistence model

Use SQLite on server and mobile, with separate databases and migration histories. Use Drizzle on the server. Mobile does not replicate server tables or store private content.

### Server logical entities

| Entity              | Important data and constraints                                                             |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Installation        | ID, token hash, lifecycle revision, created/last-active timestamps                         |
| Hunt                | Stable ID, current published version, availability and safe reason                         |
| HuntVersion         | Immutable version/content digest, available locales, localized metadata, ordered structure |
| Checkpoint          | Version FK, order, coordinates, radius/reason, draw count, finale mode                     |
| Question            | Checkpoint FK, stable ID, type, localized prompt and private language-scoped evaluation    |
| Choice              | Question FK, stable ID, display text; private correctness separate from DTO                |
| Hint                | Question FK, ordered text                                                                  |
| Media               | Version-bound safe reference, accessibility text, provenance/access policy                 |
| CacheVerifier       | Finale/version binding, token hash; no public raw token                                    |
| Run                 | Installation/version FK, state, revision, start/update/completion timestamps               |
| RunCheckpoint       | Run/checkpoint FK, unlock/resolution facts; no retained player coordinates                 |
| SelectedQuestion    | Run/checkpoint FK, selection order, stable question ID, resolution mode, hint cursor       |
| SelectedChoiceOrder | Persisted option order for a selected multiple-choice question                             |
| RunFinale           | Validated QR fact/timestamp; not a raw code or location                                    |
| IdempotencyResult   | Installation/operation/key, private-input fingerprint, safe outcome/revisions              |
| DeletionReceipt     | Restricted hashed receipt verifier and deletion status, no gameplay authority              |

Use foreign keys, uniqueness constraints, and a partial unique index or equivalent enforcing one active run. Parameterize all queries. Configure WAL and bounded busy timeout after driver verification; test lock contention and atomic rollback. No horizontal scaling or shared-network SQLite write deployment claim. Keep the database file outside replaceable application build output.

### Device logical storage

- Safe catalog/detail snapshots with version, content locale, last refresh time, and availability knowledge.
- Safe run/question snapshots already authorized by the server.
- Draft inputs keyed by run/checkpoint/selected question.
- Pending operation key, request fingerprint metadata, and recovery state without retained raw GPS fixes.
- Local deletion progress/receipt capability protected according to its sensitivity.
- Persisted app-language preference shared by UI and hunt content, plus local UI settings; system appearance is the theme default.

Credential belongs only in secure storage. Raw QR scan values are transient; recover scan confirmation through idempotency/server state and otherwise rescan. Raw GPS fixes are transient; a rejected or new action obtains a new fix. Clear snapshots/drafts on confirmed deletion and never reuse them for a new identity.

## 8. Public API surface

Use versioned JSON REST endpoints under `/v1`, Zod-validated requests/responses, and a generated/validated OpenAPI description. The routes below define the API surface; exact DTO field names are specified in the contracts package before implementation. Mobile imports schemas/types through its local package, not server entry points.

| Method/path                                           | Purpose and guards                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| GET /health                                           | Process liveness; no secret/config/database-path disclosure                          |
| GET /ready                                            | Database/schema/content readiness; no private diagnostics                            |
| GET /v1/hunts                                         | Safe available catalog, bounded search/pagination                                    |
| GET /v1/hunts/:huntId                                 | Safe details/start location/current availability, no future pools                    |
| POST /v1/installations                                | Issue anonymous credential; strict provisioning rate limits                          |
| GET /v1/me                                            | Installation lifecycle revision and safe identity status                             |
| GET /v1/operations/:operationKey                      | Owned committed safe outcome, or unknown status that does not imply failed execution |
| GET /v1/runs                                          | Owned active/suspended/history summaries, bounded pagination                         |
| POST /v1/runs                                         | Start/replay a version, suspend previous active transactionally                      |
| GET /v1/runs/:runId                                   | Owned safe snapshot and availability, no hidden pool/answers                         |
| POST /v1/runs/:runId/resume                           | Resume and atomically suspend other active run                                       |
| POST /v1/runs/:runId/suspend                          | Preserve run state without abandonment                                               |
| POST /v1/runs/:runId/abandon                          | Confirmed terminal transition                                                        |
| POST /v1/runs/:runId/checkpoints/:checkpointId/unlock | Active/reachable/available, fresh proximity, saved draw                              |
| POST /v1/runs/:runId/questions/:selectedId/answer     | Active/unlocked/owned selection; validate private answer                             |
| POST /v1/runs/:runId/questions/:selectedId/hint       | Reveal next authored hint once                                                       |
| POST /v1/runs/:runId/questions/:selectedId/reveal     | Confirm assistance; return explicit answer display/explanation                       |
| POST /v1/runs/:runId/finale/scan                      | Parse supported QR, fresh proximity, correct cache binding                           |
| POST /v1/me/deletion-receipt                          | Prepare restricted deletion capability while authenticated                           |
| DELETE /v1/me                                         | Delete live activity and revoke credential, repeat-safe via deletion receipt         |
| GET /v1/deletions/:receiptId                          | Status with restricted receipt proof; never gameplay authorization                   |

Bearer credential is required except safe catalog/health/provisioning and separately authenticated deletion status. A deletion receipt identifier alone is not a capability; the proof is private and redacted. Never put either bearer credential or receipt proof in a URL. Deletion setup may be repeated safely after an interrupted response.

### Public DTO rules

- Catalog/detail: safe localized metadata, available content locales, start coordinates, immutable version, availability, authorized media only.
- Run creation: no independent content-locale field; use the Settings-derived request locale and reject unsupported locales rather than silently falling back.
- Run snapshot: state/revision, pinned version, revealed checkpoints, selected questions/options, question resolutions, revealed hints, finale conditions, timestamps. Localized fields follow the request locale; cache representation locale separately from run state and use `Vary: Accept-Language` where HTTP caching applies.
- Question DTO: prompt/type and selected ordered choices; no correctness flags, accepted aliases/tolerance configuration that exposes answers, undisclosed hints, or entire pool.
- Reveal response intentionally returns its authored answer display/explanation after authorized confirmation.
- Mutation response: authoritative safe snapshot/outcome, affected run revisions, lifecycle revision when applicable.
- Location input: latitude, longitude, horizontal accuracy, fix timestamp; validate transiently and discard.
- Never accept client-computed distance, assisted/completed flags, chosen random selections, or QR success flags as authoritative.

### Errors

Use a stable envelope containing code, English semantic message key, safe interpolation parameters, retryability, and correlation ID. Mobile renders the key in the selected UI language. Do not include raw submitted input. Distinguish invalid input (400), invalid/expired credential (401), inaccessible resource (non-enumerating 404), conflict/state/revision (409), unavailable content (410), failed gameplay condition (422), throttling (429 with retry information), and transient service failure (503). Wrong answers are an expected structured evaluation result, not an internal exception. Internal errors reveal no stack/SQL/answer/token data. Rate limits are not permanent bans; unlimited puzzle attempts means no gameplay attempt cap, not unlimited HTTP traffic.

## 9. Content schema and release process

Private sources contain stable IDs, immutable version/digest, available language variants with localized title/story/metadata and access notes, start coordinate, finale type, and ordered checkpoints. Questions carry type, localized prompt/choices/hints/reveal text, private language-scoped evaluation configuration, and optional safe image references. A physical final checkpoint has a QR-token binding and final surroundings question pool.

Validation before deployment must reject:

- Duplicate/missing IDs, invalid references, empty pools, impossible draw counts, missing final questions.
- Invalid coordinates/radii, missing radius-change reason, negative estimates or numeric tolerances.
- Multiple/no correct single-choice options, invalid aliases, ambiguous/unsupported numeric syntax.
- Invalid QR format, duplicate unintended cache binding, exposed raw secret in public outputs.
- Missing alternative text/provenance, path traversal, executable HTML, unsupported media.
- Unsupported locale identifiers or incomplete published language variants, including prompts, choices, hints, reveal text, and text alternatives.
- Modification of an existing version's immutable content, or removal of a referenced version.

Build public DTOs through allowlists, never by deleting a few private fields from a domain object. Unrevealed image assets require authorization or a deployment layout that does not expose their listing/references; do not assume obscure filenames provide security. Strip sensitive image metadata and avoid clue answers in file paths. Cover art must be owned/licensed and show no sensitive answer material.

Publishing is part of backend deployment, not a runtime upload/import API: validate private files, generate safe artifacts, migrate/register immutable versions transactionally, and start serving only when readiness passes. Preserve existing referenced content and verify version digests. Availability changes are deployed metadata; active runs stay pinned but new progression is rejected when unavailable. Local synthetic digital and QR fixtures exercise both finale modes.

If the Git repository is public, real content is gitignored or supplied from a private source. Public examples remain clearly synthetic; never claim their accepted answers are secret. Do not ship real answer files in mobile assets or the contracts package.

## 10. Numeric, text, geospatial, and QR details

- Normalize text with a deterministic Unicode/case-fold strategy shared only as public algorithm semantics; accepted aliases remain private. Exact normalization form and edge vectors need a tested implementation decision before coding.
- Parse decimal input with a decimal-safe representation/library; compare exact decimals or explicit absolute tolerance, not JavaScript binary-float equality. Reject mixed comma/dot grouping and non-finite values.
- Use a proven geospatial utility for meters/bearing. Field-test reference vectors and strict boundary behavior. Accuracy is an additional gate, not a radius extension.
- Use cryptographic randomness for question selection and tokens. Sampling without replacement must be unbiased; persist results transactionally before responding.
- QR payload is versioned and app-specific with at least 128 bits of random token entropy. Token is hashed server-side and bound to the version/finale. Never launch links from scans. Exact encoded grammar is reviewed with contracts before QR fixtures are printed.
- Keep both user assistance and QR/GPS failure semantics explicit. A hint/reveal request cannot change a run's saved random draw.

## 11. Privacy, expiry, and deletion

No player-coordinate persistence or body logging on proximity endpoints. Catalog distance sorting runs locally. Log only allowlisted operational fields such as correlation ID, safe route/error code, timing, and redacted status. No third-party telemetry. Return precise diagnostics to a player only where safe; never expose accepted answers through validation errors.

Expire installations inactive for 180 days and cascade their runs/idempotency records. Define activity as authenticated player use, not background health checks; expire at the API boundary and through a local maintenance command so old identities are not accidentally revived. Explain expiration before any reset. Automated maintenance deployment is local-only and documented, not an assumed hosted cron service.

Deletion workflow:

1. User confirms; client obtains/persists a restricted deletion receipt while still authenticated.
2. Server transaction deletes the installation's live activity and revokes credential, preserving only minimal restricted deletion status needed for recovery.
3. Client confirms status through the receipt if the response is lost, then clears secure/local gameplay data.
4. If any step fails, retain pending state and clearly distinguish requested from confirmed deletion.
5. Receipt does not permit reading runs, restoring identity, or creating gameplay mutations. Its storage/expiry is a pre-implementation security gate.

No backup by default for local demo. If backups are later enabled, encrypt them, expire within 30 days, keep deletion tombstones separately where necessary, and apply them before a restore is reachable. This is not a claim of secure forensic erasure from SQLite free pages or previously copied files; prefer data minimization and appropriate platform storage protection.

## 12. Local development and operational boundary

- Document npm workspace install, environment examples without secrets, migrations, synthetic fixture setup, API/mobile start commands, and database reset for development only.
- Configure API base URL per environment. On a physical phone, localhost is the phone, not the development computer. Use a reachable LAN address and explicit development-only HTTP policy where necessary.
- Supported native target is an Expo development build. Test permission, camera, heading, foreground/background, and secure storage on real Android/iOS.
- Keep server SQLite persistent across application restarts; use one API writer instance, bounded transactions, WAL/busy-timeout tests, and readiness checks.
- No paid tunnel, managed database, content feed, map key, or third-party authentication requirement. If outside-network play is later needed, revisit hosting/TLS/operations explicitly.
- Public exposure requires HTTPS and a separate release/operations review; LAN development exceptions must not silently ship as public deployment policy.
- Validate required environment/schema/content at startup; fail readiness safely rather than serve corrupt or mismatched versions.
- No runtime flag can enable fake GPS/QR in a normal build. Test adapters are excluded at build composition.

Define exact scripts, configuration names, package versions, SQL schema, and DTO fields alongside implementation. Setup instructions must describe commands that actually exist.
