# Product Specification

Working title: Signal Hunt.

Read with the [technical specification](technical-specification.md) and [verification plan](verification-plan.md). Requirement IDs below are normative. Examples illustrate behavior; they are not real hunt content.

## 1. Purpose and audience

Signal Hunt turns a real-world walk into an ordered sequence of observation-based puzzles. It combines the exploration of geocaching with authored puzzle trails rather than importing an existing geocaching platform's listings.

The primary audience is local adults exploring their area. Adults may play alongside family members, but the MVP has no child profiles, child-specific account flows, or dedicated family/team mode. Each phone has independent progress.

Success means a player can discover a hunt, reach its checkpoints, resolve its questions, finish its finale, and resume interrupted play on a real Android or iOS device. The demonstration must exercise actual API, database, location, and camera behavior, not replace them with production-visible simulation.

## 2. Scope and exclusions

### Included

- Team-authored digital-only hunts and hunts with a required physical QR finale.
- One Polish/English language setting for the interface and all hunt content.
- Discovery Map/List views, embedded start/current-checkpoint maps, external navigation, distance and bearing.
- OpenStreetMap-based regional map data, locally hosted or bundled for the demo, with visible attribution.
- Ordered checkpoints; strict proximity checks without manual overrides.
- Text, numeric, and single-choice questions; configurable randomized question pools.
- Hints and explicit assisted answers.
- One active run and multiple suspended runs per installation.
- Local journal, replay, abandonment, and server-backed data deletion.
- Backend-authoritative gameplay, local snapshot/draft preservation, accessible light/dark UI.

### Excluded

- Signup, email/social authentication, account recovery, cross-device migration.
- Synchronized teams, chat, public profiles, ratings, feeds, leaderboards, prizes, scoring, badges.
- Push notifications, advertisements, third-party analytics, background location.
- Worldwide map hosting, in-app routing, turn-by-turn navigation, guaranteed offline gameplay.
- Public hunt submissions, mobile/web editors, runtime content-import/admin APIs.
- Audio/video, user uploads, rich HTML, AI grading, multi-select questions.
- Geocaching.com imports or integrations, paid content feeds, public hosting commitments.
- Planning physical-container placement, loss, permission, protection, or maintenance.

Container maintenance is outside scope; scanner failures and incomplete runs are still defined app states. The app must not falsely record a find because a container or code is unavailable.

## 3. Terminology

| Term               | Meaning                                                                             |
| ------------------ | ----------------------------------------------------------------------------------- |
| Installation       | Anonymous server identity associated with a credential held by one app installation |
| Hunt               | Stable identity and discovery metadata for a trail                                  |
| Hunt version       | Immutable published content used by a run                                           |
| Checkpoint         | An ordered stop with a location gate and question pool                              |
| Question selection | Distinct questions drawn for one checkpoint in one run                              |
| Run                | One attempt at a particular hunt version                                            |
| Hint               | Author-written guidance that does not itself resolve a question                     |
| Assisted question  | A question resolved through confirmed answer reveal                                 |
| Physical finale    | Final checkpoint requiring both its selected questions and a validated QR scan      |
| Confirmed progress | State committed by the server, not an optimistic client prediction                  |

## 4. Requirements

### Discovery and presentation

**R01 - Platforms and language.** Support Android and iOS with complete Polish and English UI translations. Use stable English semantic message keys, not translated strings as identifiers. Select a supported device language initially, falling back to Polish, and allow one persisted language choice in Settings. All hunt content follows that setting, including active/suspended runs and history. There is no separate hunt-language selector or language pinned to a run. Changing Settings updates titles, prompts, choices, hints, explanations, and answer matching without changing the run's immutable content version, question/choice IDs or order, progress, hints consumed, or drafts. Every published hunt must provide complete Polish and English variants with the same game structure; reject incomplete translations at publication rather than silently falling back or mixing languages. Public synthetic fixtures cover both languages. OS minima and exact SDK versions remain implementation prerequisites.

**R02 - Discovery.** Display available published hunts with a Map/List switch and shared text search. Map markers represent public start points, never the full checkpoint trail. Selecting a marker or list result opens details. Provide an equivalent accessible list, including when rendering fails or a hunt lies outside map coverage. Show title, difficulty, estimated walking length/duration, language, and digital/QR-finale type. Optional nearest-first sorting requires a foreground fix and uses a locally calculated straight-line distance to publicly listed start points; it must not upload the player's browsing location. Browsing works without location permission. Clearly identify the supported regional map area; do not imply worldwide coverage or routing-distance calculations.

**R03 - Details.** Before starting, show story/description, a start-point map with textual coordinates, difficulty, estimated length/duration, terrain/access notes, and whether a camera/QR finale is required, all in the language from Settings. Do not ask players to select a hunt language. A failed or out-of-coverage map must not prevent reading details or starting. Distinguish author estimates from navigation measurements. Explain online connectivity and strict GPS requirements before a player commits.

**R04 - Navigation.** In an active run, show the currently revealed checkpoint on an embedded map, its textual coordinates, straight-line distance, and bearing when usable. Support pan, zoom, and recenter on the current target. Never render future checkpoint markers, connecting trail lines, or hidden content. Location permission is not needed to inspect the target map; any player-position indicator requires an actual usable foreground fix and remains local. Map gestures are not proximity evidence. Map failure or missing coverage retains coordinates and external navigation. Provide an explicit action opening an available external navigation app. Explain unavailable/uncalibrated heading without showing a misleading arrow. External directions are not proof of route accessibility or a safe route generated by Signal Hunt. On foreground return refresh location and server state.

Maps use OpenStreetMap data with visible linked `© OpenStreetMap contributors` attribution and ODbL licensing/provenance notices. The local demo uses a bounded self-hosted/bundled regional extract; public OSM tile servers are not the default backend and must not be bulk-downloaded for offline maps. Local map display can work without connectivity, but gameplay mutations still require the API. A larger region requires a separately provisioned regional data/tile pipeline, not an implied unlimited free global service.

### Identity and runs

**R05 - Anonymous identity.** No signup. Provision a private anonymous installation credential when server-backed activity is first needed. Store it using platform secure storage; never place it in logs, URLs, analytics, or ordinary SQLite snapshots. No promised recovery after reinstall, device loss, or credential loss. A shared phone shares progress.

**R06 - Run lifecycle.** Allow many suspended runs and at most one active run. Starting/resuming a run atomically suspends the prior active run. Suspension/resume preserves selected questions, choices, hints, answers, and validated QR state. An explicit confirmed abandon is terminal and remains visible in history. Completed runs are terminal. Replay creates a new run and new selections, which may coincidentally match a previous draw. There is no reroll button.

**R07 - Ordered revelation.** Only the start/currently reachable checkpoint and already reached information are exposed. Later checkpoint coordinates, pools, accepted answers, and final QR token are not delivered ahead of authorization. The next checkpoint unlocks for navigation after the current checkpoint resolves; its questions still require its own proximity gate.

### Location and questions

**R08 - Strict proximity.** Checkpoint question unlock requires a fresh foreground fix validated by the server. Default radius is 40 m. Authors may configure 15-150 m with a reason. Distance must be within the radius; reported horizontal accuracy must be <=25 m; fix age at server receipt must be <=15 seconds. Accuracy does not expand the radius. Reject invalid coordinates, invalid/negative accuracy, and timestamps >5 seconds in the future. Wait at most 20 seconds per acquisition attempt, then offer retry/settings. No GPS override, checkpoint skip, or answer reveal before location unlock.

Device clock skew, approximate location, denied permission, or poor reception can block strict play. State the actual cause when known and offer retry/settings. Reported location is untrusted sensor data, not spoof-proof evidence. These starting thresholds require field validation before release; any changes must be reflected in the specification and boundary tests.

**R09 - Question pools.** A checkpoint contains a nonempty question pool and author-configured draw count from 1 to pool size. On first successful location unlock, the server draws uniformly without replacement and persists the selected IDs and order in the same transaction. Single-choice option order is randomized once and persisted too. All selected questions must resolve. Reopening, resuming, retries, or duplicate requests never redraw.

**R10 - Answer evaluation.** The server validates text, numeric, and single-choice answers. Text matching trims, collapses whitespace, normalizes Unicode, and case-folds, but preserves Polish diacritics and punctuation; authors provide accepted aliases. Numeric input accepts comma or dot decimal separators, no units/group separators, exact decimal equality by default, and an explicitly authored absolute tolerance if present. Do not use binary floating-point equality for decimal answers. Multiple choice has one correct stable option ID. Unlimited attempts are allowed subject to API rate limits; no score/timer penalty. Blank or malformed answers are rejected as input errors, not accepted aliases.

**R11 - Hints and assistance.** Reveal authored hints one at a time. Hints do not resolve a question. Answer reveal requires explicit confirmation, resolves that selected question as assisted, and returns the authored explanation/answer display. Resolve all drawn questions through correct answers or assistance. Record hint usage separately from assisted status. Assistance cannot bypass proximity or a required QR scan. Questions may be worked through without a new location check after initial unlock.

**R12 - Finales.** A digital-only hunt completes when all checkpoint questions resolve. A QR-finale hunt completes only when both the final selected question set and a valid QR scan resolve. They may resolve in either order after final checkpoint unlock. The final questions concern the surroundings; authoring validation can enforce question structure but human review must check this meaning. QR submission requires a new valid fix using the final checkpoint's location rules. A scan without resolved questions, or resolved questions without a required scan, is not completion.

**R13 - QR behavior.** Scan an app-specific versioned QR payload containing an opaque random cache token. Do not execute scanned URLs or arbitrary text. Validate binding to the correct hunt version/finale on the server. Wrong format, wrong cache, denied camera, expired location, network loss, and unavailable content have explicit error/retry states. No manual code-entry bypass. Static codes can be copied; the app does not claim verified physical presence. See the technical specification for token handling.

### Connectivity, history, and content

**R14 - Online-first preservation.** Server access is needed for unlocks, answers, hints, assistance, scans, and lifecycle mutations. Preserve confirmed snapshots, selected visible questions, draft inputs, and pending request identities locally across process termination. Without connectivity show the last confirmation time/stale state. Do not claim new progress, locally grade answers, or automatically queue stale location mutations. After reconnect refresh authoritative state; let the player explicitly retry pending work. Offline content/media availability is not guaranteed.

**R15 - Journal.** Show active/suspended runs and completed/abandoned history, hunt title/version context, progress, completion time where applicable, hints, and assisted status. Replay is separate from resume. Journal data belongs to the installation; server data remains authoritative. Avoid displaying a newly completed state before server confirmation.

**R16 - Content ownership.** Only the team creates content. Author private structured files, validate them, and publish with backend deployments. No in-app or web authoring UI. Real accepted answers/QR secrets remain outside public repository artifacts. Public synthetic fixtures are explicitly labeled and reproducible. No promise that public fixture answers are secret.

**R17 - Versions and availability.** Pin each run to an immutable content version. New content does not mutate existing selections or active/suspended run rules. Preserve referenced versions. An unavailable flag blocks new runs and future gameplay mutations when contacting the API; show a clear reason. A player may inspect history, suspend, abandon, or delete activity for an unavailable route. Do not claim instant remote withdrawal while disconnected. Availability must be checked on start/resume/unlock/progression and foreground refresh.

**R18 - Content/media model.** Hunt metadata includes localized title/story and terrain/access notes, available languages, start coordinates, difficulty, estimated length/duration, ordered checkpoints, and finale type. Checkpoints include location/radius, question pools/draw counts; questions include localized prompts, accepted answer aliases, hints, choices, and reveal explanation. Both Polish and English variants must be complete and structurally equivalent; accepted text answers use the Settings language captured for that submission. Optional cover/question images require localized text alternatives and owned/licensed provenance. No HTML execution or user uploads. Do not leak hidden coordinates/answers through filenames, metadata, unrevealed media URLs, or public asset manifests.

### Privacy, safety, and quality

**R19 - Minimal collection.** No background tracking, movement history, advertising, or third-party analytics. Browsing location stays local. Bundled map rendering makes no external viewport requests. Self-hosted asset requests must not contain player coordinates or installation credentials; avoid retaining viewport request logs. A later external map provider requires an explicit source configuration and privacy disclosure covering IP/viewport exposure, terms, attribution, and caching; never silently fall back to a third-party service. Send player coordinates only for explicit proximity-gated actions and discard after validation; retain only necessary progress facts. Redact exact coordinates, credentials, answers, and scanned tokens from logs. Author checkpoint coordinates are content and are distinct from transient player location.

**R20 - Deletion and retention.** Provide confirmed 'delete my activity and reset this device'. Delete live server activity and invalidate the credential before local cleanup. If offline/failing, keep a recoverable pending deletion state and explain that deletion is not confirmed. A restricted receipt enables safe retries after revocation. Local cleanup removes snapshots/drafts/pending gameplay keys; revoked identity must not be silently reused. Expire inactive installations and their runs after 180 days; disclose the consequence for old journals. No local-demo backups by default. Any later enabled backup must be encrypted, expire within 30 days, and apply deletion tombstones before restored data is served.

**R21 - Authorization/security.** Every run operation checks ownership and valid state. Require input bounds, parameterized database access, rate limiting, timeouts, safe errors, credential hashing, and private answer storage. Never treat a run ID or client-supplied completion flag as authority. HTTPS is required outside explicitly configured local development. Do not describe strict GPS as anti-cheat proof.

**R22 - Accessibility and style.** Outdoor utility visual direction: readable, restrained, scan-friendly. Support system light/dark theme, screen-reader labels, scalable text, adequate contrast, non-color-only states, usable touch targets, and reduced motion. Do not make hints, errors, camera instructions, or terminal state readable only on a map/image. Trail terrain notes inform players; they do not certify physical accessibility.

**R23 - Permissions and lifecycle.** Request foreground location and camera only when the relevant action needs them. Handle denied, restricted, permanently denied, services-off, poor-accuracy, and app-background states. Do not keep camera/location watchers running unnecessarily after leaving the relevant screen or backgrounding. Browse without permission; explain why strict progression is unavailable. Never display a fake distance/heading.

**R24 - Reliability.** Make state transitions transactional, repeat-safe, and revision-checked. Recover interrupted starts, unlocks, hints, scans, submissions, switching, and deletion without duplicate progression. Preserve drafts without confusing them with saved answers. Refresh safely on focus/reconnect. Confirmed terminal runs never become mutable through a delayed request.

**R25 - Local demonstration.** Document reproducible setup for mobile/API/databases and public fixtures. Real phones must reach the configured local API endpoint. No automatic paid tunnel, public hosting, app-store deployment, or production scaling claim. Test adapters are available only in test builds, never as a runtime bypass in normal builds.

**R26 - Verification.** Require the automated and real-device checks in the verification plan. Verify compatible dependency versions, supported OS matrix, sensor/native compatibility, visual tokens, and measured performance expectations before claiming their respective support.

## 5. Primary journeys

### Discover and start

1. Open discovery without signup or permission prompts.
2. Search or inspect hunts using Map/List; optionally request nearest sorting.
3. Read details, terrain notes, QR requirements, strict GPS and connectivity notice in the Settings language.
4. Start using the server; existing active run becomes suspended atomically.
5. See start/current checkpoint directions. Request location when needed for distance/proximity.

### Play a checkpoint

1. Reach the currently revealed location using the target map, distance/bearing, or external directions.
2. Acquire a valid fix and request server unlock.
3. Display the saved question selection; answer questions in any order within this checkpoint.
4. Use hints or confirmed answer assistance if desired.
5. After all selected questions resolve, reveal the next checkpoint. Never require another fix for an answer at an already unlocked checkpoint.

### Finish a physical finale

1. Unlock the final checkpoint using its proximity gate.
2. Resolve final selected questions and scan the QR in either order.
3. At scan submission obtain a new acceptable fix; wait for server confirmation.
4. When both conditions hold, show confirmed completion and journal entry.

### Interrupt, switch, and recover

1. Leaving the app does not imply abandonment; location/camera work stops appropriately.
2. Reopen with cached content visibly marked stale until refresh succeeds.
3. Keep unsent draft separate from server-confirmed resolution.
4. Resolve pending request identity through explicit refresh/retry, without rerolling or double effects.
5. Starting/resuming another run suspends the current run; confirmed abandonment is different and terminal.

## 6. Screen inventory and states

| Surface           | Required content/actions                                                                | Required non-happy states                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Discovery         | Search, Map/List, public start markers, optional nearest sort                           | Loading, empty catalog/search, API unavailable, cached/stale, denied sorting location, map failure/coverage limit         |
| Hunt details      | Story, metadata, terrain, start map/coordinates, finale, start/replay                   | Unavailable version, start failure, identity/provision failure, map failure/coverage limit                                |
| Active checkpoint | Progress, current-target map/coordinates, distance/bearing, external navigation, unlock | GPS waiting/inaccurate/stale/denied, heading unavailable, offline, withdrawn, pending request, map failure/coverage limit |
| Question set      | Selected prompts/options, draft, submit, ordered hints, reveal                          | Invalid answer, wrong answer, throttled, stale revision, failed submit, assisted state                                    |
| Finale scanner    | Camera, framing, scan status, remaining finale conditions                               | Denied/restricted camera, invalid format/cache, duplicate scan, stale GPS, network failure                                |
| Runs/journal      | Active, suspended, completed/abandoned, resume/replay/abandon                           | Empty, stale, unavailable content, confirmation, expired identity                                                         |
| Completion        | Server-confirmed summary, hints/assistance, journal/replay                              | Pending response is not completion; refresh after interrupted response                                                    |
| Settings/privacy  | Interface language, system theme, privacy/retention explanation, reset                  | Delete confirmation, pending/failed deletion, confirmed cleanup, credential-storage failure                               |

Maps are embedded in discovery, details, and active-checkpoint surfaces, not a separate root destination. There is no login screen, public profile, author editor, or ranking screen in the MVP.

## 7. Product acceptance boundary

All R01-R26 requirements need the linked verification evidence. A locally runnable API is not public availability. A simulator-only pass is not native field validation. A visual mockup is not a completed gameplay flow. Physical-container operations remain outside this specification.
