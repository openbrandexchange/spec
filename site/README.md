# site/: generated, do not edit

Built by `npm run build:site` (tools/build-site.mjs) from `openapi/` and `schemas/`; CI fails when it is out of date.

| Path | What |
|---|---|
| `index.html` | overview page |
| `protocol.html`, `ingest.html`, `admin.html` | rendered API reference (Redocly), pre-rendered HTML that the Redoc viewer hydrates |
| `openapi/*.yaml` | single-file OpenAPI bundles (no external `$ref`s), for tools and code generators |
| `schemas/v0.3/*.json` | the JSON Schemas at the path of their `$id` (`https://openbrandexchange.com/schemas/v0.3/…`) |
| `vocabularies/v0.3/*.json` | the codes of materials and care with their names per language |
| `assets/redoc.standalone.js` | the Redoc viewer (MIT, `assets/redoc.LICENSE`; bundled libraries in `redoc.standalone.js.LICENSE.txt`), served locally instead of from a CDN |

For the website: copy this folder as it is, for example to `/reference/`, and serve `schemas/` at `/schemas/` so the schema `$id`s resolve. The pages work without JavaScript (the content is pre-rendered); with JavaScript the viewer adds search and navigation. Every page, the overview included, carries its own Content-Security-Policy in a `<meta>` element (the API pages allow their one inline start-up script by hash), so a host should not add a stricter policy header for this folder.
