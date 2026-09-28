# Changelog

All notable changes to the Open Brand Exchange specification. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [docs/versioning.md](docs/versioning.md).

## [Unreleased]

## [0.1.0] - 2026-09-28

The first release. Implemented by three portals in three runtimes (Cloudflare, Google Cloud & Docker, web hosting), the Go SDK and CLI, and the conformance suite; see [docs/implementations.md](docs/implementations.md).

### Added
- **OBX Protocol** (normative): discovery at `/.well-known/obx`, access requests with one-time credential hand-over, OAuth2 client credentials with scopes `catalog:read`, `media:read`, `media:original`, `usage:write`, grants, the change feed (snapshot then live, tombstones kept ≥ 90 days, `cursor_expired`, grant resync), products with variants and assets, GTIN lookup (≤ 2000, GTIN-14 normalisation), renditions (`original` unmodified, `web`, `square`, `thumb`) with ETag, Range and `OBX-Content-SHA256`, bulk exports (NDJSON manifest + zip parts), webhooks with HMAC-SHA256 signatures, usage events, problem+json errors with `obx_error`, rate limit headers.
- **OBX Ingest API** (normative): idempotent PUT/PATCH/DELETE keyed by the brand's external ids, content-addressed blobs with dedupe, resumable multipart uploads, client-generated renditions for nodes without an image library, batch (JSON or NDJSON), asset reordering, canonical imports with `upsert`/`mirror`/`dry_run` and image manifests, jobs, and the exact mapping of writes to `/changes`.
- **Node Admin + Portal API** (non-normative) for the shared admin UI: setup wizard with setup code, sessions with CSRF, settings and branding (including `branding.portal_name`, the brand's own word for its portal per language), catalog management, uploads and scheduled pull imports (HTTPS, SFTP, S3), retailers, access requests, invitations, API clients, ingest tokens, webhooks, statistics, and the retailer portal (browse, facets, EAN list, selection, zips, CSV, background download jobs, self-service API clients).
- JSON Schemas (2020-12) for every object.
- **Canonical import format**: `products.csv`, `assets.csv`, image filename pattern `{style}_{color}_{position}[_qualifier].ext` (with `ALL` for images of every colour), package layout, materials grammar, care codes (ISO 3758 aligned), fibre keys.
- **Security requirements** ([security.md](docs/security.md)): retailer isolation, hashed and encrypted secrets, sessions and CSRF, signed URLs, one SSRF rule for every node (link-local and cloud metadata always refused, the checked address pinned for the connection), CORS only on discovery, upload and archive limits, e-mail links never built from the request's `Host`.
- **Conformance profiles** `protocol`, `ingest`, `portal` and `security` with test ids ([conformance.md](docs/conformance.md)).
- **Glossary** of the words people see, in 25 languages, including the foundation's name and imprint line ([glossary.md](docs/glossary.md)).
- **Governance**: the publisher, the plan for the Open Brand Exchange Foundation (in formation), a Dutch *stichting*, and a sketch of its statutes in English and Dutch ([governance.md](docs/governance.md), [governance/](governance)).
- Documentation: protocol, ingest, import format, automation recipes, security, conformance, directory, versioning, implementations.
- Fixtures: fictional "Kestrel Outfitters" catalog with generated images, expected protocol objects, ingest replay script with expected results and change entries, example documents (referenced as examples from the OpenAPI files), webhook signature test vector.
- Rendered HTML reference, single-file OpenAPI bundles and the schemas at their `$id` paths in `site/`, for the website.
- Tooling: `npm run check` (Redocly lint, Ajv validation of schemas, fixtures and OpenAPI examples, glossary, links, versions, `site/` freshness), `npm run build:site`, `npm run package`; CI and a tag-triggered release workflow.
- Project files: SECURITY.md (security@openbrandexchange.com), CONTRIBUTING.md (DCO sign-off), CODE_OF_CONDUCT.md (Contributor Covenant 2.1), NOTICE, issue and pull request templates.

### Clarified during the implementation of the three portals
- `IngestRecord` (GET in the Ingest API and the admin catalog): for assets, `data.rights` is the full effective Rights object and `data.provenance` the full Provenance, both with defaults applied; `data.files` lists every current blob, renditions made by the node included, with `sha256`, `width` and `height`; `missing_files` is present (possibly `[]`) for assets only and omitted for other kinds.
- Ingest round trip ([ingest.md §3.4](docs/ingest.md#34-validation-rules)): PUTting back the `data` of a GET is `unchanged`; rights and provenance fields equal to the defaults are not stored, and renditions the node made itself are not client-supplied ones.
- `ImportRowError.row` is `null` for header and file-level problems.
- Import counts count a brand only when the import created it.
- Image file names: two-part qualifiers (`size_chart`, `tilted_left`, `tilted_right`) are matched first; the rightmost role and view win; `other` is the view next to another role; `ALL` as colour means all colours (external id `{style}_ALL_{position}`).
- GTIN lookup echoes the input trimmed of leading and trailing whitespace.
- Conformance I-REPLAY-2 compares with the expected entries minus upserts of objects that are no longer visible after the batch ([protocol.md §6.2](docs/protocol.md#62-what-a-consumer-sees)).
- `405 method_not_allowed` is a SHOULD; a node MAY answer `404`.
- E-mail links use `OBX_PUBLIC_URL` or the address recorded at setup, never the request's `Host` (password-reset poisoning).
- API keys made in the admin default to `catalog:read` and `media:read` (+ `media:original` when allowed); `usage:write` only on request.
- The public directory is `public/directory.json` in the website repository; `x-obx-demo` marks demonstration entries.
