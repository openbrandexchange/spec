# Conformance

An implementation is **OBX-conformant** for a profile when `obx-conformance` (in [obx-go](https://github.com/openbrandexchange/obx-go), `cmd/obx-conformance`) passes every REQUIRED test of that profile against it. Results are reported per test id so implementations can say exactly what they support.

| Profile | Tests | Who needs it |
|---|---|---|
| **protocol** | the read side ([protocol.md](protocol.md)) | every node; normative |
| **ingest** | the write side ([ingest.md](ingest.md), [import-format.md](import-format.md)) | every node that accepts automation; normative |
| **portal** | the Node Admin + Portal API ([node-admin.yaml](../openapi/node-admin.yaml)) | nodes that want to run the shared `admin-ui`; non-normative |

## Running

```sh
obx-conformance protocol --url https://node.example --client-id obxc_… --client-secret obxs_… [--second-client …] [--fixtures ./spec/fixtures]
obx-conformance ingest   --url https://node.example --token obxi_… --client-id … --client-secret …   # needs a fresh node
obx-conformance portal   --url https://node.example --setup-code …                                  # needs a fresh node
obx-conformance all      --url http://localhost:8080 --setup-code …                                 # fresh node: setup, then everything
```

`all` on a **fresh** node is the reference path used in CI by every node repository: it completes setup (company "Kestrel Outfitters", first brand "Kestrel" → external id `kestrel`, languages `nl,en`), creates an ingest token and two retailers with API clients (one restricted to brand `kestrel`, one without originals), imports [`fixtures/kestrel`](../fixtures/kestrel), then runs all profiles. The suite also ships a **mock node** (`obx-conformance mock`) that passes everything, for developing consumers.

## Fixture conventions

- Expected JSON in [`fixtures/expected`](../fixtures/expected) is matched structurally: every expected key must be present with an equal value; actual objects may contain extra keys only when prefixed `x-`. Arrays match element by element in order.
- Placeholders: `{{id}}` any id; `{{datetime}}` any RFC 3339 timestamp; `{{datetime|null}}` a timestamp or null; `{{url}}` any absolute URL; `{{sha256}}` any 64-hex string; `{{int}}` any integer; `{{product:<external_id>}}` the ProductDetail of that product.
- Ids that must be consistent (for example `product_id` of an asset) are checked against the object actually returned for the parent.
- `fixtures/kestrel/images.json` lists sha256, bytes and dimensions of every original.

## Protocol profile (REQUIRED unless marked)

| Id | Test |
|---|---|
| P-DISC-1 | `/.well-known/obx` is public, valid DiscoveryDocument, CORS `*`, `api_base` ends in `/obx/v1` |
| P-DISC-2 | capabilities include `changes`, `products`, `by_gtin`, `renditions`; each advertised optional capability works and each missing one answers `501 not_implemented` |
| P-AUTH-1 | token endpoint: `client_secret_basic` works; wrong secret → 401 `invalid_client`; unknown scope → 400 `invalid_scope` |
| P-AUTH-2 | no/invalid token → 401 problem+json with `unauthorized` / `invalid_token`; revoked client → `access_revoked` on the next call |
| P-AUTH-3 | `media:original` not granted → no `original` rendition in any response, and 403 on `/renditions/original` |
| P-ACC-1 | access request → 202 + token; status polling; approve (via portal profile or operator) → credentials exactly once |
| P-FEED-1 | snapshot from empty cursor lists exactly the visible fixture objects (counts in `expected/counts.json`), in type order, then a `live` page |
| P-FEED-2 | `next_cursor` always present; paging with `limit=1` yields the same entries as `limit=500` |
| P-FEED-3 | unknown/garbage cursor → 400 `cursor_invalid` |
| P-FEED-4 | restricted retailer sees only brand `kestrel` objects in snapshot, live entries, lookups and exports |
| P-FEED-5 | ingest replay (`fixtures/ingest`) produces exactly `expected-changes.json` (see ingest profile; run when both profiles are enabled) |
| P-FEED-6 | grant change → `grant` entry with `resync: true` |
| P-CAT-1 | `GET /products/{id}` of KO-1001 and KO-1005 match `expected/product-*.json` |
| P-CAT-2 | `GET /products` keyset pagination is complete and stable; `ids=` filter; unknown ids silently omitted |
| P-CAT-3 | by-GTIN POST with `expected/gtin-lookup.request.json` matches `expected/gtin-lookup.json`; 2001 codes → 400 `limit_exceeded` |
| P-CAT-4 | invisible object → 404 (never 403) |
| P-MEDIA-1 | assets match `expected/asset-*.json` (AI provenance, embargo, large original, no-original client) |
| P-MEDIA-2 | every rendition: bytes hash to `sha256`; `ETag` and `OBX-Content-SHA256` headers; `Range` → 206; `If-None-Match` → 304; signed URL works without Authorization until expiry |
| P-MEDIA-3 | `original` bytes are identical to the fixture file; web ≤ 2000 px, thumb ≤ 600 px, square is square, all `image/jpeg`, never upscaled |
| P-ERR-1 | every 4xx/5xx body is problem+json with a known `obx_error` |
| P-RATE-1 | rate-limited responses carry `RateLimit-*`; 429 carries `Retry-After` (tested with a low limit when the node offers `--test-rate-limit`) |
| P-EXP-1 | (if `exports`) export of brand `kestrel` with web renditions: manifest header, lines valid, every file line matches a zip entry and its hash; `changes_cursor` usable |
| P-HOOK-1 | (if `webhooks`) subscribe to a local receiver; `webhook.test` arrives with a valid signature and timestamp; https-only and private-address targets rejected |
| P-USE-1 | (if `usage`) `POST /usage` → 202 with accepted count; appears in admin stats (portal profile) |

## Ingest profile

| Id | Test |
|---|---|
| I-INFO-1 | `GET /obx/v1/ingest` valid IngestInfo; limits ≥ the minimums in ingest.md §9 |
| I-AUTH-1 | missing scope → 403 `insufficient_scope`; brand-restricted token cannot write another brand |
| I-REPLAY-1 | replay [`fixtures/ingest/script.ndjson`](../fixtures/ingest) one operation at a time (PUT/PATCH/DELETE endpoints); results match `expected-results.json`; after each operation the new `/changes` entries match `expected-changes.json` (`after_op`). Before an asset operation's entries are read, the runner waits until the asset is no longer `pending_files` (max 60 s). On nodes with `server_generated: false` the runner adds client-generated renditions to `files`. |
| I-REPLAY-2 | the same script with every `external_id` (and `brand_external_id`/`product_external_id` reference) suffixed `-b`, sent as one `POST /batch` (JSON array), then suffixed `-c` as NDJSON, gives the same results and change entries |
| I-IDEM-1 | repeating any upsert → `unchanged` and no change entry; `Idempotency-Key` returns the same job |
| I-FILE-1 | blob HEAD/PUT dedupe; wrong sha256 → 422 `checksum_mismatch`; unknown sha in `files` → 422 `blob_missing` |
| I-FILE-2 | multipart upload of a 12 MiB file in parts, resume after skipping a part (`upload_incomplete` first), complete |
| I-VAL-1 | invalid GTIN, duplicate GTIN, position conflict, unknown parent → the documented codes |
| I-IMP-1 | import of `fixtures/kestrel` as package zip and as csv+assets_csv+images gives the expected objects; second import → all unchanged, no change entries |
| I-IMP-2 | import with `images_manifest` instead of images gives the same result |
| I-IMP-3 | mirror import of a CSV missing one product unpublishes exactly that product; a mirror CSV with only one of the six Kestrel products → `mass_unpublish_refused`; zip with `../evil.jpg` → `import_invalid` and nothing written |
| I-IMP-4 | row errors carry file, row, column and code; the job still succeeds |

## Portal profile

| Id | Test |
|---|---|
| A-SETUP-1 | setup requires the setup code; before setup other endpoints → 409 `setup_required`; after → 409 `setup_completed` |
| A-SESS-1 | login/logout; wrong password → 401 `invalid_credentials`; state-changing request without `X-CSRF-Token` → 403 `csrf_failed`; cookie flags |
| A-INV-1 | invite retailer user → invite link works once; `invite_invalid` afterwards |
| A-RET-1 | approve an access request with API → requester receives credentials once; reject with reason → requester sees reason |
| A-RET-2 | block retailer → sessions end, API → `access_revoked` |
| A-KEY-1 | API client and ingest token: secret shown once, rotate invalidates the old one, revoke works |
| A-CAT-1 | admin catalog writes behave like ingest (same results and change entries) |
| A-SRC-1 | import source with `https://127.0.0.1/…` → 422 `unsafe_url`; credentials never returned |
| A-PORT-1 | retailer: product list, facets, detail, GTIN paste, selection, product zip, selection zip (entries and names), CSV (canonical columns, formula-escaped), download job with file |
| A-PORT-2 | retailer restricted to `kestrel` never sees `kestrel-trail` anywhere; originals hidden when not allowed |
| A-STAT-1 | downloads by retailers appear in stats; admin preview downloads do not |
