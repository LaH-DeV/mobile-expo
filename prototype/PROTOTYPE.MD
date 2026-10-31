# Signal Hunt Prototype

## Quick start

The current runnable application is the static prototype, not an Expo app. Open [index.html](index.html) directly, or use the commands below with Node.js 22+ and npm. **No `npm install`, build step, or server is needed.** All npm commands on this page run from the prototype directory:

```sh
cd prototype
```

| Command                                      | Purpose                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run start:macos`                        | Open the prototype in the default browser on macOS                                 |
| `npm run start:windows`                      | Open the prototype in the default browser on Windows (npm's default cmd.exe shell) |
| `npm run start:linux`                        | Open the prototype in the default browser on desktop Linux (requires `xdg-open`)   |
| `npm run check:config`                       | Validate the bilingual hunt configuration                                          |
| `npm test`                                   | Run gameplay and screen-rendering regression tests                                 |
| `npm run check`                              | Run configuration validation and all regression tests                              |
| `npm run map:build -- /path/to/osm-map.json` | Rebuild the bundled map from an existing OSM JSON extract                          |

Choose the start command for your operating system, or open the HTML file directly. Run `npm run` to list the available commands. The [prototype package manifest](package.json) only provides command shortcuts; it introduces no dependencies or framework setup. Prototype tooling stays inside that directory; there is no root package manifest.

## UI sketch

Open [index.html](index.html) directly in a browser. No installation or server is required. The readable source is split into HTML, CSS, and JavaScript. Review controls outside the mobile preview simulate connection, GPS, and camera failures; the sketch uses public fictional content and is not a running Expo app or backend.

This is a **use-case and UX prototype** for exploring navigation, interactions, and recovery flows. Its visual design is provisional, does not represent the final UI, and will evolve during implementation.

Discovery has Map/List views, details has a start-point map, and active play maps only the current checkpoint. The basemap is real OpenStreetMap geometry stored locally, not live tiles. The hunts, clues, landmarks, and containers are fictional, not real walking instructions. Maps make no runtime network requests.

### Prototype source

| File / directory                                       | Responsibility                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [config/hunts.js](config/hunts.js) | Editable hunts, route metadata, checkpoints, questions, hints, and public demo answers            |
| [game.js](game.js)                 | Content validation, saved-state restoration, run lifecycle, answer matching, and completion rules |
| [app.js](app.js)                   | Browser storage, screen orchestration, named actions, and simulated device conditions             |
| [ui/views.js](ui/views.js)         | Screen templates and presentation helpers                                                         |
| [ui/copy.js](ui/copy.js)           | Polish/English interface text and walkthrough notes                                               |
| [styles.css](styles.css)           | Existing responsive layout and themes                                                             |
| [map/renderer.js](map/renderer.js) | Map adapter; dataset, regeneration script, and vendored Leaflet live alongside it                 |

Classic deferred scripts deliberately keep direct `file://` use working. There is no bundler, runtime content fetch, or Expo scaffold.

### Specify a hunt

Edit **[config/hunts.js](config/hunts.js)**. Duplicate a hunt object in the array, give it a unique `id`, and edit its content. Nothing needs registering in the controller. The first checkpoint is the public start; the last is the finale. Counts, progress, map targets, and walking estimates come from this file.

Minimal complete hunt object:

```js
{
	id: "garden-walk",
	title: { en: "Garden Walk", pl: "Spacer po ogrodzie" },
	story: { en: "Discover a date on the gate.", pl: "Odkryj datę na bramie." },
	physical: false,
	estimatedDistanceKm: 0.2,
	estimatedDurationMinutes: 10,
	difficulty: "easy",
	terrain: { en: "Paved paths.", pl: "Utwardzone alejki." },
	startDescription: { en: "Start at the gate.", pl: "Zacznij przy bramie." },
	checkpoints: [{
		id: "garden-gate",
		title: { en: "Garden gate", pl: "Brama ogrodu" },
		position: [52.2300, 21.0100],
		questions: [{
			id: "garden-gate.date",
			type: "numeric",
			prompt: { en: "Which year is on the gate?", pl: "Jaki rok widnieje na bramie?" },
			accepted: { en: ["1924"], pl: ["1924"] },
			hints: { en: ["Look above the entrance."], pl: ["Spójrz nad wejście."] },
			explanation: { en: "The date is 1924.", pl: "Na bramie jest rok 1924." },
		}],
	}],
}
```

- `physical: true` requires both final questions and a simulated QR scan; `false` finishes on the final questions alone.
- `difficulty` is `easy`, `moderate`, or `hard`. `illustration: "pavilion"` is optional demo artwork; omit it for a generic pin.
- Coordinates are numeric `[latitude, longitude]`. Targets outside the bundled map area use the existing coordinate fallback; changing hunt config does not expand the map dataset.
- Question `type` is `text`, `numeric`, or `choice`. Accepted answers are strings, trimmed, whitespace-normalized, and lowercase. Numeric answers use exact demo strings, not the production numeric engine.
- Choice questions also need `options: [{ id: "bird", en: "Bird", pl: "Ptak" }, ...]`. Their accepted answers use option IDs in both languages.
- Supply both `en` and `pl` for every localized field. Hints are ordered arrays with equal lengths in both languages; empty arrays are allowed. Settings controls the language everywhere.
- Keep hunt IDs, checkpoint/question IDs, and their order stable when retaining saved runs. Use a new hunt ID for a different route structure. Incompatible or removed-hunt runs are skipped individually on reload, not used to discard other progress.

Reload the HTML after editing. With Node.js installed, check the config independently of the bundled demo regression tests:

```sh
npm run check:config
```

Errors name the hunt, checkpoint, question, and field to repair. **All answers in this file are public fictional fixtures. Never put private production answers or real QR secrets here.**

Run the prototype's gameplay and rendering regression tests with no dependency installation:

```sh
npm test
```

### Local map data

Coverage is a small central-Warsaw area: latitude 52.228-52.234, longitude 21.006-21.015 (roughly 600 by 670 metres). The [derived dataset](map/data.js) includes source, bounds, snapshot timestamp, and license metadata. It is a simplified ways-only extract, with relations and POIs omitted, not a routing dataset. Maps use vendored [Leaflet 1.9.4](https://leafletjs.com/) with its [BSD license](map/vendor/leaflet/LICENSE).

Map data: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), distributed under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). The locally published derived database remains ODbL; attribution is visible on every map. This data license is separate from the application code and Leaflet license.

To refresh this small extract during development, with Node.js and curl installed:

```sh
curl --fail --location 'https://api.openstreetmap.org/api/0.6/map.json?bbox=21.006,52.228,21.015,52.234' -o /tmp/signal-hunt-osm-extract.json
npm run map:build -- /tmp/signal-hunt-osm-extract.json
node --check map/data.js
```

The [conversion script](map/build-data.mjs) publishes only selected cartographic tags and geometry, not contributor-account metadata. Review geometry/coverage after refresh. Acquisition happens only during this explicit development step; opening the sketch does not contact OSM. Do not bulk-download public raster tiles. Larger regions need a separate self-hosted extract/vector-tile pipeline and update process; worldwide hosting is not implemented. The native MapLibre approach and privacy/fallback rules are in the technical specification. Local map availability does not enable offline gameplay.

## Implementation status

The repository contains specifications and a working local HTML prototype with embedded maps. Expo application and API implementation have not started. Native MapLibre support, compatible dependency versions, supported OS versions, and reference-device performance targets remain verification gates.
