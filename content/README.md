# Hunt content

| Directory    | Purpose                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `synthetic/` | **Public synthetic fixtures.** Fictional bilingual hunts used by tests and the local demo.        |
| `private/`   | Git-ignored location for real team-authored content. Never commit real answers or QR tokens here. |

Everything under `synthetic/` is public demonstration material. Its accepted answers and its QR
token (`finale.qrToken` in `hunts/demo-square/v1.json`) are committed in clear text and are **not
secret**. The coordinates are invented and do not describe real landmarks or containers.

## Layout

```text
<content-dir>/
  release.json                     which version of each hunt is current, and availability
  hunts/<huntId>/v<version>.json   one immutable hunt version per file
  media/...                        optional images referenced by `media[].file`
```

Validate a directory with `npm run content:validate -- content/synthetic` and register it with
`npm run content:load`. See [docs/backend.md](../docs/backend.md#content-release) for the rules.
