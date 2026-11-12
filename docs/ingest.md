# OBX Ingest API 0.2

**Status:** v0.2.0. Optional; normative for nodes that offer it (capability `ingest`). The [OBX Protocol](protocol.md) is the standard; how content gets into a node is up to the node. Contract: [`openapi/obx-ingest.yaml`](../openapi/obx-ingest.yaml). RFC 2119 keywords as in [protocol.md](protocol.md).

The Ingest API is how a brand's **own systems** publish to a node: a PIM or ERP connector, a nightly spreadsheet export, a DAM, the `obx` command-line tool, a GitHub Action, n8n/Make/Zapier. Because every conforming node speaks it, a brand's automation keeps working when it moves between nodes (self-hosted, a different runtime, a vendor).

Base URL: `https://<host>/obx/v1/ingest` (also advertised as `ingest_url` in the discovery document).

## 1. Authentication

`Authorization: Bearer obxi_…`. Ingest tokens are created, rotated and revoked in the node admin, shown once, stored hashed. Scopes:

| Scope | Allows |
|---|---|
| `ingest:read` | `GET` records, jobs, info; `HEAD` blobs |
| `ingest:write` | `PUT`/`PATCH` records, uploads, batch, imports, publish/unpublish |
| `ingest:delete` | `DELETE` records, and `mirror` imports (they unpublish) |

A token MAY be restricted to some brands (`brand_external_ids`); any write touching another brand fails with `403 forbidden`. A revoked or expired token gets `401 access_revoked`.

Start with `GET /obx/v1/ingest` ([IngestInfo](../schemas/IngestInfo.json)): who the token is, limits (single upload size, part size, batch size, import size), the brands, the content languages, the node's default publication status and whether the node renders images itself.

## 2. Keys: the brand's own ids

Everything is addressed by the brand's **external id** in the path (percent-encoded; 1–200 characters, no control characters and no `/`):

| Object | Path | Convention when the brand has no separate id |
|---|---|---|
| brand | `/brands/{external_id}` | slug of the brand name (`Kestrel Trail` → `kestrel-trail`) |
| product | `/products/{external_id}` | the style number |
| variant | `/variants/{external_id}` | the GTIN as supplied; without GTIN `<style>-<color>-<size>` |
| asset | `/assets/{external_id}` | `<style>_<color>_<position>` (the image filename pattern without qualifiers and extension); `<style>_ALL_<position>` for an image of all colours ([import-format.md](import-format.md#all-colours)) |

Parents are referenced by external id in the body (`brand_external_id`, `product_external_id`). `brand_external_id` MAY be omitted when the node has exactly one brand. The node assigns the protocol `id`s and returns them in results.

The **slug** rule (used for brands created from a name, e.g. by CSV import or first-run setup): lowercase, every run of characters outside `a-z0-9` becomes `-`, leading/trailing `-` removed, Unicode letters are first stripped of diacritics (`É` → `e`).

## 3. Writes

### 3.1 PUT = create or replace
`PUT` with a [BrandInput](../schemas/BrandInput.json), [ProductInput](../schemas/ProductInput.json), [VariantInput](../schemas/VariantInput.json) or [AssetInput](../schemas/AssetInput.json) creates the object or replaces it completely: omitted optional fields become `null`. Two exceptions:

- **`status`**: when omitted, an existing object keeps its status; a new object gets the node's default (`published` unless the brand changed it). A nightly sync therefore never re-publishes something a person unpublished, unless it sends `status` explicitly.
- **asset `files`**: when omitted, the current files stay.

Nodes MUST ignore unknown fields (forward compatibility) and SHOULD report them in `warnings`.

The response is an [IngestResult](../schemas/IngestResult.json): `result` is `created` (HTTP 201), `updated` or `unchanged` (200), with the protocol `id`, the `visibility` (`visible`, `hidden`, `pending_files`) and an `ETag`. **`unchanged` means the stored representation is byte-for-byte equivalent: no change entry is written.** Sending the same data every night costs nothing downstream.

### 3.2 PATCH = partial update
`PATCH` with `Content-Type: application/merge-patch+json` (RFC 7396) changes only the given fields; `null` clears a field. Publishing and unpublishing is a patch of `status`: `{"status": "unpublished"}`.

### 3.3 DELETE
`DELETE` needs `ingest:delete`. Deleting a product deletes its variants and assets. Deleting a brand that still has products fails with `409 conflict`. Deleting something that does not exist returns `200` with `result: unchanged` (idempotent).

### 3.4 Validation rules
- Variant `gtin`: 8, 12, 13 or 14 digits with a correct check digit (`422 invalid_gtin`), unique within the node among non-deleted variants (`409 gtin_conflict`).
- Parents must exist (`422 unknown_parent`). Create the brand before the product, the product before its variants and assets (a batch processes operations in order, so one batch can do all of it).
- Asset `position` 1–999, unique among the product's non-deleted assets with the same `color_code` (`409 position_conflict`). To replace an image, reuse its external id. To reorder, use `PUT /products/{external_id}/asset-order`, which assigns positions 1..n atomically.
- Localised text keys are BCP 47 tags; values are non-empty.
- **Article data** ([protocol.md §5.9](protocol.md#59-article-data)): the 0.1 fibre keys `recycled_<fibre>` and `organic_<fibre>` are normalised to the fibre with `recycled` or `organic` set (`recycled_polyester` → `polyester` + `recycled: true`); a fibre flag `false` is not stored (flags are returned only when true); a registry key of `features` with a value outside its type or values, a measurement that is not a positive number, a `strap_length_cm` whose `min` is larger than its `max`, and a `footwear_materials` or `color.family` value outside its list are `422 validation_failed`; an empty `measurements` or `features` object, and a `footwear_materials` object without any part stated (`{}` or all three parts `null`), are stored as `null`; a `null` member inside `measurements` or `features` means "not stated". Unknown `features` keys are stored as sent.
- Asset `rights` fields that are omitted take the node's default rights ([protocol.md §5.6](protocol.md#rights)); `provenance` defaults to `ai_generated: false, ai_edited: false, source: "photo"` (`"generated"` when `ai_generated` is true), `c2pa: "none"` (a node MAY detect embedded C2PA and set `embedded`).
- **Round trip.** `GET` returns the write model with defaults applied ([IngestRecord](../schemas/IngestRecord.json): effective rights, provenance, every current file). PUTting that `data` back unchanged MUST give `unchanged`. To make that work, a node stores only the rights and provenance fields that differ from the defaults (a field equal to the node default is not pinned, so the asset keeps following later changes of the default rights), and a `web`/`square`/`thumb` reference equal to the rendition the node made itself is not treated as a client-supplied rendition.
- **Label completeness warnings.** A product write that is accepted is checked like an import row ([import-format.md rule 10](import-format.md#label-completeness)): `fibre_composition_missing`, `animal_origin_unknown`, `footwear_materials_missing` and `fibre_percentages_not_100`, with the same conditions and legal basis. They are reported in the IngestResult's `warning_details` (`code`, `pointer`, `detail`; for example `{"code": "fibre_percentages_not_100", "pointer": "/materials/0", ...}`) and as text in `warnings`. They never change `result`, the HTTP status or the visibility: the product is written and published as usual.
- `If-Match` (optional) gives optimistic concurrency (`412 precondition_failed`).

## 4. <a id="files"></a>Files

Bytes are content-addressed by lowercase hex **sha256**. Three ways to get bytes in:

1. **Per asset file:** `PUT /assets/{external_id}/files/{original|web|square|thumb}` with the raw bytes and `Content-Type`. `OBX-Content-SHA256` is RECOMMENDED and verified when present (`422 checksum_mismatch`). The asset metadata must exist first.
2. **Blobs, then metadata (atomic, RECOMMENDED for automation):** `HEAD /blobs/{sha256}` (200 = the node already has it; 404 = upload it), `PUT /blobs/{sha256}` raw bytes, then `PUT /assets/{external_id}` with `files: {"original": {"sha256": …}, "web": {"sha256": …, "width": …, "height": …}, …}`. Unknown sha256 → `422 blob_missing`. Unreferenced blobs MAY be garbage-collected after 24 hours.
3. **Resumable multipart** for files above `limits.max_upload_bytes`: `POST /uploads` with `{sha256, bytes, content_type}` (answers the existing Blob if the node already has it), `PUT /uploads/{id}/parts/{n}` (every part except the last exactly `part_bytes`, ≥ 5 MiB, re-sending a part replaces it), `GET /uploads/{id}` to see `received_parts` and resume, `POST /uploads/{id}/complete` (checks size and sha256; missing parts `409 upload_incomplete`), `DELETE /uploads/{id}` to abort. Sessions expire after 24 hours.

Accepted originals: at least `image/jpeg`, `image/png`, `image/webp` (`image/tiff` OPTIONAL; see `accepted_content_types`). Nodes MUST derive width and height of JPEG, PNG and WebP originals from the file header (no decoding needed); for other types the client sends them in `files.original`. Nodes MUST enforce `max_upload_bytes` (`413`) and MUST store originals unmodified.

### 4.1 <a id="renditions"></a>Renditions
`IngestInfo.renditions.server_generated`:

- `true` (capability `ingest.server_renditions`): the node renders `web`, `square` and `thumb` from the original (see [protocol.md §5.5](protocol.md#55-renditions)). Clients upload only the original. Rendering MAY be asynchronous; the asset reports `visibility: pending_files` until done.
- `false` (for example a Cloudflare Workers node without an image library): the **client** MUST produce and upload `web`, `square` and `thumb` following the rendition rules. The admin UI and the `obx` CLI do this automatically. `renditions.required` then lists all four names.

An asset becomes visible only when its original and all renditions exist. When an original is replaced on a client-rendering node via method 1, the node keeps serving the previous original and renditions until every rendition uploaded *after* the new original is present, then swaps atomically. Method 2 avoids that intermediate state entirely.

## 5. Batch

`POST /batch` with a JSON array or NDJSON of [IngestOperation](../schemas/IngestOperation.json)s: `{op, kind, external_id, data?, if_match?}` where `op` is `upsert`, `patch`, `delete`, `publish` or `unpublish`, and `kind` is `brand`, `product`, `variant` or `asset`. Up to `limits.max_batch_operations` (≥ 1000). Operations run **in order**, each atomically on its own; one failure does not stop the rest. Binary data is referenced by sha256 (upload blobs first).

The node answers `200` with `{results: [IngestResult…], summary}` when it finished within the request, or `202` with an [IngestJob](../schemas/IngestJob.json) (always when the client sends `Prefer: respond-async`). Clients MUST handle both. `Idempotency-Key` makes retries safe: the same key within 24 hours returns the original response.

## 6. Imports

`POST /imports` (multipart/form-data) runs the canonical import ([import-format.md](import-format.md)) as one job: `package` (zip) or `csv` + `assets_csv` + `images` (zip or files) + `images_manifest` (JSON list of already-uploaded blobs: `{file, sha256, width?, height?, renditions?}`) + `options` (`mode`: `upsert` | `mirror`, `allow_mass_unpublish`, `dry_run`, `default_language`). Always `202` + job. Row and file problems never fail the request; they are [ImportRowError](../schemas/ImportRowError.json) results. A node MAY also accept an Excel workbook (`.xlsx`) in the `csv` or `assets_csv` part or as `products.xlsx`/`assets.xlsx` in the package; it then follows [import-format.md §5](import-format.md#excel) exactly.

`mirror` also unpublishes the products of the brands present in the file that the file does not contain (requires `ingest:delete`). A mirror import that would unpublish more than half of those products is refused with `mass_unpublish_refused` unless `allow_mass_unpublish` is true: an empty or truncated export must never wipe a catalog. A `dry_run` reports everything and writes nothing.

## 7. Jobs

`GET /jobs`, `GET /jobs/{id}` (status `queued`, `running`, `succeeded`, `failed`; progress; summary; for imports the [ImportRun](../schemas/ImportRun.json)) and `GET /jobs/{id}/results?errors_only=&cursor=` (IngestResult per batch operation, ImportRowError per import problem). A job that `succeeded` may still contain per-row errors. Jobs are kept at least 7 days.

## 8. <a id="changes"></a>How writes appear in `/changes`

This section is normative and is what the conformance suite replays ([`fixtures/ingest/`](../fixtures/ingest)).

1. **Only visible effects count.** A write produces change entries only for objects whose protocol visibility or protocol representation changed. The protocol representation excludes rendition URLs and their expiry.
2. **Unchanged writes produce nothing.** An `upsert`/`patch` that results in `unchanged` writes no entry, and no `updated_at` changes.
3. **Upsert entry** (`op: upsert`) for an object that is visible after the write and either was not visible before or whose representation changed. `updated_at` is set to the time of the write.
4. **Delete entry** (`op: delete`) for an object that was visible before the write and is not visible after it (deleted, unpublished, parent hidden, files withdrawn).
5. **Cascades.** A write that changes a parent's visibility also writes entries for its children whose visibility changed as a result: unpublishing or deleting a product writes delete entries for the product, then each of its visible variants, then each visible asset; publishing it again writes upserts for the product and every child that becomes visible (children that are themselves unpublished stay hidden and produce nothing). The same applies to brands (brand, then products, then variants, then assets). Order within a cascade: parent, variants by `external_id`, assets by `color_code` (`null` first) then `position`.
6. **Assets and files.** An asset produces its first upsert when it becomes complete (original and all renditions present), not when its metadata is created. Replacing the original (different sha256) or any rendition is an asset upsert. On server-rendering nodes that render asynchronously, the entry appears when rendering finishes.
7. **Reordering** (`asset-order`) writes one asset upsert per asset whose position changed, in the new order.
8. **Settings.** Changing the node's default rights writes an upsert for every visible asset whose effective rights changed. Toggling original downloads or a retailer's grant writes `grant` entries with `resync: true` for the affected retailers.
9. **Rights expiry** writes a delete entry for the asset no later than one hour after `expires_at`.
10. **Timing.** Entries are readable in `/changes` once the write's response has been sent (read-your-writes), except asynchronous rendering (rule 6) and jobs (entries appear as each operation completes, in operation order).
11. **Failed operations** produce no entries.

## 9. Limits (minimums a node MUST support)

| Limit | Minimum |
|---|---|
| single request upload (`max_upload_bytes`) | 25 MiB (RECOMMENDED 100 MiB) |
| original via multipart (`max_object_bytes`) | 500 MiB |
| multipart part size (`part_bytes`) | 5 MiB (RECOMMENDED 8 MiB) |
| operations per batch | 1000 |
| import upload (`max_import_bytes`) | 500 MiB |

## 10. Example

```sh
URL=https://brands.kestrel.example/obx/v1/ingest
AUTH="Authorization: Bearer $OBX_TOKEN"
curl -s -H "$AUTH" $URL | jq .renditions
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' $URL/products/KO-1001 \
  -d '{"style_number":"KO-1001","name":{"en":"Merino Crew Sweater","nl":"Merino trui met ronde hals"}}'
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' $URL/variants/2000100101025 \
  -d '{"product_external_id":"KO-1001","gtin":"2000100101025","color":{"code":"NVY","name":{"en":"Navy"}},"size":"M"}'
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' $URL/assets/KO-1001_NVY_1 \
  -d '{"product_external_id":"KO-1001","color_code":"NVY","role":"packshot","view":"front","position":1}'
curl -s -X PUT -H "$AUTH" -H 'Content-Type: image/jpeg' --data-binary @KO-1001_NVY_1.jpg \
  -H "OBX-Content-SHA256: $(shasum -a 256 KO-1001_NVY_1.jpg | cut -d' ' -f1)" $URL/assets/KO-1001_NVY_1/files/original
curl -s -X PATCH -H "$AUTH" -H 'Content-Type: application/merge-patch+json' $URL/products/KO-1001 -d '{"status":"unpublished"}'
```

More recipes: [automation.md](automation.md).
