# Changelog

All notable changes to the Open Brand Exchange specification. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [docs/versioning.md](docs/versioning.md).

## [Unreleased]

### Added
- **Excel templates** for brands: [`templates/products.xlsx`](templates/products.xlsx) and [`templates/assets.xlsx`](templates/assets.xlsx), generated from the schemas, [import-format.md](docs/import-format.md) and the Kestrel fixtures by `npm run templates`. The columns of the canonical CSV in order, text-formatted cells (so Excel keeps GTINs), dropdowns for every enumerated column, an explanation per column in English and Dutch, how to save as CSV UTF-8 and the image naming rule. `npm run check` fails when they drift.

## [0.2.0] - 2026-11-12

Product data for fashion, shoes, bags and luggage ([proposal 0002](docs/proposals/0002-product-data.md)). Additive: every new field is optional, a 0.1 document is still valid, and clients written for 0.1 keep working because they ignore what they do not know.

### Added
- **Article data** ([protocol.md §5.9](docs/protocol.md#59-article-data)): product `item_subtype` (recommended keys per item type), `contains_animal_origin`, `footwear_materials` (Directive 94/11/EC), `features` (a typed registry: `shell`, `wheels`, `lock`, `expandable`, `closure`, `laptop_compartment`, `water_resistance`, `detachable_parts`, `adjustable_parts`, `fit`, `sleeve_length`, `neckline`), `certifications` (`scheme`, `licence_number`, `scope`); variant `measurements` (fixed units in the key: cm, kg, l, inch; how to measure luggage and bags), `size_length`, `color.family`; fibre flags `recycled` and `organic`. New schemas Measurements, Features, FootwearMaterials, Certifications.
- `item_type` recommended key `luggage`; controlled part keys for `materials`; fibre keys named after Annex I of Regulation (EU) No 1007/2011.
- **Legal basis** table: what EU law requires (fibre composition, also online before purchase; "contains non-textile parts of animal origin"; footwear materials) and what is voluntary (care, country of origin, certifications; the textiles DPP is planned for Q4 2027).
- **Import format**: columns `item_subtype`, `contains_animal_origin`, `footwear_materials`, `certifications`, `feature:<key>`, `color_family`, `size_length` and the measurement columns; `(recycled)`/`(organic)` in the materials grammar; rule 9 per feature and measurement key ([import-format.md §1.6](docs/import-format.md#article-data)).
- **Label completeness warnings** with stable codes, in imports (rule 10) and in IngestResult `warning_details`: `fibre_composition_missing`, `animal_origin_unknown`, `footwear_materials_missing`, `fibre_percentages_not_100`. They never block publishing.
- **OBX in 10 minutes** ([docs/quickstart.md](docs/quickstart.md)) for a retailer's developer.
- Fixtures: a suitcase (KO-1008), a laptop bag (KO-1009) and a Chelsea boot (KO-1010) with images; article data on existing products; `fixtures/imports/` with expected results; expected objects for KO-1008, KO-1009, KO-1010 and KT-2001.
- Conformance: P-CAT-5 (article data round trip), P-CAT-6 (article data shape), I-IMP-7 (the new CSV columns), I-IMP-8 (label completeness warnings).

### Changed
- Schemas are published at `/schemas/v0.2/`; the 0.1 schemas stay unchanged at `/schemas/v0.1/`. `OBX-Version: 0.2`.
- The 0.1 fibre keys `recycled_*` and `organic_*` (`recycled_polyester`, `organic_cotton`, ...) are normalised to the fibre with a flag; a 0.2 node never returns them.
- The protocol, the README and the OpenAPI files say at the top that the protocol is the standard and the Ingest API and Node Admin API are optional companions.
- The fixture catalog grew to 11 products, 46 variants and 35 images; KO-1004 now has `size` `30`/`32`/`34` with `size_length` `32`.

### Migration
None required. Nodes and consumers written for 0.1 stay conformant on the 0.1 profile; to pass 0.2 conformance a node stores and returns the new fields (as `null` when unknown) and normalises the 0.1 fibre keys. Consumers that also read 0.1 nodes SHOULD treat `recycled_<fibre>` / `organic_<fibre>` like the fibre with the flag.

## [0.1.0] - 2026-11-12

The first release. Implemented by three portals in three runtimes (Cloudflare, Google Cloud & Docker, web hosting), the Go SDK and CLI, and the conformance suite; see [docs/implementations.md](docs/implementations.md).

### Added
- **Conformance without the Ingest or Node Admin API**: the protocol profile is what "OBX-conformant" means. A node that loads the fixtures with its own import runs it with an operator that does the brand-side steps ([conformance.md](docs/conformance.md#nodes-without-the-ingest-or-node-admin-api)).
- **OBX Protocol** (normative): discovery at `/.well-known/obx`, access requests with one-time credential hand-over, OAuth2 client credentials with scopes `catalog:read`, `media:read`, `media:original`, `usage:write`, grants, the change feed (snapshot then live, tombstones kept ≥ 90 days, `cursor_expired`, grant resync), products with variants and assets, GTIN lookup (≤ 2000, GTIN-14 normalisation), renditions (`original` unmodified, `web`, `square`, `thumb`) with ETag, Range and `OBX-Content-SHA256`, bulk exports (NDJSON manifest + zip parts), webhooks with HMAC-SHA256 signatures, usage events, problem+json errors with `obx_error`, rate limit headers.
- **OBX Ingest API** (optional; normative for nodes that offer it): idempotent PUT/PATCH/DELETE keyed by the brand's external ids, content-addressed blobs with dedupe, resumable multipart uploads, client-generated renditions for nodes without an image library, batch (JSON or NDJSON), asset reordering, canonical imports with `upsert`/`mirror`/`dry_run` and image manifests, jobs, and the exact mapping of writes to `/changes`.
- **Node Admin + Portal API** (non-normative) for the shared admin UI: setup wizard with setup code, sessions with CSRF, settings and branding (including `branding.portal_name`, the brand's own word for its portal per language), catalog management, uploads and scheduled pull imports (HTTPS, SFTP, S3), retailers, access requests, invitations, API clients, ingest tokens, webhooks, statistics, and the retailer portal (browse, facets, EAN list, selection, zips, CSV, background download jobs, self-service API clients).
- JSON Schemas (2020-12) for every object.
- **Canonical import format**: `products.csv`, `assets.csv`, image filename pattern `{style}_{color}_{position}[_qualifier].ext` (with `ALL` for images of every colour), package layout, materials grammar, care codes (ISO 3758 aligned), fibre keys.
- **Security requirements** ([security.md](docs/security.md)): retailer isolation, hashed and encrypted secrets, sessions and CSRF, signed URLs, one SSRF rule for every node (link-local and cloud metadata always refused, the checked address pinned for the connection), CORS only on discovery, upload and archive limits, e-mail links never built from the request's `Host`.
- **Conformance profiles** `protocol`, `ingest`, `portal` and `security` with test ids ([conformance.md](docs/conformance.md)).
- **Glossary** of the words people see, in 25 languages, including the foundation's name and imprint line ([glossary.md](docs/glossary.md)).
- **Governance**: the publisher, the plan for the Open Brand Exchange Foundation (in formation), a Dutch *stichting*, and a sketch of its statutes in English and Dutch ([governance.md](docs/governance.md), [governance/](governance)).
- Documentation: protocol, ingest, import format, automation recipes, security, conformance, directory, versioning, implementations.
- Fixtures: fictional "Kestrel Outfitters" catalog with generated images, expected protocol objects, ingest replay script with expected results and change entries, example documents (referenced as examples from the OpenAPI files), webhook signature test vector.
- Rendered HTML reference, single-file OpenAPI bundles and the schemas at their `$id` paths in `site/`, for the website. The pages carry their own Content-Security-Policy, load nothing from other hosts, and pass axe (WCAG 2.1 AA) on desktop and phone.
- Node Admin API: optional read-only `Settings.node.cron` (`url`, `command`, `last_run_at`) for nodes that need an outside scheduler, so the admin can show the cron address again after installation.
- Node Admin API: optional read-only `Settings.node.source_kinds`, the kinds of scheduled import a node can run (absent = all), so the admin UI does not offer SFTP on a node that cannot open it.
- `assets.csv` in every portal download zip ([import-format.md §2.3](docs/import-format.md#assets-csv-in-downloads)): one row per image with its effective rights, embargo and AI provenance, in the columns of the import format, so they travel with the files. The background download's article data is `data.csv`.
- Test vectors for the image filename rule in `fixtures/expected/image-filenames.json`, which every implementation runs.
- Tooling: `npm run check` (Redocly lint, Ajv validation of schemas, fixtures and OpenAPI examples, glossary, links, versions, licences, `site/` freshness), `npm run build:site`, `npm run test:site` (Playwright + axe), `npm run package`; CI and a tag-triggered release workflow.
- Project files: SECURITY.md (security@openbrandexchange.com), CONTRIBUTING.md (DCO sign-off), CODE_OF_CONDUCT.md (Contributor Covenant 2.1), NOTICE, issue and pull request templates.

### Clarified during the implementation of the three portals
- `IngestRecord` (GET in the Ingest API and the admin catalog): for assets, `data.rights` is the full effective Rights object and `data.provenance` the full Provenance, both with defaults applied; `data.files` lists every current blob, renditions made by the node included, with `sha256`, `width` and `height`; `missing_files` is present (possibly `[]`) for assets only and omitted for other kinds.
- Ingest round trip ([ingest.md §3.4](docs/ingest.md#34-validation-rules)): PUTting back the `data` of a GET is `unchanged`; rights and provenance fields equal to the defaults are not stored, and renditions the node made itself are not client-supplied ones.
- `ImportRowError.row` is `null` for header and file-level problems.
- Import counts count a brand only when the import created it.
- Image file names: two-part qualifiers (`size_chart`, `tilted_left`, `tilted_right`) are matched first; the rightmost role and view win; `other` is the view next to another role; `ALL` as colour means all colours (external id `{style}_ALL_{position}`).
- Imports never take away what they do not state about an image the node already has ([import-format.md rule 8](docs/import-format.md#4-processing-rules)): alt text, rights, provenance and status change only where the image's `assets.csv` row has a value, so an import of the images alone keeps embargoes, credits and AI labels, including those set in the admin.
- A column that an import file does not have leaves that field of an existing product or variant as it is, per language for texts ([import-format.md rule 9](docs/import-format.md#4-processing-rules)); an empty cell in a column the file has still removes the value.
- GTIN lookup echoes the input trimmed of leading and trailing whitespace.
- Conformance I-REPLAY-2 compares with the expected entries minus upserts of objects that are no longer visible after the batch ([protocol.md §6.2](docs/protocol.md#62-what-a-consumer-sees)).
- `405 method_not_allowed` is a SHOULD; a node MAY answer `404`.
- E-mail links use `OBX_PUBLIC_URL` or the address recorded at setup, never the request's `Host` (password-reset poisoning).
- API keys made in the admin default to `catalog:read` and `media:read` (+ `media:original` when allowed); `usage:write` only on request.
- The public directory is `public/directory.json` in the website repository; `x-obx-demo` marks demonstration entries.
