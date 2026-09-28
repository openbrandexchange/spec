# Changelog

All notable changes to the Open Brand Exchange specification. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [docs/versioning.md](docs/versioning.md).

## [Unreleased]

### Clarified
- `IngestRecord` (GET in the Ingest API and the admin catalog): for assets, `data.rights` is the full effective Rights object and `data.provenance` the full Provenance, both with defaults applied; `data.files` lists every current blob, renditions made by the node included, with `sha256`, `width` and `height`; `missing_files` is present (possibly `[]`) for assets only and omitted for other kinds. Found by the cross-implementation interop run: the three nodes answered this in three different ways.
- `ImportRowError.row` is `null` for header and file-level problems.

- Ingest round trip ([ingest.md §3.4](docs/ingest.md)): PUTting back the `data` of a GET is `unchanged`; rights and provenance fields equal to the defaults are not stored (the asset keeps following the node's default rights), and renditions the node made itself are not client-supplied ones.
- [security.md §3](docs/security.md): e-mail links use `OBX_PUBLIC_URL` or the address recorded at setup, never the request's `Host` (password-reset poisoning).

### Added
- Node Admin API: `branding.portal_name`, the brand's own word for its portal per language.
- Conformance `security` profile (S-HDR-1 … S-RATE-2) in [conformance.md](docs/conformance.md), part of `all`.
- [docs/implementations.md](docs/implementations.md): the three portals, conformance per profile, the cross-implementation interop result, the security review, hosting and automation options and the known gaps.

## [0.1.0-draft] - 2026-09-28

### Added
- OBX Protocol (normative): discovery at `/.well-known/obx`, access requests with one-time credential hand-over, OAuth2 client credentials with scopes `catalog:read`, `media:read`, `media:original`, `usage:write`, grants, the change feed (snapshot then live, tombstones kept ≥ 90 days, `cursor_expired`, grant resync), products with variants and assets, GTIN lookup (≤ 2000, GTIN-14 normalisation), renditions (`original` unmodified, `web`, `square`, `thumb`) with ETag, Range and `OBX-Content-SHA256`, bulk exports (NDJSON manifest + zip parts), webhooks with HMAC-SHA256 signatures, usage events, problem+json errors with `obx_error`, rate limit headers.
- OBX Ingest API (normative): idempotent PUT/PATCH/DELETE keyed by the brand's external ids, content-addressed blobs with dedupe, resumable multipart uploads, client-generated renditions for nodes without an image library, batch (JSON or NDJSON), asset reordering, canonical imports with `upsert`/`mirror`/`dry_run` and image manifests, jobs, and the exact mapping of writes to `/changes`.
- Node Admin + Portal API (non-normative) for the shared admin UI: setup wizard with setup code, sessions with CSRF, settings and branding, catalog management, uploads and scheduled pull imports (HTTPS, SFTP, S3), retailers, access requests, invitations, API clients, ingest tokens, webhooks, statistics, and the retailer portal (browse, facets, EAN list, selection, zips, CSV, background download jobs, self-service API clients).
- JSON Schemas (2020-12) for every object.
- Canonical import format: `products.csv`, `assets.csv`, image filename pattern `{style}_{color}_{position}[_qualifier].ext`, package layout, materials grammar, care codes (ISO 3758 aligned), fibre keys.
- Documentation: protocol, ingest, import format, automation recipes, security, conformance profiles, directory, versioning, governance.
- Fixtures: fictional "Kestrel Outfitters" catalog with generated images, expected protocol objects, ingest replay script with expected results and change entries, example documents, webhook signature test vector.
- Tooling: `npm run check` (Redocly lint + Ajv validation).
