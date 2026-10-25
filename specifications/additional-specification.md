# Additional Specification

Read alongside the [product specification](product-specification.md), [technical specification](technical-specification.md), and [verification plan](verification-plan.md). This file elaborates navigation, interactions, authoring examples, and contract review points without replacing R01-R26.

Navigation and interaction rules below follow the existing product scope. Numeric capacities and JSON field names are proposals for contract review, not implemented interfaces. Fictional content is public demonstration material, not a real route or secret answer source.

## 1. Navigation structure

Three root destinations: Explore, My Hunts, and Settings. Labels use the selected UI language. Use icon-and-label tab navigation at root level; nested play screens use a back action and an explicit route to My Hunts rather than a second competing navigation bar.

| Destination | Polish label | English label | Child surfaces                                                |
| ----------- | ------------ | ------------- | ------------------------------------------------------------- |
| Explore     | Odkrywaj     | Explore       | Map/List, hunt details, start                                 |
| My Hunts    | Moje wyprawy | My Hunts      | Active/suspended runs, checkpoint, questions, finale, history |
| Settings    | Ustawienia   | Settings      | App/hunt language, privacy/retention, activity deletion       |

### Entry and return behavior

- Launch into Explore; show a compact resume action when an active run exists. Never activate a run just by viewing its details.
- Explore Map/List shares search state; selecting a public start marker opens details. Both views remain usable without location permission. A map is not a new root destination.
- Details embeds the public start map; checkpoint play embeds only the current authorized target. Map gestures and marker selection never unlock questions. Keep text coordinates, a list alternative, visible attribution, and an out-of-coverage/error state.
- Hunt details opens from discovery. Starting successfully opens that run's current checkpoint under My Hunts; an earlier active run becomes suspended on the server.
- My Hunts groups active/suspended runs separately from completed/abandoned history. Resume is a server operation, not a local tab-selection side effect.
- Back from a question returns to its selected question set or checkpoint. Back from checkpoint returns to My Hunts. Neither action suspends or abandons the run.
- Back from scanner closes camera capture and returns to the finale overview. A verified scan remains verified after leaving the screen.
- Tab changes and app backgrounding preserve drafts but do not themselves mutate run status. Pause is an explicit suspend action; Abandon is a separate confirmed terminal action.
- External navigation leaves the app through NavigationGateway. Returning refreshes server state and acquires fresh location when needed; it does not unlock anything automatically.
- Android system back follows this hierarchy. At a root destination use normal platform exit/background behavior without an abandonment prompt.
- Completion replaces the active play surface with its confirmed summary. Back goes to My Hunts; replay starts a new run, not a route back into the completed one.

### Flow

```text
Explore -> Details -> Start
                                               |
My Hunts <- Checkpoint <- Question set <- Answer / Hint / Assistance
                |
          Next checkpoint
                |
          Finale overview
          /            \
   Final questions    QR scanner
          \            /
       Both conditions confirmed
                |
          Completion -> My Hunts
```

Settings contains the only language control. Hunt details and all existing run content automatically follow it; do not add a hunt-language selection step or pin language to a run.

## 2. Interaction rules

### Checkpoint and proximity

- Before unlock, display only the reachable checkpoint's authorized location and navigation information. Future checkpoints remain undisclosed.
- A distance readout is guidance, not confirmation. Only a successful server unlock reveals the question selection.
- While acquiring location, show a cancellable waiting state. Cancellation stops the acquisition; it does not skip the checkpoint.
- Inaccurate/stale/out-of-range fixes explain the condition and offer retry. Denied permission offers platform settings when appropriate. No override is available.
- Show unavailable heading as unavailable; never replace it with a plausible-looking fixed arrow.

### Question set and answer feedback

- Show selected questions and their unresolved/correct/assisted states. All questions drawn for the checkpoint must resolve; their order of answering is free.
- A text/numeric input draft survives navigation and process restart. It is distinct from accepted server progress and is never prefilled as a confirmed correct answer.
- Disable duplicate submission while that operation is pending; retain its idempotency key. A timeout is an uncertain outcome, not evidence the answer was rejected.
- Wrong answer: keep the draft editable, show nonpunitive feedback, and offer another attempt. Do not expose accepted aliases, future hints, or correctness flags for unselected choices.
- Invalid format: associate the message with the input, preserve the draft, and move accessibility focus to the error summary or field.
- Correct answer: show a confirmed resolution indicator and retain authorized prompt/history context. Do not introduce a score, countdown, reward points, or mandatory reveal of the private accepted-answer list.
- When the final selected question resolves, show checkpoint completion and an explicit Continue action. Next-checkpoint navigation is based on the returned authoritative snapshot.

### Hints and assistance

- Next Hint requests exactly one next authored hint. Previously revealed hints stay readable and are not consumed again when revisited.
- If no hint remains, show that state rather than repeating a chargeable-looking action. Hints have no score cost in this app.
- Answer assistance uses a confirmation dialog: it resolves the question with an assisted marker. Cancel has no server effect.
- After confirmation, show the authorized answer/explanation and assisted status. Do not imply that assistance verifies a location or QR code.
- Localize UI controls, prompts, hints, choices, and reveal text in the language from Settings. Switching language preserves hint usage and assisted status.

### Physical finale

- The finale overview has two independent conditions: questions resolved and QR verified. Display each explicitly, not as an ambiguous percentage.
- Either condition can be satisfied first after final checkpoint unlock. A completed condition remains visible while the other is pending.
- Scanning opens the camera only on explicit action. Stop scanning after one candidate while its validation is pending to avoid a request burst.
- Malformed/wrong QR returns to retry without opening a URL. A valid code still requires fresh proximity and server confirmation.
- Only the server's completed run state opens the completion summary. Never animate a completed hunt merely because the camera recognized a QR pattern.

### Failure and destructive actions

| State                     | Visible recovery                                                       | Must not happen                                       |
| ------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| API unreachable           | Keep stale confirmed snapshot/draft; refresh or explicit retry         | Local grading or fake completion                      |
| Unknown request outcome   | Resolve owned operation status and refresh                             | Blindly create a new run or consume another hint      |
| Revision conflict         | Refresh state, preserve compatible draft, explain change               | Overwrite a newer snapshot with an old response       |
| Route unavailable         | Show reason, allow history/suspend/abandon/delete                      | Advance a withdrawn route                             |
| Camera denied             | Settings/retry, return to finale                                       | Manual code-entry bypass                              |
| Abandon requested         | Confirm irreversible abandonment; cancel safely                        | Treat back navigation as abandonment                  |
| Delete activity requested | Explain device-bound data loss; confirm server deletion before cleanup | Clear the credential before deletion can be confirmed |

## 3. Fictional bilingual hunt

This example uses an invented town square, clock, and pavilion. Do not navigate real players to these example coordinates or infer container permissions. Both language variants describe identical game structure, stable choice IDs, and location facts.

| Field                     | Example                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Hunt ID / version         | `demo-square` / `1`                                                                   |
| Title, pl / en            | `Sekret placu` / `The Square's Secret`                                                |
| Available content locales | `pl`, `en`                                                                            |
| Finale                    | Required QR plus final question set                                                   |
| Author estimate           | Easy, 0.8 km, 25 minutes; synthetic estimates                                         |
| Terrain note, pl / en     | `Bruk i dwa stopnie przy pawilonie.` / `Paving stones and two steps at the pavilion.` |
| Checkpoint order          | Gate, Clock, Pavilion                                                                 |
| Radius                    | 40 m for each; normal strict GPS requirements apply                                   |

### Checkpoint 1: Gate

Pool size 2, draw count 1. The fictional gate has a blue star and a four-digit date.

| ID / type             | Polish / English prompt                                               | Private sample answer                                                  | Hint, pl / en                                                           | Reveal, pl / en                                               |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `gate.symbol`, choice | `Jaki znak jest nad brama?` / `Which symbol is above the gate?`       | `star`; choices `star`=Gwiazda/Star, `leaf`=Lisc/Leaf, `key`=Klucz/Key | `Spojrz nad srodek wejscia.` / `Look above the centre of the entrance.` | `Nad brama jest gwiazda.` / `There is a star above the gate.` |
| `gate.date`, numeric  | `Jaki rok widnieje na bramie?` / `Which year is written on the gate?` | `1924`, exact                                                          | `Poszukaj czterech cyfr.` / `Look for four digits.`                     | `Na bramie widnieje 1924.` / `The gate reads 1924.`           |

### Checkpoint 2: Clock

Pool size 2, draw count 1. The fictional clock has a copper face and twelve numbered positions.

| ID / type                  | Polish / English prompt                                                              | Private sample answer                                    | Hint, pl / en                                                                         | Reveal, pl / en                                               |
| -------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `clock.colour`, text       | `Jakiego koloru jest tarcza?` / `What colour is the clock face?`                     | pl aliases `miedziany`, `miedziana`; en aliases `copper` | `Przyjrzyj sie powierzchni za wskazowkami.` / `Look at the surface behind the hands.` | `Tarcza ma miedziany kolor.` / `The face is copper-coloured.` |
| `clock.positions`, numeric | `Ile pozycji godzinowych ma zegar?` / `How many hour positions does the clock have?` | `12`, exact                                              | `Policz oznaczenia na obwodzie.` / `Count the marks around the edge.`                 | `Zegar ma 12 pozycji.` / `The clock has 12 positions.`        |

### Checkpoint 3: Pavilion finale

Pool size 2, draw count 2. Both final questions must resolve, together with the QR condition. The fictional pavilion has three stone columns and a bird symbol.

| ID / type                   | Polish / English prompt                                                         | Private sample answer                                                  | Hint, pl / en                                                     | Reveal, pl / en                                                        |
| --------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pavilion.columns`, numeric | `Ile kolumn stoi od strony placu?` / `How many columns face the square?`        | `3`, exact                                                             | `Licz tylko kolumny od frontu.` / `Count only the front columns.` | `Od frontu sa trzy kolumny.` / `There are three columns at the front.` |
| `pavilion.symbol`, choice   | `Co przedstawia znak na pawilonie?` / `What does the pavilion's symbol depict?` | `bird`; choices `bird`=Ptak/Bird, `tree`=Drzewo/Tree, `sun`=Slonce/Sun | `Spojrz na znak przy dachu.` / `Look at the symbol by the roof.`  | `Znak przedstawia ptaka.` / `The symbol depicts a bird.`               |

The sample Polish copy above is ASCII transliteration for the specification; implementation fixtures and UI translations must use correct Polish spelling and diacritics. This does not relax R10's diacritic-preserving answer rules. Authors must explicitly choose aliases rather than automatically stripping accents.

Each question has one hint in this example; longer authored hint sequences are supported. Localized prompts/choices/reveals are not UI dictionary keys. Accepted aliases are language-scoped and private in real hunts. Generate a synthetic QR through test tooling after the exact payload grammar is specified; do not print a fake token here and describe it as scannable.

## 4. Illustrative API exchanges

The endpoint paths follow the technical specification. Field names below illustrate the intended contract and must be reconciled with the shared Zod/OpenAPI schemas before implementation. All example IDs are synthetic. Credentials are transmitted in authorization headers, never these JSON bodies or URLs. Location/QR values are omitted from examples to avoid suggesting reusable verification data.

### Start a run

`POST /v1/runs`, authenticated, with an `Idempotency-Key` header and `Accept-Language: en` derived from Settings:

```json
{
  "huntId": "demo-square",
  "huntVersion": "1",
  "expectedInstallationRevision": 0
}
```

Illustrative successful response:

```json
{
  "installationRevision": 1,
  "run": {
    "id": "run-demo-1",
    "revision": 1,
    "state": "active",
    "huntId": "demo-square",
    "huntVersion": "1",
    "checkpoint": {
      "id": "gate",
      "state": "reachable"
    }
  },
  "affectedRuns": []
}
```

This excerpt omits normal authorized navigation metadata. It must not include future checkpoints, question pools, answers, or raw QR tokens. If another run was active, `affectedRuns` must describe its confirmed suspension/revision.

### Unlock, answer, and scan

| Action                    | Request essentials                                                         | Result essentials                                                               |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Unlock current checkpoint | Expected revision, operation key, fresh location fix                       | Saved selected question IDs/order, safe localized prompts/options, new revision |
| Submit answer             | Selected question ID, expected revision, operation key, typed answer value | Correct/incorrect result and authoritative snapshot; no accepted-answer list    |
| Reveal hint               | Selected question ID, revision, operation key                              | Exactly next hint in content locale, persisted hint cursor                      |
| Confirm assistance        | Selected question ID, revision, operation key                              | Assisted resolution and authorized answer display/explanation                   |
| Validate QR               | Expected revision, operation key, supported payload, fresh location fix    | QR condition recorded; completion only if final questions also resolve          |

Incorrect answer is a normal evaluation result, not a server exception. Repeated accepted operation keys return their saved outcome. A fresh request with changed location must not overwrite an accepted operation fingerprint.

### Revision conflict

Illustrative HTTP 409 response:

```json
{
  "code": "RUN_REVISION_CONFLICT",
  "messageKey": "run.errors.revisionConflict",
  "params": {},
  "retryable": true,
  "correlationId": "request-demo-17"
}
```

Refresh the owned run and preserve compatible draft text; do not automatically resubmit a stale mutation. The English message key maps to both UI dictionaries. Its localized sentence is not returned as a hardcoded server message.

### Uncertain outcome

After a lost response, query `GET /v1/operations/:operationKey` with installation authorization. A committed response contains only a safe outcome. Unknown is not proof of failure; reconcile run/lifecycle state before retrying. Do not persist raw GPS/QR inputs merely to repeat a request after a crash.

## 5. Proposed capacities for review

These are initial candidates, not performance guarantees or finalized API constants. Validate them against realistic fixtures and devices before adopting them in shared/server schemas. Existing strict GPS thresholds and 180-day inactivity retention are not changed here.

| Item                           | Proposed limit                     | Reason / tradeoff                                                                         |
| ------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| Checkpoints per hunt           | 30                                 | Bounds payload/history complexity; excludes very long trails                              |
| Questions per checkpoint pool  | 20                                 | Useful replay variation without unbounded private content                                 |
| Questions drawn per checkpoint | 1-5 and no more than pool size     | Keeps field interaction manageable; narrows R09's general allowable range only if adopted |
| Choices per question           | 2-6                                | Fits single-choice mobile interaction                                                     |
| Hints per question             | 5                                  | Bounds repeated calls and hint layout                                                     |
| Hunt title                     | 100 Unicode code points per locale | Supports meaningful titles without enormous list rows                                     |
| Prompt / individual hint       | 1,000 Unicode code points          | Allows useful clues with bounded input/rendering                                          |
| Story / reveal explanation     | 4,000 Unicode code points          | Allows narrative without unlimited rich content                                           |
| Submitted text answer          | 200 Unicode code points            | Bounds normalization and logging risk; never log the value                                |
| Published image                | 2 MB, longest edge 1,920 px        | Balances field downloads and legibility; verify low-bandwidth behavior                    |
| Catalog/history page           | 20 default, 50 maximum             | Bounded reads without hiding results behind a hard total cap                              |
| Suspended runs                 | 20 per installation                | Bounds open-session management; reaching the limit must not silently abandon a run        |

If suspended-run capacity is adopted, starting/resuming that would exceed it must reject before changing any run and offer explicit management of existing runs. Completed/abandoned records follow retention rather than an arbitrary silent truncation.

JSON body sizes, registration/mutation rate limits, timeouts, idempotency retention, and deletion-receipt expiry still need operation-specific security review. Do not derive them blindly from the table or claim unlimited traffic because question attempts have no gameplay cap.

## 6. Additional acceptance cases

| Case | Coverage                  | Evidence                                                                                                                                                     |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AX01 | Navigation / R06, R23     | Back/tab/background do not abandon/suspend implicitly; camera/watchers stop appropriately                                                                    |
| AX02 | Question UX / R09-R11     | Drafts survive navigation; selected IDs and hint cursor do not change on revisit                                                                             |
| AX03 | Feedback / R10, R24       | Wrong answer differs from invalid input and uncertain request outcome; no fake saved state                                                                   |
| AX04 | Finale / R12-R13          | Both condition orders finish once; scanner alone never displays completed hunt                                                                               |
| AX05 | Language / R01, R18       | Settings controls UI and all hunt content together; switching/resuming/reloading preserves progress, selections and drafts without an independent run locale |
| AX06 | Example content / R16-R18 | Both locale variants validate; draw counts and private/public fields behave as described                                                                     |
| AX07 | API / R21, R24            | Examples match eventual shared schemas; ownership, conflicts, duplicate/unknown outcomes tested                                                              |
| AX08 | Capacity proposals        | Once adopted, exact-boundary and above-limit cases reject safely with no partial mutation                                                                    |
| AX09 | Accessibility / R22       | All sketch interactions have focus order, names, readable status, and non-color-only feedback                                                                |
| AX10 | Scope / R25-R26           | Sketch labels real local OSM geometry versus fictional hunts; no runtime map requests or production GPS/QR bypass; native map validation remains separate    |

## 7. UI sketch scope

Open the [local HTML prototype](../prototype/index.html) directly in a browser. Its source is split into [HTML](../prototype/index.html), [CSS](../prototype/styles.css), and [JavaScript](../prototype/app.js), with no build or dependency installation. The sketch stores only fictional progress in browser local storage when available. Maps use a locally vendored Leaflet renderer, [local OSM data](../prototype/map/data.js), and a separate [map adapter](../prototype/map/renderer.js). Map rendering makes no runtime network requests; attribution links open the source site only when selected. The sketch does not use Figma. Icon outlines use Lucide icon geometry; the fictional pavilion illustration is an original inline SVG.

This is a use-case and UX prototype for validating navigation, interaction order, and recovery choices. Its visual design is provisional, does not represent the final UI, and will evolve during implementation. It is not a running Expo application or proof of location/QR validation; example success states are simulated.

Hunts are authored in the separate [prototype configuration](../prototype/config/hunts.js). Each hunt owns its bilingual metadata, ordered checkpoints, questions, hints, and public demo answers. The [prototype documentation](../prototype/PROTOTYPE.MD#specify-a-hunt) documents the structure and validation command. Gameplay/state rules, screen templates, interface copy, and map assets have separate ownership; this organization does not introduce a build step or change the planned native architecture.

Required surfaces: Explore with Map/List, Hunt Details with start map, Checkpoint with current-target map, Question Set/Answer, QR Finale, My Hunts, Completion, and Settings. Include GPS-inaccurate, connection-loss, camera-permission, and map-failure states. Keep an outdoor utility direction, readable text, full-width map content, padded interactive rows, and clear primary actions. Real map geometry must not imply the fictional clues, landmarks, or containers exist at those locations.

Exact colors, typography, icons, native platform variations, and final localized copy remain design implementation decisions. The sketch must not add accounts, community publishing, rankings, or offline completion.

## 8. Open map data and hosting boundary

The implemented sketch self-hosts a small central-Warsaw OSM extract as local files. It does not run a global tile server. Public start markers and the current checkpoint are separate fictional game annotations; future checkpoint markers or a trail polyline are never passed to the map adapter. No player-position dot is simulated on the map.

Use linked `© OpenStreetMap contributors` on every map and retain the ODbL notice/source metadata when redistributing the derived dataset. Leaflet's BSD license is included under its vendor directory. Coverage, source, regeneration, and license links are documented in the [prototype documentation](../prototype/PROTOTYPE.MD#local-map-data). The simplified extract is for visual orientation, not navigation, routing, or accessibility certification.

The Expo implementation uses the MapPresentation boundary and a compatible MapLibre React Native development build. Self-hosting a larger region is possible, but requires its own extract-to-vector-tile pipeline, local/static serving, style/font/sprite assets, update policy, storage and performance checks. Do not replace a local asset failure with undisclosed third-party tile requests. Basemap availability offline is distinct from the API connectivity required for gameplay.
