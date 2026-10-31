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

## Implementation status

Expo application and API implementation have not started. Native MapLibre support, compatible dependency versions, supported OS versions, and reference-device performance targets remain verification gates.
