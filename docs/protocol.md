# OBX Protocol 0.1 (draft)

**Status:** v0.1.0-draft. Normative. Machine-readable contract: [`openapi/obx-protocol.yaml`](../openapi/obx-protocol.yaml) and [`schemas/`](../schemas). Where this document and the OpenAPI file disagree, report it; until fixed, this document wins.

The key words MUST, MUST NOT, REQUIRED, SHALL, SHOULD, SHOULD NOT, RECOMMENDED, MAY and OPTIONAL are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

## 1. What this is

Open Brand Exchange (OBX) is how a **brand** delivers its final product content to its **retailers**:

- **products** (style/model), **variants** (colour/size with GTIN), article data (materials, care, origin);
- **final images** with role, view, order, usage rights and AI provenance.

A **node** is one brand company's deployment (self-hosted or hosted by a vendor). It has three faces:

| Face | For | Contract |
|---|---|---|
| OBX Protocol (this document) | retailers' software (shop, PIM, ERP) pulling content | normative |
| OBX Ingest API ([ingest.md](ingest.md)) | the brand's own automation publishing content | normative |
| Portal + admin | people: the brand's staff and the retailers' buyers | non-normative ([node-admin.yaml](../openapi/node-admin.yaml)) |

Principles: small, pull-first, idempotent, everything repeatable. What the brand did not publish does not exist. A retailer's software never sees more than that retailer could see in the brand's portal.

Out of scope for v0.1: prices, stock, orders, EDI, video/3D assets (reserved), federation between nodes.

## 2. Conventions

- HTTPS only (plain HTTP is allowed for `localhost` development). JSON bodies are UTF-8. Field names are `snake_case`. Timestamps are RFC 3339 (UTC RECOMMENDED).
- **Forward compatibility.** Clients MUST ignore unknown fields, unknown enum values, unknown change `type`s, unknown capability strings and unknown webhook event types. The JSON Schemas in this repository are *closed* so that producers can check their output; consumers MUST NOT reject documents at runtime because of unknown members.
- **Extensions.** Implementation-specific fields MUST be prefixed `x-<vendor>-` (for example `x-acme-crop`). Standard fields never start with `x-`.
- **Ids.** Every object has a node-assigned opaque `id` (`^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$`), stable for the life of the object, and the brand's own `external_id`. Clients MUST treat ids and cursors as opaque.
- **Localised text** is an object keyed by BCP 47 tag: `{"nl": "Trui", "en": "Sweater"}`. Enumerations are stable lowercase keys; labels are presentation and belong to the client.
- **Null vs absent.** Response objects include every property of their schema; unknown values are `null` (except where a schema says a property is only present in some responses).
- Every response SHOULD carry `OBX-Version: 0.1`.

## 3. Discovery

`GET https://<host>/.well-known/obx` (public, `Access-Control-Allow-Origin: *`; it is the only endpoint with CORS headers, see [security.md §4](security.md#4-urls-and-downloads)) returns the [DiscoveryDocument](../schemas/DiscoveryDocument.json): protocol version, the publisher (name, logo, accent colour, contact, welcome text), `api_base` (`https://<host>/obx/v1`), the OAuth2 token endpoint and scopes, the access-request URL, the ingest URL, `capabilities`, the published brands, content `languages` (first = default) and `limits`.

It MUST work on every hostname the node answers on, including a brand's custom domain. Before first-run setup a node answers `503` with `setup_required`.

**Capabilities** (unknown values MUST be ignored): `changes`, `products`, `by_gtin`, `renditions` (all REQUIRED for the protocol conformance profile), and OPTIONAL `exports`, `webhooks`, `usage`, `access_requests`, `ingest`, `ingest.server_renditions`, `portal`. An endpoint of a capability that is not offered answers `501 not_implemented`.

Brands can be listed in public **directories** (lists of discovery URLs, no data); see [directory.md](directory.md).

## 4. Access

### 4.1 Access requests

`POST /obx/v1/access-requests` (unauthenticated) with [AccessRequestInput](../schemas/AccessRequestInput.json): retailer company, contact, what is requested (`portal`, `api`), optional brands and message. Nodes MUST rate-limit it (RECOMMENDED 5 per hour per IP) and MUST answer identically whether or not the retailer is already known. The `202` response contains the request `id`, `status: pending`, and a `request_token` that is shown only once.

The requester polls `GET /obx/v1/access-requests/{id}` with `Authorization: Bearer <request_token>` (at most once per minute). The brand approves or rejects in its admin (a rejection MAY carry a `reason`, which is shown to the requester). After an approval that includes API access, the **first** status read returns `credentials.client_secret`; every later read returns `null` and `claimed: true`. If the secret is lost, the brand rotates it in the admin. Portal access is delivered as an e-mail invitation to the contact.

### 4.2 OAuth2 client credentials

Machines authenticate with OAuth2 client credentials (RFC 6749 §4.4) at `POST /obx/v1/oauth/token`. Nodes MUST support `client_secret_basic` and MAY support `client_secret_post`. There are no refresh tokens and no user passwords in machines. Access tokens SHOULD live 3600 s; clients request a new one when a call returns `invalid_token`. The token endpoint answers RFC 6749 error JSON (`invalid_client`, `invalid_scope`, ...), not problem+json.

| Scope | Allows |
|---|---|
| `catalog:read` | discovery of own grant, brands, products, variants, `/changes`, GTIN lookup, exports metadata, webhooks |
| `media:read` | `web`, `square`, `thumb` renditions, export zip parts |
| `media:original` | the `original` rendition; only granted when the brand allows originals for this retailer |
| `usage:write` | `POST /usage` |

`scope` in the token request is optional (default: all scopes of the client). Requesting a scope the client does not have is `invalid_scope`.

### 4.3 Grants, revocation

A **grant** belongs to a retailer: the brands it may see (`brand_ids`, `null` = all published brands), the scopes its clients may hold and whether originals are allowed. `GET /obx/v1/grant` returns the caller's [Grant](../schemas/Grant.json).

When the brand blocks the retailer or revokes the client, every call fails with `401` and `obx_error: access_revoked` (the token endpoint answers `invalid_client`). A consumer MUST then stop syncing; what it does with content already synced is its own policy (RECOMMENDED: keep, and tell a human).

When a grant changes so that the visible set changes (brands added or removed, originals toggled), the node writes a `grant` change with `resync: true` for that retailer (section 6.5).

## 5. Data model

Schemas: [Brand](../schemas/Brand.json), [Product](../schemas/Product.json) / [ProductDetail](../schemas/ProductDetail.json), [Variant](../schemas/Variant.json), [Asset](../schemas/Asset.json), [Rendition](../schemas/Rendition.json), [Rights](../schemas/Rights.json), [Provenance](../schemas/Provenance.json), [Materials](../schemas/Materials.json), [Care](../schemas/Care.json).

### 5.1 Brand
A label published by the node (`id`, `external_id`, `name`, `logo_url`, `website`, `description`, `updated_at`). One node MAY publish several brands.

### 5.2 Product
A style/model: `style_number`, `name` and `description` (localised), `item_type`, optional `gpc_brick` (GS1 GPC), `target_group`, `season`, `collection`, `materials`, `care`, `country_of_origin`, `dpp_url` (link to the Digital Product Passport once one exists), free `attributes`, `created_at`, `updated_at`.

`updated_at` changes when the product's own protocol representation changes. Product endpoints return **ProductDetail** (the product plus its published `variants`, ordered by `external_id` in byte order, and visible `assets`, ordered by `color_code` with `null` first and then `position`). In `/changes`, product `data` has neither array; variants and assets are separate entries.

<a id="item-types"></a>**`item_type`** is an open vocabulary (pattern `^[a-z][a-z0-9_]{0,63}$`). RECOMMENDED keys: `t_shirt`, `top`, `shirt`, `blouse`, `polo`, `sweater`, `cardigan`, `hoodie`, `sweatshirt`, `vest`, `jacket`, `coat`, `blazer`, `suit`, `dress`, `skirt`, `trousers`, `jeans`, `shorts`, `jumpsuit`, `leggings`, `underwear`, `lingerie`, `nightwear`, `swimwear`, `socks`, `shoes`, `sneakers`, `boots`, `sandals`, `bag`, `backpack`, `wallet`, `belt`, `hat`, `cap`, `scarf`, `gloves`, `tie`, `jewelry`, `watch`, `eyewear`, `accessory`, `home`, `generic_product`.

**`target_group`** RECOMMENDED keys: `women`, `men`, `unisex`, `girls`, `boys`, `kids`, `baby`.

**Materials** are a list of parts (`main`, `outer`, `lining`, `filling`, `trim`, `sole`, `upper`, `insole`, ...) each with fibres and percentages (SHOULD sum to 100). **Care** is an ordered list of ISO 3758-aligned codes with optional localised text. Both vocabularies are listed in [import-format.md](import-format.md#fibres).

### 5.3 Variant
A sellable colour/size: `color` (`code`, localised `name`, `supplier_color`), `size`, `size_system`, `sku`, and the GTIN.

**GTIN.** `gtin` is always the 14-digit normalised form (left-padded with zeros); `gtin_original` is the form the brand supplied (GTIN-8, UPC-A, EAN-13 or GTIN-14). The GTIN is the consumer's match key. Within one node a GTIN belongs to at most one variant.

### 5.4 Asset
A **final** product image. The node MUST only publish images the brand marked as final (published).

| Field | Meaning |
|---|---|
| `media_type` | `image` (v0.1). Consumers MUST ignore assets with an unknown media type. |
| `color_code` | colour it belongs to; `null` = all colours of the product |
| `variant_ids` | optional restriction to specific variants |
| `role` | `packshot`, `model`, `detail`, `ghost`, `flatlay`, `scene`, `swatch`, `size_chart`, `other` |
| `view` | `front`, `back`, `side`, `left`, `right`, `top`, `bottom`, `tilted_left`, `tilted_right`, `inside`, `detail`, `other`, or `null`. The same list as Fashion Cloud's `product_view` plus `inside`, so content maps losslessly. |
| `position` | 1-based order within (product, `color_code`). **One image per position**: among the visible assets of a product and colour, positions are unique. |
| `filename` | suggested file name of the original |
| `sha256`, `width`, `height`, `bytes`, `content_type` | of the original bytes (the hash is always present, even when the original rendition is not offered) |
| `rights`, `provenance` | see 5.6 and 5.7 |
| `renditions` | see 5.5 |

### 5.5 Renditions

| Name | Rule |
|---|---|
| `original` | exactly the uploaded bytes, never re-encoded (embedded C2PA Content Credentials and colour profiles survive). Only present when the brand allows originals and the caller has `media:original` (portal: the retailer is allowed originals). |
| `web` | `image/jpeg`, sRGB, longest side ≤ 2000 px, never upscaled, transparency flattened on white |
| `square` | the `web` image centred on a white (`#FFFFFF`) square canvas whose side is the longest side of `web` |
| `thumb` | `image/jpeg`, longest side ≤ 600 px, never upscaled |

Each [Rendition](../schemas/Rendition.json) has `url`, `url_expires_at`, `content_type`, `width`, `height`, `bytes` and `sha256`. URLs are either **short-lived signed URLs** (usable without `Authorization` until `url_expires_at`; RECOMMENDED lifetime 1 hour, minimum 5 minutes) or require the Bearer token (`url_expires_at: null`). A node MUST NOT hand out permanent public URLs. Clients MUST treat URLs as opaque; when a signed URL expired, re-read the asset (`GET /obx/v1/assets/{id}`).

`GET /obx/v1/assets/{id}/renditions/{name}` MUST support `Range` (206), `If-None-Match` (304), and send `ETag` (the quoted sha256), `OBX-Content-SHA256` (hash of the complete representation), `Accept-Ranges: bytes` and `Content-Disposition: inline; filename="…"` (non-original renditions insert `_web`, `_square` or `_thumb` before a `.jpg` extension). A node without an image library (for example on Cloudflare Workers) obtains web/square/thumb from the client at ingest (see [ingest.md](ingest.md#renditions)); the rules above still apply.

### 5.6 <a id="rights"></a>Rights
`license` (`retailer-use` or `custom` with `license_text`), `channels` (`webshop`, `marketplace`, `social`, `print`), `territories` (ISO 3166-1 alpha-2, `null` = worldwide), `embargo_until`, `expires_at`, `credit`, `model_release`.

- **Default rights** of a node that has not configured any: `{"license": "retailer-use", "license_text": null, "channels": ["webshop", "marketplace", "social"], "territories": null, "embargo_until": null, "expires_at": null, "credit": null, "model_release": null}`.
- **Embargo:** an asset under embargo IS delivered (so retailers can prepare) but consumers MUST NOT show it publicly before `embargo_until`.
- **Expiry:** when `expires_at` passes, the asset stops being visible and the node MUST write a tombstone for it no later than one hour after `expires_at`.
- **`retailer-use` licence** (template; brands with other terms use `custom`): the brand grants the retailer a non-exclusive, non-transferable, royalty-free licence, for the duration of their business relationship and until `expires_at`, to reproduce and display the asset solely to advertise and sell the brand's genuine products, in the listed channels and territories, not before `embargo_until`, and with the `credit` if one is given. Allowed edits: resizing, cropping that keeps the product recognisable, format conversion, and placing it in the retailer's own shop layout. This template is not legal advice.

### 5.7 Provenance
`ai_generated`, `ai_edited`, `source` (`photo`, `generated`, `composite`), `c2pa` (`embedded`, `sidecar`, `none`), `c2pa_manifest_url`, `generator`.

A publisher that knows an image is AI-generated or AI-edited MUST say so. Nodes MUST NOT strip provenance: originals are served byte-for-byte; derived renditions MAY lose embedded manifests, in which case the asset's `provenance` remains the authoritative statement (sidecar manifests MAY be linked). Consumers SHOULD carry `provenance` along to their own channels (EU AI Act art. 50).

### 5.8 Visibility

An object is **visible** to a retailer when all of the following hold:

1. the node is set up, the retailer is active and the client is not revoked;
2. **brand**: status `published` and in the retailer's grant;
3. **product**: status `published` and its brand is visible;
4. **variant**: status `published` and its product is visible;
5. **asset**: status `published`, its product is visible, its original and all renditions exist, and `rights.expires_at` is `null` or in the future.

Everything the protocol returns (lists, lookups, `/changes`, exports, renditions) follows this single rule. An object that is not visible is answered with `404 not_found`, never `403` (no existence leak).

## 6. The change feed

`GET /obx/v1/changes?cursor=<opaque>&limit=<1..500, default 100>` returns a [ChangesPage](../schemas/ChangesPage.json): `changes`, `next_cursor` (always present), `has_more` and `phase`.

Each [Change](../schemas/Change.json) has `seq`, `type` (`brand`, `product`, `variant`, `asset`, `grant`), `op` (`upsert`, `delete`), `id`, `external_id`, `brand_id`, `product_id` (variants and assets), `updated_at`, and on upserts `data`: the **current** representation of the object (products without `variants`/`assets`).

### 6.1 Snapshot, then live
- **Without a cursor** the node starts a **snapshot**: one `upsert` for every object currently visible to the caller, ordered brands, products, variants, assets (by `id` within a type), `phase: "snapshot"`. The node remembers the highest `seq` at the start (the high-water mark).
- When the snapshot is exhausted the feed continues **live** from the high-water mark. Pages never mix phases; the last snapshot page has `has_more: true`, so the first page with `phase: "live"` tells the consumer the snapshot is complete. A consumer MAY then delete local objects from this node that it did not see during the snapshot (mark and sweep). Snapshot entries carry the object's latest `seq`.
- **With a cursor** the node returns entries after it. Entries appear in `seq` order.
- When `has_more` is `false`, poll again later with `next_cursor` (RECOMMENDED no more than once per 60 s, or immediately on a `changes.available` webhook).

### 6.2 What a consumer sees
- Only entries of brands in its grant, and its own `grant` entries.
- `delete` entries (tombstones) for every transition from visible to not visible: deleted, unpublished, a parent hidden, rights expired, removed from the grant scope via brand unpublish. Deletes carry no `data`. A consumer MUST ignore deletes for ids it does not know.
- An `upsert` entry whose object is not visible at read time is **omitted** (a later delete entry covers it). So an upsert always carries data of a visible object.
- **At-least-once:** the same object may appear several times; `data` is always current and `updated_at`/`sha256` let consumers be idempotent. Snapshot entries for objects changed during the snapshot may repeat in the live phase.
- Consumers MUST tolerate a child entry (variant, asset) whose parent they have not seen yet.

### 6.3 Ordering within one write
When a single write changes several objects (for example unpublishing a product), the node writes the parent entry first, then the variants (by `external_id`), then the assets (by `color_code`, `null` first, then `position`). [ingest.md](ingest.md#changes) defines exactly which writes produce which entries.

### 6.4 Retention and cursors
- Tombstones MUST be kept at least 90 days (`limits.tombstone_retention_days`). A cursor older than what the node retains yields `410 cursor_expired`: restart without a cursor.
- Nodes MAY compact the log by dropping an entry when a later entry for the same object exists, but only for entries older than 7 days.
- Cursors MUST survive restarts and deploys (no offsets into mutable lists). Snapshot cursors MAY expire after 24 hours (`410 cursor_expired`). A malformed cursor or one from another node is `400 cursor_invalid`.

### 6.5 Grant changes
A `grant` entry (`data`: the new Grant) with `resync: true` means the visible set changed: the consumer MUST restart without a cursor and sweep. `resync: false` entries are informational (for example scopes changed without affecting visibility).

## 7. Reading objects

| Endpoint | Notes |
|---|---|
| `GET /obx/v1/brands`, `GET /obx/v1/brands/{id}` | visible brands |
| `GET /obx/v1/products?ids=&brand_id=&updated_since=&cursor=&limit=` | ProductDetail, keyset pagination by `id`, `limit` ≤ 100 (default 25). For synchronisation use `/changes`. |
| `GET /obx/v1/products/{id}` | ProductDetail, `ETag`, `If-None-Match` |
| `GET\|POST /obx/v1/products:by-gtin` | GTIN lookup (below) |
| `GET /obx/v1/assets/{id}` | one Asset (fresh signed URLs) |
| `GET /obx/v1/assets/{id}/renditions/{name}` | bytes (section 5.5) |

**Pagination.** List endpoints take `limit` and an opaque `cursor` and return `{"items": [...], "next_cursor": "…" | null}`.

**GTIN lookup.** `POST /obx/v1/products:by-gtin` with `{"gtins": [...]}` (max 2000; more is `400 limit_exceeded`) or `GET ?gtin=a,b,c` (max 100). Each input is trimmed (leading and trailing whitespace) and echoed that way in `input` (`" 2000 200101031"` → `"2000 200101031"`); for matching, inner spaces are then removed; 8, 12, 13 or 14 digits are normalised to GTIN-14 and compared with `Variant.gtin`; check digits are not validated here. Anything else is `invalid`. Duplicate inputs after normalisation are reported once (first occurrence). The [GtinLookupResult](../schemas/GtinLookupResult.json) has one result per distinct input in input order (`matched`, `unmatched`, `invalid`) and every matched product once as ProductDetail.

## 8. Bulk exports (capability `exports`)

`POST /obx/v1/exports` with an [ExportRequest](../schemas/ExportRequest.json) (filter by brands, products, GTINs, `updated_since`; which renditions to include) returns `202` with an [Export](../schemas/Export.json). Poll `GET /obx/v1/exports/{id}` (RECOMMENDED every 10 s) or subscribe to `export.completed`.

A finished export has:
- a **manifest** (`GET /obx/v1/exports/{id}/manifest`, NDJSON of [ExportManifestLine](../schemas/ExportManifestLine.json)): first a `header` line with counts and a `changes_cursor` positioned at the export's snapshot moment (continue incrementally with `/changes` from there), then `brand`, `product`, `variant`, `asset` lines, then `file` lines;
- **parts** (`GET /obx/v1/exports/{id}/parts/{n}`): independent zip files (not a split archive), each ≤ 2 GiB, with entries at `<style_number>/<rendition>/<filename>` (sanitised: no `..`, no absolute paths, `/` as separator).

Exports expire (`expires_at` ≥ 24 h after finishing; afterwards `410 export_expired`). Nodes MAY limit concurrent exports per client (`409 conflict`). `Idempotency-Key` is supported.

## 9. Webhooks (capability `webhooks`)

Consumers subscribe with `POST /obx/v1/webhooks` (`url`, `events`), list with `GET`, delete with `DELETE /obx/v1/webhooks/{id}` and send a test with `POST /obx/v1/webhooks/{id}/test`. At most 5 subscriptions per client. Events: `changes.available` (`{latest_seq}`), `grant.updated` (`{grant}`), `export.completed` (`{export_id, status}`), `webhook.test` (`{}`).

**Webhooks are a wake-up call, never the source of truth**: always fetch through the API.

**Delivery.** `POST` of a [WebhookEvent](../schemas/WebhookEvent.json) with headers:
- `OBX-Webhook-Id`: the event id (use it to de-duplicate),
- `OBX-Webhook-Timestamp`: unix seconds,
- `OBX-Webhook-Signature: v1=<hex>` where `hex = HMAC-SHA256(key = secret, message = timestamp + "." + raw_body)`, lowercase hex. The secret (`whsec_…`) is used as UTF-8 bytes including its prefix. During secret rotation the header MAY hold several comma-separated `v1=` values.

Receivers MUST verify the signature with a constant-time comparison and MUST reject timestamps more than 300 s from their clock. They answer 2xx within 10 s; otherwise the node retries with exponential backoff for up to 24 hours and disables the subscription after 3 days of failures. The `url` MUST be https and MUST NOT resolve to a private, loopback or link-local address (`422 unsafe_url`). A test vector is in [`fixtures/examples/webhook-signature-vector.json`](../fixtures/examples/webhook-signature-vector.json).

## 10. Usage events (capability `usage`)

`POST /obx/v1/usage` (`usage:write`) with up to 1000 [UsageEvent](../schemas/UsageEvent.json)s: `asset_id`, `rendition`, `event` (`synced`, `published`, `downloaded`, `removed`), `channel`, `at`, `count`. Answer `202 {"accepted": n}`; unknown asset ids are ignored. Usage events are organisation-level only and MUST NOT contain personal data. The brand sees them in its statistics.

## 11. <a id="errors"></a>Errors

Errors are `application/problem+json` (RFC 9457) [Problem](../schemas/Problem.json) documents with `type` = `https://openbrandexchange.com/errors/<obx_error>`, `title`, `status`, `detail` and the machine-readable `obx_error`. Field errors are listed in `errors[]` with a JSON Pointer (or a CSV locator such as `row:12/gtin`). Clients MUST handle unknown codes by HTTP status.

| `obx_error` | HTTP | Meaning |
|---|---|---|
| `invalid_request` | 400 | malformed request (JSON, NDJSON, multipart, query) |
| `validation_failed` | 422 | body is well-formed but invalid; see `errors[]` |
| `unauthorized` | 401 | no credentials |
| `invalid_token` | 401 | expired or unknown token |
| `access_revoked` | 401 | client revoked, retailer blocked or ingest token revoked |
| `insufficient_scope` | 403 | token lacks the scope |
| `forbidden` | 403 | not allowed (role, brand restriction, feature disabled by the brand) |
| `not_found` | 404 | does not exist or is not visible to the caller |
| `method_not_allowed` | 405 | method not supported on an existing path (SHOULD; a node MAY answer `404 not_found` instead) |
| `conflict` | 409 | state conflict (not pending, still has children, concurrent job) |
| `precondition_failed` | 412 | `If-Match` did not match |
| `payload_too_large` | 413 | body above the node's limit |
| `unsupported_media_type` | 415 | content type not accepted |
| `rate_limited` | 429 | slow down; see `Retry-After` |
| `limit_exceeded` | 400 | too many items (GTINs, selection, sync zip, batch) |
| `cursor_invalid` | 400 | cursor malformed or from another node |
| `cursor_expired` | 410 | restart `/changes` without a cursor |
| `export_expired` | 410 | export or download job files were deleted |
| `original_not_allowed` | 403 | originals are not available to this caller |
| `invalid_gtin` | 422 | GTIN has a wrong length or check digit |
| `gtin_conflict` | 409 | GTIN already belongs to another variant in this node |
| `position_conflict` | 409 | another asset of this product and colour has this position |
| `checksum_mismatch` | 422 | uploaded bytes do not match the declared sha256 |
| `blob_missing` | 422 | referenced sha256 has not been uploaded |
| `upload_incomplete` | 409 | multipart upload has missing parts |
| `unknown_parent` | 422 | referenced brand or product does not exist |
| `files_missing` | 422 | an import references an image that was not provided |
| `import_invalid` | 422 | import file unreadable (not a CSV/zip, no header, unsafe zip entry) |
| `mass_unpublish_refused` | 409 | mirror import would unpublish more than half of the brand's products |
| `unsafe_url` | 422 | URL resolves to a private/loopback/link-local address or is not https |
| `csrf_failed` | 403 | admin API: missing or wrong `X-CSRF-Token` |
| `invalid_credentials` | 401 | admin API: wrong e-mail or password |
| `account_blocked` | 403 | admin API: account or retailer blocked |
| `setup_required` | 409/503 | node has not completed first-run setup |
| `setup_completed` | 409 | first-run setup was already done |
| `invite_invalid` | 400 | invite or reset token unknown, used or expired |
| `not_implemented` | 501 | optional capability not offered |
| `internal_error` | 500 | unexpected server error |
| `service_unavailable` | 503 | temporarily unavailable; retry later |

## 12. Rate limits

Nodes SHOULD rate-limit per client and MUST send `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds) on rate-limited endpoints; `429` responses carry `Retry-After`. RECOMMENDED defaults: 600 requests/minute per client for API calls, 3000/minute for renditions, 30/minute for the token endpoint, 5/hour per IP for access requests. Clients MUST honour `Retry-After` and SHOULD back off exponentially on 5xx.

## 13. Privacy

Nodes store retailer company data and contact persons. Protocol responses never contain personal data of other retailers. Usage events and download statistics are organisation-level; nodes SHOULD NOT keep IP addresses longer than needed for abuse prevention (RECOMMENDED ≤ 30 days).

## 14. Consuming OBX in five calls

```sh
HOST=https://brands.kestrel.example
curl -s $HOST/.well-known/obx | jq .api_base
TOKEN=$(curl -s -u "$CLIENT_ID:$CLIENT_SECRET" -d grant_type=client_credentials $HOST/obx/v1/oauth/token | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" "$HOST/obx/v1/changes?limit=500"          # snapshot, then keep next_cursor
curl -s -H "Authorization: Bearer $TOKEN" -X POST -H 'Content-Type: application/json' \
     -d '{"gtins":["2000100101025"]}' "$HOST/obx/v1/products:by-gtin"
curl -s -H "Authorization: Bearer $TOKEN" -o front.jpg "$HOST/obx/v1/assets/<id>/renditions/web"
```

See also: [ingest.md](ingest.md), [security.md](security.md), [conformance.md](conformance.md), [versioning.md](versioning.md).
