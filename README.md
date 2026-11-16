# Signal Hunt

A working-title React Native / Expo portfolio application for real-world puzzle trails inspired by geocaching.

Players explore ordered checkpoints, solve randomly selected questions about their surroundings, and optionally follow a hunt whose finale requires both a QR scan and a final question set.

## Specifications

- [Product specification](specifications/product-specification.md): scope, journeys, screens, gameplay, privacy, and requirement IDs.
- [Technical specification](specifications/technical-specification.md): boundaries, data, API, state transitions, content, and local operations.
- [Verification plan](specifications/verification-plan.md): acceptance cases, test layers, implementation prerequisites, and open technical decisions.
- [Additional specification](specifications/additional-specification.md): navigation, interaction details, bilingual sample hunt, API examples, and proposed capacities.

## Prototype

See [prototype/PROTOTYPE.MD](prototype/PROTOTYPE.MD) for the prototype documentation.

## Project decisions

| Area                            | Decision                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Mobile                          | React Native, Expo, TypeScript, Android and iOS                                                                     |
| Languages                       | One Settings language for UI and hunts; complete Polish and English content                                         |
| Repository                      | npm workspaces; separate mobile/server applications; local contracts package                                        |
| Mobile routing and server state | Expo Router and TanStack Query                                                                                      |
| Backend                         | TypeScript, Fastify modular monolith, Zod, Drizzle, SQLite                                                          |
| Device persistence              | SQLite for safe snapshots/drafts; OS secure storage for credentials                                                 |
| Identity                        | Anonymous device credential; no signup or recovery                                                                  |
| Authority                       | Server owns answers, question draws, progression, and completion                                                    |
| Maps and navigation             | Map/List discovery, start/current-target maps, regional self-hosted OSM data; distance/bearing and external routing |
| Connectivity                    | Online-first; local progress preservation, not offline gameplay                                                     |
| Content                         | Team-authored private files, validated and released with backend deployments                                        |
| Hosting                         | Local development/demo only; public hosting is a separate future decision                                           |
| Style                           | Accessible outdoor utility, system light/dark themes                                                                |

## Backend

The API, shared contracts and content tooling are implemented as npm workspaces. Requires Node.js 22.12+.

```sh
npm install
npm run setup   # creates .env, migrates the SQLite database, loads the synthetic fixtures
npm run dev     # API on http://127.0.0.1:3000
npm run check   # type check, lint, format check, tests
```

| Path                                             | Contents                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [apps/server](apps/server)                       | Fastify modular-monolith API with Drizzle and persistent SQLite                     |
| [packages/contracts](packages/contracts)         | Runtime-neutral Zod schemas, types, error codes and route table                     |
| [packages/content-tools](packages/content-tools) | Private content validation and release preparation (never used by mobile)           |
| [content/synthetic](content/README.md)           | Public synthetic Polish/English fixtures; their answers and QR token are not secret |

See [docs/backend.md](docs/backend.md) for commands, configuration, the client integration contract, decisions on open
specification points, and what is not implemented or verified.

## Implementation status

The backend API, shared contracts, content tooling and their automated tests are implemented and run locally. The Expo
application has not been started. Native MapLibre support, Expo/React Native compatibility of the contracts package,
supported OS versions, real-device GPS/QR validation, and reference-device performance targets remain verification gates.
