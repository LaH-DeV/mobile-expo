# Verification Plan

Requirements are defined in the [product specification](product-specification.md); architecture and API are in the [technical specification](technical-specification.md).

This plan defines the tests and evidence required for implementation. Specification checks do not replace native compatibility or gameplay tests.

## 1. Verification layers

| Layer                      | Tool/direction                                             | Focus                                                                                                         |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Static                     | Strict TypeScript, formatter/linter, dependency boundaries | Runtime-neutral contracts, no mobile-to-server/private imports                                                |
| Domain unit                | Vitest                                                     | State transitions, normalization/decimal matching, unbiased distinct selections, hints, GPS gates, completion |
| API integration            | Fastify injection, isolated migrated SQLite                | Ownership, schema, public DTOs, transactions, idempotency, conflicts, expiry/deletion                         |
| Device-storage integration | SQLite/SecureStore adapters and test implementations       | Migrations, crash recovery, safe drafts, credential handling                                                  |
| Component                  | React Native Testing Library                               | Loading/error/stale/permission states, confirmation flows, accessible controls                                |
| Automated journey          | Maestro with test-build GPS/QR adapters                    | Complete digital and QR runs, restart, suspension, failures                                                   |
| Real-device                | Android and iOS field checks                               | Actual location, camera, heading, external navigation, lifecycle, network, accessibility                      |
| Content/build              | Schema and artifact validation                             | Immutable versions, private/public separation, media provenance and metadata                                  |

Do not set an arbitrary coverage percentage. Tests must exercise high-risk rules and every requirement below. Simulated GPS/QR is not a substitute for real-device evidence.

## 2. Requirement-to-acceptance matrix

| Requirement | Case | Acceptance evidence                                                                                                                                                                                      |
| ----------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01         | A01  | Android/iOS builds; Polish/English key parity; one persisted Settings language controls UI, hunt content, existing runs/history and answer aliases without resetting progress; tested OS matrix          |
| R02         | A02  | Map/List share search/results; public start markers open details; accessible list survives map failure/out-of-coverage; denied location still browses; nearest sort sends no browsing coordinates        |
| R03         | A03  | Details expose start map/text coordinates, metadata, content language and connectivity/GPS/camera expectations; map failure does not block start                                                         |
| R04         | A04  | Current-only target map; pan/zoom/recenter; attribution/coverage; map failure fallback; known distance/bearing vectors; unavailable heading; external handler; foreground refresh                        |
| R05         | A05  | No signup; opaque credential secured, no credential in SQLite/logs; provisioning storage failure safe                                                                                                    |
| R06         | A06  | Switch/resume preserves state; concurrent starts yield one active run; abandon terminal; replay separate                                                                                                 |
| R07         | A07  | Future coordinates/pools/media and accepted answers absent from unauthorized responses/artifacts and map adapter inputs/layers/labels/asset annotations                                                  |
| R08         | A08  | Threshold boundary vectors; invalid/stale/inaccurate/denied fixes block; no manual bypass; field measurements                                                                                            |
| R09         | A09  | Draw count/range validation; distinct sampling; retry/restart cannot redraw; saved choice order                                                                                                          |
| R10         | A10  | Polish/English language-scoped aliases, preserved diacritics, decimal comma/dot, tolerance boundaries, choice IDs, malformed answers                                                                     |
| R11         | A11  | Ordered hints repeat-safe; confirmed reveal resolves as assisted; hints alone do not; no GPS/QR bypass                                                                                                   |
| R12         | A12  | Digital completion; QR then questions and reverse order; neither single condition finishes a physical finale                                                                                             |
| R13         | A13  | Correct/wrong QR, format, camera denial, network/stale fix, no URL execution/manual bypass                                                                                                               |
| R14         | A14  | Airplane/API failure preserves snapshot/draft; stale labels; no optimistic completion or automatic stale submission                                                                                      |
| R15         | A15  | Active/suspended/completed/abandoned journal; hints/assistance; no fake completion after timeout                                                                                                         |
| R16         | A16  | Team deployment path validated; no editor/admin API; public fixtures synthetic; private answers not bundled                                                                                              |
| R17         | A17  | Version update preserves active/suspended selection; withdrawal blocks effects but allows history/abandon/delete                                                                                         |
| R18         | A18  | Invalid/incomplete localized content rejected; translated alternatives/provenance checked; no hidden-content asset leaks                                                                                 |
| R19         | A19  | No background tracking/telemetry/external map requests for bundled source; no player coordinates/credentials in map asset URLs; logs/idempotency storage contain no raw location, answer, QR, credential |
| R20         | A20  | Lost-response deletion retry, local cleanup failure, expiry at 180 days, optional-backup deletion restore semantics                                                                                      |
| R21         | A21  | Cross-installation access denied; input/rate limits; secret-safe errors; normal public config rejects insecure transport                                                                                 |
| R22         | A22  | Screen reader, large text, contrast, reduced motion, non-color states, touch targets, light/dark in core flows                                                                                           |
| R23         | A23  | Just-in-time permissions; denied/restricted/services-off/approximate location; background stops watchers/camera                                                                                          |
| R24         | A24  | Transaction rollback, duplicate/in-flight requests, stale revisions, terminal race, kill/resume recovery                                                                                                 |
| R25         | A25  | Fresh documented local setup, real phone LAN access, persisted DB; test-only adapters absent from normal build                                                                                           |
| R26         | A26  | Applicable implementation prerequisites satisfied with evidence; no unsupported compatibility/performance claims                                                                                         |

## 3. Discriminating behavior scenarios

### Interface and hunt languages

Compare Polish and English dictionary keys, interpolation parameters, plural cases, permission rationale, accessibility labels, and error states. Fail checks for missing translations or raw message keys rendered as copy. Verify initial supported-device locale, Polish fallback, persisted manual language selection, and long English/Polish text at large font sizes in light/dark themes.

Verify that details has no separate hunt-language selector. Change Settings between Polish and English before start, during active/suspended runs, and when viewing history. Titles, checkpoint/map labels, questions, choices, previously revealed hints, and explanations must all follow Settings. Preserve version, selected question/choice IDs and order, hint usage, progress, QR state, and unsent drafts. Newly submitted text answers use aliases for the current Settings language; an already pending submission retains its captured request language and is not automatically resubmitted after switching. Reload and resume must retain the setting without restoring a legacy run locale. Cached localized content must not appear under the wrong language. Publication rejects missing Polish/English translations or structurally mismatched variants. Run bilingual digital and QR fixtures in both languages.

### Embedded regional maps

Check discovery Map/List search parity, selection, empty results, denied location, accessible alternatives, and view persistence. Details shows only the public start; an active run shows only its authorized current target. Inspect adapter inputs and rendered layers, labels, popups, styles, and bundled assets for future checkpoint annotations. A generic OSM street/building is not a hunt annotation and must not carry private checkpoint metadata.

Verify nonblank geometry, readable attribution link, coverage limits, pan, zoom, recenter, light/dark/System switching, Polish/English names, and narrow/large-text layouts. Validate asset failure and out-of-coverage fallbacks without losing drafts or changing progress. Simulate offline mode: bundled maps remain displayable, but mutations still fail according to R14. Observe runtime network traffic; bundled maps must make no external asset requests. Attribution links may leave the app only when explicitly selected.

Verify ODbL provenance and derived-data availability plus the renderer's vendor license. Regenerate the small dataset with the documented pipeline and verify bounds/features. The HTML prototype is not native evidence: separately build MapLibre with the selected Expo SDK, load local data/styles on both platforms, test map resize/unmount/background lifecycle, touch/keyboard/screen-reader alternatives, and measure performance before increasing coverage.

### Strict location boundary

For a 40 m checkpoint, test distance below/at/above 40 m independently of accuracy; accuracy exactly 25 m vs above; fix age exactly 15 seconds vs above; future timestamp up to 5 seconds vs above. Accuracy must never silently increase permitted distance. Invalid numeric values/coordinates, missing fields, and clock skew need safe failures. A 20-second unsuccessful acquisition offers retry/settings, never an override.

Run field checks in open sky and an obstructed urban setting on both platforms. Record observed fix accuracy and failure behavior; do not silently loosen the gate to make a test pass. Approximate-only location may legitimately block play.

### Stable selections and hint consumption

Give a checkpoint a larger pool than its draw count. Unlock, lose the response, retry with the same key, kill/reopen the app, suspend/resume, and reconnect. IDs/order and choice order remain identical. New keys do not unlock again or consume extra hints. A stale mutation produces a conflict without a partial write. A new replay may draw the same questions; tests must not incorrectly require novelty.

### Final conjunction

For a digital fixture, all questions resolved completes without scan. For a cache fixture, scan alone and final questions alone each remain incomplete. Both orders complete once. Assistance can resolve final questions but cannot satisfy the scan or its fresh proximity. Invalid/wrong-cache QR never marks success; URL-like payloads are not executed.

### State races

Race two starts/resumes and assert one active run after commit. Race abandon against answer/scan and ensure terminal state wins consistently with transaction order. Replay is a new run, not an update. A delayed response cannot overwrite a newer snapshot revision. A server restart retains active/suspended selections and idempotency outcomes.

### Connectivity and uncertain outcomes

Disconnect before sending, during request, and after server commit before response. Preserve pending identity and draft. Refresh/retry explicitly without duplicate effects. Never automatically resubmit stale location or raw cached QR. Query the owned operation-status endpoint after a crash without persisting those raw inputs; an unknown result does not prove an in-flight operation failed. If already committed, return the saved outcome; otherwise reconcile state and obtain a fresh fix/rescan as necessary. Race duplicate requests and verify the in-transaction unique key prevents double effects. Client request timeout must not be displayed as confirmed failure or completion.

### Publication and withdrawals

Deploy version B while a run uses A. Verify A's content, selections, hints, and completion rules remain stable and referenced content remains available. Mark the route unavailable and verify new progression stops on the next server contact, while history/suspend/abandon/delete remain usable. Previously accepted idempotent outcomes are not repeated effects. Offline UI cannot promise current availability.

### Privacy and deletion

Capture logs, database rows, device snapshots, network payloads, and build artifacts for the test run. Assert only permitted progress facts persist; no raw coordinates, answers, scan tokens, or bearer secrets in logs/snapshots/public bundles. Test a lost response after server deletion and revoked credential: receipt status must permit confirmation and cleanup but not gameplay access. Test local cleanup failure and activity expiry. Do not claim uninstall alone deletes server data.

## 4. Implementation prerequisites and open decisions

Resolve these technical choices and verification requirements before relying on them in implementation or claiming support. Record the results in the specifications and implementation configuration.

| Gate | Required decision/check                                                                                          | Completion evidence                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| G01  | Compatible Expo/React Native/Node/TypeScript/Fastify/Drizzle/Zod/localization versions and npm workspaces        | Version matrix and minimal mobile/API/contracts/localization build                              |
| G02  | SQLite driver, geospatial utility, decimal-safe tool, deterministic Unicode strategy, schema/OpenAPI integration | Narrow compatibility probes and relevant behavior vectors                                       |
| G03  | Native packages/development-build composition, MapLibre/local map assets, and supported Android/iOS OS versions  | Supported OS matrix and map lifecycle/privacy checks backed by actual build/device verification |
| G04  | Exact route/DTO schema, QR grammar, error-code vocabulary and resource limits                                    | Reviewed contracts/OpenAPI; payload bounds and rate/timeout settings                            |
| G05  | Idempotency retry retention, deletion receipt storage/expiry, minimum operational log retention                  | Recovery/security tests showing no private-input persistence or stranded deletion               |
| G06  | Final visual tokens, typography/icons, component states and working title/branding                               | Reviewed wireframes/design; accessible desktop tooling and mobile layout checks where relevant  |
| G07  | Reference devices/dataset and meaningful startup/API/screen responsiveness targets                               | Recorded reference measurements and specified numerical targets                                 |
| G08  | Field validation of strict GPS defaults; author review of surroundings-based finales                             | Android/iOS outdoor evidence; threshold changes reflected in specification and tests            |
| G09  | Public deployment, backup enablement, store distribution, external users                                         | Separate scope decision; HTTPS/operations/privacy/release review before exposure                |

G09 is not required for the local demonstration. Hosting vendors, paid services, store releases, and production operations are separate scope decisions.

## 5. Implementation sequence without schedule commitments

1. Resolve G01-G03 through small compatibility probes. Establish npm workspaces, safe contracts, lint/type/test tools, and separate runnable apps.
2. Build content validation, immutable storage/migrations, anonymous identity, authorization, deletion foundations, and synthetic fixtures.
3. Implement/test server run state machine, draws, evaluation, hints, strict location validation, QR conjunction, and transactional retry rules.
4. Implement mobile discovery Map/List, details/current-target maps with regional assets/attribution, persistence, typed API/error handling, run switching, checkpoint UI, navigation/sensor adapters, and journal.
5. Add real scanner, pending request recovery, deletion UI, accessibility, content privacy/build checks, and automated core journeys.
6. Perform real-device field validation and resolve applicable G04-G08 choices. Document actual local setup and limitations.

This is dependency order, not staffing, budget, deadline, or effort estimation. Do not implement future accounts, public creators, worldwide map hosting, offline gameplay, or production hosting under this sequence without a new scope decision.

## 6. Definition of done for the local MVP

- A fresh checkout can follow documented npm setup and run mobile/API with migrated SQLite and labeled synthetic fixtures.
- Real Android and iOS devices complete both a digital-only and QR-finale journey through the actual API.
- Strict GPS, selected questions, hints/assistance, suspended runs, replay, abandonment, and final conjunction match the specification.
- Interrupted requests, network loss, app termination, stale revisions, ownership violations, and deletion failures have tested recovery paths.
- Real private answer/QR material is absent from mobile/contracts/public artifacts; location is not retained or logged.
- Core accessibility, Polish/English localization, and supported OS/native compatibility checks pass.
- Automated gates and applicable acceptance cases pass with evidence; pending future-production gates are labeled, not represented as completed.
- Documentation describes implemented commands and verified limitations. No budget/deadline or physical-container maintenance section is required.
