# Open Brand Exchange: the specification

**Open Brand Exchange (OBX)** is a free, open way for **brands** to deliver their final product content to their **retailers**: product data per size with GTIN, materials and care, and the final images with their order, view, usage rights and AI provenance. One publication, every retailer; no per-retailer integrations, no platform lock-in.

A brand runs (or has someone host) an **OBX node**. The node gives the brand three things:

1. **A retailer portal.** Retailers request access, log in, search and filter the catalog, paste a list of EANs, and download images (original, web, square) and article data as zip or CSV. The brand sees who downloads what.
2. **A standard API** retailers' software can pull from: discovery, OAuth2 client credentials, a change feed with deletions, GTIN lookup, renditions with checksums, bulk exports, webhooks.
3. **Easy automation** for the brand's own systems: a scheduled pull from a web address, SFTP or S3 bucket, a drop folder, the `obx` command-line tool, a GitHub Action, or n8n/Make/Zapier, all using one canonical CSV and an image naming pattern.

This repository is the **source of truth** that every implementation follows.

| | |
|---|---|
| [`openapi/obx-protocol.yaml`](openapi/obx-protocol.yaml) | **OBX Protocol** (normative): what retailers' software reads |
| [`openapi/obx-ingest.yaml`](openapi/obx-ingest.yaml) | **OBX Ingest API** (normative): how a brand's automation publishes |
| [`openapi/node-admin.yaml`](openapi/node-admin.yaml) | Node Admin + Portal API (non-normative): shared by the admin UI and the reference nodes |
| [`schemas/`](schemas) | JSON Schema 2020-12 for every object |
| [`docs/protocol.md`](docs/protocol.md) | the readable specification (start here) |
| [`docs/ingest.md`](docs/ingest.md) · [`docs/import-format.md`](docs/import-format.md) · [`docs/automation.md`](docs/automation.md) | publishing and automating |
| [`docs/security.md`](docs/security.md) · [`docs/conformance.md`](docs/conformance.md) | requirements and tests |
| [`docs/implementations.md`](docs/implementations.md) · [`docs/go-live.md`](docs/go-live.md) | the portals that implement it, what they pass, where they run, known gaps; what is left before the first release |
| [`docs/directory.md`](docs/directory.md) · [`docs/versioning.md`](docs/versioning.md) · [`docs/governance.md`](docs/governance.md) | ecosystem |
| [`fixtures/`](fixtures) | the fictional "Kestrel Outfitters" catalog, expected API output and an ingest replay script |
| [`site/`](site) | the rendered HTML reference of the three APIs, single-file OpenAPI bundles and the schemas at their `$id` paths (generated; the website includes it) |
| [`docs/glossary.md`](docs/glossary.md) | the words people see, in 25 languages |
| [`governance/`](governance) | the sketch of the foundation's statutes (English and Dutch) |

## 60-second tour

For a **brand**: export your products as [`products.csv`](fixtures/kestrel/products.csv) (one row per size), name your photos `KO-1001_NVY_1.jpg` (style, colour, position), and let your node pick them up every night. Retailers see them in your portal and in their software.

For a **retailer's developer**:

```sh
curl -s https://brands.kestrel.example/.well-known/obx                                       # what does this brand offer?
curl -s -u "$ID:$SECRET" -d grant_type=client_credentials https://brands.kestrel.example/obx/v1/oauth/token
curl -s -H "Authorization: Bearer $TOKEN" "https://brands.kestrel.example/obx/v1/changes?limit=500"   # everything, then only changes
```

For an **implementer**: read [`docs/protocol.md`](docs/protocol.md) and [`docs/ingest.md`](docs/ingest.md), then run the conformance suite ([`docs/conformance.md`](docs/conformance.md)).

## Implementations

| Repository | What | Licence |
|---|---|---|
| [obx-go](https://github.com/openbrandexchange/obx-go) | Go SDK, the `obx` CLI, `obx-conformance`, mock node | Apache-2.0 |
| [admin-ui](https://github.com/openbrandexchange/admin-ui) | shared web UI: brand admin + retailer portal | Apache-2.0 |
| [node-go](https://github.com/openbrandexchange/node-go) · [node-php](https://github.com/openbrandexchange/node-php) · [node-ts](https://github.com/openbrandexchange/node-ts) | the brand node in Go, PHP and TypeScript (Cloudflare Workers) | AGPL-3.0 |

## Working on this repository

Needs Node.js 20 or later.

```sh
npm ci
npm run check        # lint, validation, links, versions, and that site/ is up to date
npm run build:site   # regenerate site/ after changing openapi/ or schemas/
npm run test:site    # the rendered reference in Chromium, desktop and phone: self-contained, viewer starts, axe clean
                     # (first time: npx playwright install chromium)
npm run fixtures     # regenerate fixtures (python3, standard library only; see fixtures/README.md first)
npm run package      # the release bundle in dist/ (what the release workflow publishes)
```

`npm run check` must pass before every commit. It lints the three OpenAPI files (Redocly), compiles every schema in Ajv strict mode, validates every fixture, expected object and OpenAPI example, checks GTIN check digits, the CSV columns, the image filename rule, that every error code is documented, that the glossary has all 25 languages, that every link between the documents resolves, that the version is the same everywhere, that nothing unfinished is left in the documents, and that `site/` matches the sources. See [CONTRIBUTING.md](CONTRIBUTING.md) (sign your commits) and [SECURITY.md](SECURITY.md) (report vulnerabilities to security@openbrandexchange.com).

## Status and licence

Version **0.1.0** ([changelog](CHANGELOG.md)). Before 1.0, minor versions may still contain breaking changes, each with a migration note ([versioning](docs/versioning.md)). Three portals in three runtimes, the Go SDK and the conformance suite implement it ([implementations](docs/implementations.md)).

Open Brand Exchange is an initiative of Richard Lindhout · Open Brand Exchange Foundation (in formation). It is designed to be vendor-neutral, and the copyright, the name and the domain are to be transferred to a Dutch foundation (*stichting*); see [governance](docs/governance.md). Contact: hello@openbrandexchange.com.

Licensed under [Creative Commons Attribution 4.0 International](LICENSE) (CC-BY-4.0). You may implement, copy and adapt it, including commercially, with attribution ([NOTICE](NOTICE)).
