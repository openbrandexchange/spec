# Proposal 0005: browsing, webhooks and notifications (spec 0.3)

Status: **accepted in principle** by the owner 2026-11-12 · non-breaking (additive), target spec **0.3.0** · details open for comments ([governance](../governance.md#process))

Alongside [proposal 0004](https://github.com/openbrandexchange/spec/blob/obx-0.3-materiaal-objecten/docs/proposals/0004-terms-with-names.md) (materials and care as terms with names, on the 0.3 branch): 0004 changes the shape of `materials` and `care`; this proposal does not filter or search on either, so the two do not overlap. Filters on material codes can follow once 0004's vocabulary is released (open decision 12). Proposal 0003 (home and sport) adds `item_type` keys; the `item_type` filter below is an open vocabulary and needs nothing extra.

## Why

The owner found the API "pretty bad" for browsing and thought there was no pagination. There is (keyset cursors on `/products` and `/changes`, and webhooks instead of polling), but 0.2 documented it in one line each; the 0.2 documentation patch fixes that ([protocol.md §2.1](../protocol.md#pagination), [§2.2](../protocol.md#notifications)). What remains are real gaps:

1. **Browsing.** `GET /products` filters only by `ids`, `brand_id` and `updated_since`, in `id` order. A retailer's shop or PIM that wants "all AW26 sweaters of collection Highland, newest first" must download everything and filter itself. The retailer portal already has these filters ([node-admin.yaml](../../openapi/node-admin.yaml) `/admin/api/portal/products`); the protocol does not.
2. **Webhooks** are minimal: 5 subscriptions, no filters, no delivery log, no way to pause, rotate a secret or ask for a redelivery, and no way to see a missed event.
3. **Replaced images.** Re-sending a file with the same style, colour and position replaces the image (same asset id, new `sha256`, one change entry; [import-format.md §2.1](../import-format.md#21-filename-pattern) and rule 6), but a consumer cannot tell a replacement from a metadata change without its own copy of the old hash, and the behaviour of conditional requests for the old bytes is unwritten.
4. **Buyers** (people at the retailer, not their software) want an e-mail when a brand has new products, new images or changed EANs. Every node would build this differently.

Goals: additive only (a 0.2 client keeps working against a 0.3 node), detectable through discovery, implementable on SQLite, Postgres, MySQL and Cloudflare D1, testable by the conformance suite.

## Overview

| Part | Where | Discovery | Normative |
|---|---|---|---|
| 1. Search, filters, sort, total and fields on `GET /products` | OBX Protocol | capability `products.search` | yes, for nodes that advertise it |
| 2. Webhooks 0.3 | OBX Protocol §9 | capability `webhooks` (with `obx_version` 0.3), `limits.webhook_subscriptions_max`; batching: capability `webhooks.batch` | yes, for every 0.3 node with `webhooks` |
| 3. Replaced images: `previous_sha256` | OBX Protocol §5.4, Ingest, import, admin | `obx_version` 0.3 | yes |
| 4. Buyer notifications by e-mail | Node Admin + Portal API | capability `portal.notifications` (requires `portal`) | yes, for nodes that advertise it |

Capabilities in 0.2 are an array of strings (`["changes", "products", …]`; unknown strings MUST be ignored), so new features are new strings, not `{"product_search": true}`; numbers go in `limits`. A 0.2 node ignores unknown query parameters: `GET /products?season=AW26` on a 0.2 node returns **every** product (checked against the obx-go mock). Clients MUST therefore check `products.search` before sending any parameter of part 1, and fall back to filtering themselves.

## 1. Browsing: `GET /obx/v1/products` (capability `products.search`)

### 1.1 Filters

| Parameter | Matches | Level |
|---|---|---|
| `brand_id` | `Product.brand_id` (now a list; one id stays valid) | product |
| `season` | `Product.season` | product |
| `collection` | `Product.collection` | product |
| `item_type` | `Product.item_type` | product |
| `target_group` | `Product.target_group` | product |
| `color_code` | `Variant.color.code` of any visible variant | variant |
| `gtin` | `Variant.gtin` of any visible variant, inputs normalised as in the GTIN lookup ([protocol.md §7](../protocol.md#7-reading-objects)) | variant |

- **Lists.** Each parameter is a comma-separated list; a value that contains a comma or a backslash writes it as `\,` or `\\` (only `season` and `collection` can contain them; the other fields' patterns exclude commas). Values are trimmed; empty values are ignored. At most 100 values per parameter and 8 KiB of query string (else `400 limit_exceeded`).
- **Semantics.** OR within a list, AND between parameters. `season=SS26,AW26&item_type=sweater` = (season SS26 or AW26) and item type sweater. A variant-level filter selects products that have at least one matching visible variant; when both `color_code` and `gtin` are given, one variant must match both. The response is unchanged: the whole ProductDetail with **all** its visible variants and assets (filters select products, they do not trim them).
- **Exact, case-insensitive.** A value matches when it equals the field after both are folded (1.2): `aw26` finds `AW26`, `Highland` does not find `Highland Wool`. Products with the field `null` never match. `gtin` compares GTIN-14 digits.
- **`ids` stays as in 0.2**: when `ids` is set, every other filter, `q` and `sort` are ignored (`fields` and `include` still apply).
- `updated_since` stays and combines with the new filters by AND.

### 1.2 Text search: `q`

- Matches when **every** whitespace-separated term of `q` occurs as a substring of at least one of: `style_number`, `name` (any language), the variants' `color.code`, `color.name` (any language) and `sku`, after folding both sides; or when `q` as a whole equals a variant's `gtin` (digits, normalised as in the GTIN lookup) or the product's `external_id` (folded).
- Not searched: descriptions, materials, care, features, attributes (cost; open decision 4).
- **Folding** (the same for filters, `q` and `sort`): Unicode NFKD, remove combining marks (General Category Mn), lowercase with the Unicode default case mapping, collapse runs of white space to one space, trim. `Mérino CREW` → `merino crew`; `ø`, `æ`, `ł` and `ß` have no decomposition and stay as they are (lowercased). Fixture vectors in `fixtures/search/fold.json` let every runtime check its implementation.
- At least **2** characters after folding (Unicode code points; a term may be 1 character when `q` as a whole has 2), at most 200; else `400 invalid_request`.
- **No ranking.** Results are ordered by `sort` like any other list; nodes MUST NOT reorder by relevance (a cursor could not be stable). Nodes MAY use a full-text index as long as the result set is the one defined here.

### 1.3 Sort

`sort` is one key, `-` prefix for descending: `id` (default; the 0.2 order), `updated_at`, `-updated_at`, `created_at`, `-created_at`, `style_number`, `-style_number`, `name`, `-name`.

- Ties are broken by `id` in the same direction, so the order is total.
- `name` sorts by the name in the node's default content language (`languages[0]` in discovery), folded (1.2), compared by code point; products without a name in that language sort as if their name were their folded `style_number`. Nodes MUST NOT use locale collation (it differs between databases).
- `style_number` sorts by the folded style number, by code point (`KO-1010` sorts before `KO-2`; no natural sort).
- Unknown key: `400 invalid_request`.

### 1.4 Pagination stays keyset

- The cursor encodes the sort key, the last row's sort value and `id`, and a fingerprint of the query (`brand_id`, filters, `q`, `updated_since`, `sort`; not `limit`, `fields`, `include`). The next page starts strictly after that (value, id) pair.
- A cursor sent with a different query is **`400 cursor_invalid`** (existing code) with `detail` "cursor does not belong to this query". `limit`, `fields` and `include` may change between pages.
- **Guarantee:** every product that matches the query and does not change during the walk appears exactly once. A product changed during the walk may appear twice or not at all when `sort` is `updated_at`/`-updated_at` (it moves), or when its `name`/`style_number`/filtered field changes. To keep a copy, use `/changes`; this is for browsing.

### 1.5 Total: `include=total`

`include` is a comma-separated list; the only value in 0.3 is `total`. With it the response has

```json
{"items": [...], "next_cursor": "…", "total": {"value": 1234, "relation": "eq"}}
```

- `relation: "eq"`: `value` is the exact number of products matching the query (all pages). Nodes MUST be exact up to 10 000.
- Above 10 000 a node MAY answer `{"value": 10000, "relation": "gte"}` (or any exact or lower bound ≥ 10 000).
- Computed on every page that asks; clients SHOULD ask only on the first. Without `include=total` the member is absent (a 0.2-shaped response). Unknown `include` values: `400 invalid_request`.

### 1.6 Sparse fieldsets: `fields`

- `fields` is a comma-separated list of top-level ProductDetail members (`name,season,variants`). `variants` and `assets` are returned whole; there is no nested selection in 0.3.
- `id`, `brand_id`, `style_number` and `updated_at` are **always** returned.
- Members not asked for are **absent** (an explicit exception to "every property is present" in [protocol.md §2](../protocol.md#2-conventions)). A missing `variants` saves the most: nodes SHOULD then not load variants and assets at all.
- Unknown names: `400 invalid_request`, one `errors[]` entry per unknown name (typos fail loudly; a client that wants a 0.4 field checks `obx_version` first).
- Also valid with `ids=` and on `GET /products/{id}`. The OpenAPI response schema becomes ProductDetail without `required` when `fields` is set (`ProductDetailPartial`).

### 1.7 Errors

No new codes. Query errors use `400 invalid_request` with `errors[]`; `pointer` is a query locator `query:<parameter>` (as the CSV locator `row:12/gtin`): unknown `sort` key, `fields` or `include` value, `q` too short or long, malformed GTIN in `gtin` (anything that is not 8, 12, 13 or 14 digits after removing spaces). Too many values or too long a query: `400 limit_exceeded`. Cursor of another query: `400 cursor_invalid`. Unknown values in a filter (a season nobody uses) are not errors; they match nothing.

### 1.8 Notes for implementers

- **Visibility first.** Every filter runs inside the caller's grant (brands, published, rights), exactly like 0.2. A restricted retailer never finds another brand's product through `q` or `gtin`.
- **Store folded copies at write time** (`season_f`, `collection_f`, `style_number_f`, `name_default_f`, a `search_f` text with the searchable fields joined by `\n`) with one fold function per runtime, checked against `fixtures/search/fold.json`. Do not fold in SQL: `lower()` and accent removal differ between SQLite, Postgres and MySQL.
- **Indexes** (all keyset sorts need `(sort_column, id)`): `products(brand_id, id)`, `(updated_at, id)`, `(created_at, id)`, `(style_number_f, id)`, `(name_default_f, id)`, `(season_f)`, `(collection_f)`, `(item_type)`, `(target_group)`; `variants(color_code_f, product_id)`, `variants(gtin, product_id)` (exists for the GTIN lookup). Variant filters as `EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND …)`.
- **`q`:** SQLite and D1: FTS5 with the `trigram` tokenizer over `search_f` (substring search, needs terms of 3+ characters; fall back to `LIKE '%term%'` on `search_f` for 2-character terms). Postgres: `pg_trgm` GIN index on `search_f` with `LIKE`. MySQL 8: an `ngram` FULLTEXT index (`ngram_token_size=2`) with a `LIKE` recheck, or `LIKE` alone for catalogs under ~50 000 products. A plain `LIKE` scan over the folded column is acceptable everywhere for small catalogs; the result must be the same.
- **Total:** `SELECT count(*) FROM (SELECT 1 … LIMIT 10001)`: exact up to 10 000, then `gte`.
- **Rate limits:** a search counts as one API request. Nodes MAY rate-limit `q` and `include=total` more strictly (RECOMMENDED: 60/minute per client) and answer `429` with `Retry-After`.

### 1.9 OpenAPI sketch

```yaml
  /obx/v1/products:
    get:
      parameters:
        - {name: brand_id, in: query, description: Comma-separated brand ids (capability products.search; one id works everywhere)., schema: {type: string}}
        - {name: season, in: query, schema: {type: string}}        # same for collection, item_type, target_group, color_code, gtin
        - {name: q, in: query, schema: {type: string, minLength: 2, maxLength: 200}}
        - {name: sort, in: query, schema: {type: string, enum: [id, updated_at, -updated_at, created_at, -created_at, style_number, -style_number, name, -name], default: id}}
        - {name: include, in: query, schema: {type: string, example: total}}
        - {name: fields, in: query, schema: {type: string, example: 'name,season,variants'}}
      responses:
        '200':
          content:
            application/json:
              schema:
                properties:
                  total:
                    type: object
                    required: [value, relation]
                    properties:
                      value: {type: integer, minimum: 0}
                      relation: {type: string, enum: [eq, gte]}
```

## 2. Webhooks 0.3 (protocol §9)

Every 0.3 node that advertises `webhooks` MUST do 2.1 to 2.8; 2.9 is the optional capability `webhooks.batch`. The receiver's side stays as simple as in 0.2 and MUST stay so:

> **Receiver:** verify the signature, de-duplicate on the event id, answer 2xx within 10 s, then read `/changes` from the stored cursor. Webhooks are a signal; `/changes` is the source of truth. Polling `/changes` alongside webhooks is explicitly allowed (RECOMMENDED as a slow safety net); a webhook subscription never changes the rate limits of `/changes`.

### 2.1 Subscriptions and limits
- A node MUST allow at least **5** subscriptions per client (as 0.2) and MUST publish its own maximum in discovery as `limits.webhook_subscriptions_max` (integer ≥ 5). No fixed higher number: filters (2.4) do most of the work, and abuse is handled with rate limits (RECOMMENDED: 60 management requests per minute per client). Creating one more than the maximum: `409 conflict`.
- `WebhookSubscription` gains: `filter` (2.4), `batch` (2.9), `status` value `paused`, `verified_at`, `consecutive_failures`, `disabled_reason` (`failures`, `receiver_gone`, `null`), `secret_rotation_ends_at`. All optional for 0.2 clients, which MUST ignore unknown members and enum values.

### 2.2 Delivery and retries
- **Delivered** = a 2xx answer within **10 s** (connect plus response, as 0.2). Redirects are not followed and count as failures. Anything else is a failed attempt.
- **Retries** with exponential backoff and full jitter (`delay = random(0, min(1 h, 30 s × 2^attempt))`), for at least **24 h** (MUST, as 0.2), RECOMMENDED **72 h**. Every attempt carries the same event `id` and `sequence` and the same body, with a fresh `OBX-Webhook-Timestamp` and signature, and the header `OBX-Webhook-Attempt: <n>` (1 for the first).
- **`Retry-After`** on a `429` or `503` MUST be honoured (seconds or HTTP date, capped at 1 h): the next attempt is not earlier.
- A `410 Gone` from the receiver disables the subscription at once (`disabled_reason: receiver_gone`).
- **Latency:** a `changes.available` is sent within 60 s after the entry is in the feed (RECOMMENDED within 10 s). Nodes SHOULD coalesce: at most one `changes.available` per subscription per 10 s; `latest_seq` is the newest feed position at send time.

### 2.3 Event id and sequence
- `WebhookEvent` gains `subscription_id` and `sequence`: an integer that starts at 1 per subscription and grows by exactly 1 for every event the node creates for that subscription (any type). Retries and redeliveries keep it.
- Deliveries MAY arrive out of order (retries, concurrency). A receiver that sees `sequence` 7 after 5 knows 6 is outstanding (still being retried, or failed): it can wait, look at the delivery log (2.5) or just read `/changes`, which is always enough.
- For `changes.available`, `latest_seq` also orders events: one with a `latest_seq` the receiver has already read past can be acknowledged and ignored.
- `OBX-Webhook-Id` and the body's `id` stay the de-duplication key.

### 2.4 Filters per subscription
```json
{"url": "https://store.example/hooks/obx",
 "events": ["changes.available"],
 "filter": {"brand_ids": ["brd_kestrel"], "seasons": ["AW26"], "collections": ["Highland"], "item_types": ["sweater", "shoes"]}}
```
- Applies to `changes.available` only. The node sends it only when at least one new feed entry visible to the client matches: AND between members, OR within a list, matched like the filters of 1.1 (folded, exact). Variant and asset entries match through their product; a `delete` matches on the object's last visible values; `grant` entries always match. Absent or empty members match everything.
- `latest_seq` stays the global feed position and the receiver still reads the whole `/changes`: the filter reduces wake-ups, not the feed (a filtered feed is open decision 11).
- At most 100 values per member; invalid: `422 validation_failed`.

### 2.5 Delivery log and redelivery
- `GET /obx/v1/webhooks/{id}/deliveries?cursor=&limit=`: attempts newest first, kept at least 7 days: `WebhookDelivery` (`event_id`, `event_type`, `sequence`, `attempt`, `at`, `status_code`, `duration_ms`, `success`, `error`). The schema is the one the admin API already has, moved to `schemas/WebhookDelivery.json` with `sequence` added.
- `POST /obx/v1/webhooks/{id}/redeliver` with `{"event_ids": [...]}` (max 100) or `{"from": "…", "to": "…"}` (a range inside the retention): `202 {"queued": n}`. A redelivery sends the original event (same `id`, `sequence`, body) with a fresh timestamp, signature and `OBX-Webhook-Attempt`. Unknown or expired ids: `422 validation_failed`. RECOMMENDED limit: 10 redeliver requests per hour per subscription.

### 2.6 Pause, resume and automatic disabling
- `PATCH /obx/v1/webhooks/{id}` with `{"status": "paused"}` or `{"status": "active"}`, and to change `events`, `filter` or `batch`. `url` cannot change (create a new subscription; it must be verified).
- Paused and disabled subscriptions get no events, and none are queued (they are wake-up calls). On resume or re-activation the node sends one `changes.available` with the current `latest_seq` when the feed moved meanwhile; the receiver reads `/changes` and has missed nothing.
- **Automatic disabling** (as 0.2): after 72 h in which every attempt failed, `status: disabled`, `disabled_reason: failures`. The node MUST then send `webhook.disabled` (`{subscription_id, reason}`) to the client's other active subscriptions that subscribed to it, and SHOULD e-mail the technical contact of the retailer's API access. Re-activation is the same `PATCH` (`status: active`) and resets `consecutive_failures`; recreating also still works.

### 2.7 Secret rotation and replay
- `POST /obx/v1/webhooks/{id}/rotate-secret` with `{"overlap_seconds": 0..604800}` (default 86 400): returns the new secret once. During the overlap every delivery carries two signatures, new first: `OBX-Webhook-Signature: v1=<new>, v1=<old>` (already allowed by the 0.2 header pattern). After the overlap only the new one.
- Replay protection is unchanged: the timestamp is signed (`<timestamp>.<raw body>`) and receivers reject timestamps more than 300 s away; de-duplication on `id` covers the rest.

### 2.8 Test and verification
- `POST /obx/v1/webhooks/{id}/test` stays.
- On creation the node MUST send `webhook.verify` (`{"challenge": "<random, 32+ characters>"}`) before it answers. By default the subscription is created whatever the answer (as 0.2; the result is in `last_status` and `verified_at`). With `"verify": "challenge"` in the create body the receiver MUST answer 2xx within 10 s with `application/json` body `{"challenge": "<the same value>"}`; otherwise `422 validation_failed` (pointer `/url`) and nothing is created. RECOMMENDED for new clients; a 0.4 may make it the default.

### 2.9 Batching (capability `webhooks.batch`, optional)
- Opt-in per subscription: `"batch": {"max_events": 1..100, "max_wait_seconds": 1..60}`. The node then delivers `webhook.batch` events (`{"events": [WebhookEvent, …]}`) holding up to `max_events` events, after at most `max_wait_seconds`. Each inner event keeps its own `id` and `sequence`; the outer event has its own `id` (no `sequence`).
- Size: every delivery body MUST be at most **256 KiB** (batched or not); a single event at most 64 KiB. Nodes split batches to stay under.
- Since `changes.available` is coalesced anyway, batching mostly helps clients with many export or grant events (open decision 7).

### 2.10 New event types
`webhook.verify`, `webhook.disabled`, `webhook.batch` (only to subscriptions that asked for it). 0.2 receivers MUST already ignore unknown types (§2); they SHOULD answer them 2xx.

## 3. Replaced images: `previous_sha256`

What 0.2 already does, made explicit for all three ways in: re-sending an image for the same asset (same `external_id`, which for an import is `{style}_{color}_{position}`; a `PUT` of the asset through the Ingest API; "Replace image" in the admin UI) with **different** original bytes keeps the asset `id` and writes **exactly one** `asset` upsert to the feed; identical bytes write nothing (rule 6, ingest `unchanged`).

New in 0.3:
- **Asset `previous_sha256`**: the `sha256` of the original bytes before the most recent replacement; `null` when the bytes were never replaced. It sits next to `sha256` (both are about the original bytes, present even when the `original` rendition is not offered). A metadata-only change (role, view, rights) keeps it as it is. Nodes MUST set it the same way for import, Ingest API and admin UI.
- It travels in the feed entry's `data` (the current Asset), in `GET /assets/{id}`, in ProductDetail, in exports (`asset` manifest lines) and in the portal. `Change` itself does not change.
- It is informational: it lets a consumer find and purge the old file in its DAM or CDN. Whether to download is still decided by comparing `sha256` with what the consumer holds (with at-least-once delivery and two replacements between reads, `previous_sha256` is not the consumer's copy).
- Renditions are regenerated; their `sha256` change too. Rendition objects get no previous hash.
- **Conditional and old requests.** After the replacement is visible in the feed a node MUST NOT serve the old bytes: `If-None-Match: "<old sha256>"` on a rendition answers **200** with the new bytes and the new `ETag` (never 304); `If-Range` with the old ETag answers 200 with the whole new representation; a signed rendition URL handed out before the replacement keeps working until its expiry and serves the **new** bytes (URLs name the asset and rendition, not a version). `OBX-Content-SHA256` tells the client which bytes it got. Old bytes are never answered with 404 (the asset still exists); 404 stays reserved for assets that are not visible.
- **Webhooks:** the one feed entry triggers `changes.available` like any other (subject to filters and coalescing).

Schema: `Asset.previous_sha256`: `{"anyOf": [{"$ref": "Common.json#/$defs/Sha256"}, {"type": "null"}], "description": "SHA-256 of the original bytes before the most recent replacement; null if never replaced."}`. Import CSV: no change.

## 4. Buyer notifications (capability `portal.notifications`)

People at a retailer (portal users, role `retailer`) subscribe per brand, optionally per collection, to e-mails about new products, new or replaced images and changed EANs, immediately or as a weekly digest. It is a node feature in the Node Admin + Portal API, **normative for nodes that advertise `portal.notifications`** (which requires `portal`), so that every node behaves the same and the conformance suite can test it. The rest of node-admin.yaml stays non-normative; its header will say so.

### 4.1 What counts (built on the change feed)
Notifications are computed from the change feed as the subscriber's retailer would see it (the same grant, visibility, embargo and rights rules as `/changes` for that retailer), over a window (since the last mail of this subscription), and evaluated at send time:

| Kind | Event key | Counts |
|---|---|---|
| New product | `new_products` | a product that became visible to the retailer in the window (first publish, re-publish, or added to the grant) |
| New image | `new_images` | an asset that became visible in the window, or was **replaced** (part 3: new `sha256`), on a product that is not itself new |
| Changed EAN | `changed_gtins` | a variant of a product that is not new, whose `gtin` was added, changed (old → new) or removed in the window |

Objects that are no longer visible at send time are left out. Images under embargo (`rights.embargo_until` in the future) are never mentioned or shown.

### 4.2 Subscriptions
`NotificationSubscription`: `id`, `brand_id`, `collections` (list; empty = all collections of the brand; matched folded and exact as 1.1), `events` (non-empty subset of `new_products`, `new_images`, `changed_gtins`), `frequency` (`immediate`, `weekly`), `language` (one of the node's content `languages`; default the user's UI language if offered, else `languages[0]`), `status` (`active`, `paused`, `suppressed` after a hard bounce), `consented_at`, `created_at`, `updated_at`, `last_sent_at`.

- Only the user creates their own subscriptions (consent). An admin cannot subscribe anyone.
- A user may only subscribe to brands in the retailer's grant (`422 validation_failed`, pointer `/brand_id`). When the grant shrinks or the retailer is blocked, affected subscriptions send nothing; when the user is deleted, their subscriptions are deleted.
- At most 20 subscriptions per user (`409 conflict`).

### 4.3 Sending
- **Immediate:** collected for 15 minutes after the first qualifying change, then one mail per subscription. At most 1 mail per subscription per 15 minutes and 24 mails per recipient per day across subscriptions; above that, what is left goes into the next allowed mail.
- **Weekly digest:** once a week at the day and hour the brand admin set (default Monday 08:00 in the node's time zone), covering the 7 days since the previous digest. No mail when there is nothing to report.
- **Content**, per brand and collection, in the subscription's language (falling back to `languages[0]` for missing names): new products (style number, name, colours, a `thumb` image and a link to the product in the portal), new images (product, colour, position, role; "replaced" when it was a replacement), changed EANs (style number, colour, size, old → new GTIN). At most 50 lines per section, then "and N more" with a link to the portal filtered on that brand and `updated_since`. Links go to the portal and require login; images use signed `thumb` URLs that expire after at most 14 days (never permanent public URLs, [protocol.md §5.5](../protocol.md#55-renditions)).
- **Headers:** `List-Unsubscribe: <https://<host>/admin/api/public/unsubscribe/<token>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058; the message MUST be DKIM-signed covering both headers), `Content-Language`, a plain-text part; HTML optional. Sender: the node's configured address, reply-to the brand's contact.
- **No tracking:** no tracking pixels, no rewritten links, no open or click statistics.

### 4.4 Unsubscribe
- Every mail has a per-subscription unsubscribe token (opaque, ≥ 128 bits of randomness, valid while the subscription exists).
- `POST /admin/api/public/unsubscribe/{token}` with body `List-Unsubscribe=One-Click` (form encoded) unsubscribes **without** login, cookies or CSRF token, answers `200` (also when already unsubscribed or the token is unknown, so tokens cannot be probed) and is idempotent.
- `GET` on that URL MUST NOT unsubscribe (mail scanners follow links). The visible link in the mail goes to the UI route `/unsubscribe/{token}` with a button that posts, plus "unsubscribe from all notifications of this portal".
- Users can also pause or delete subscriptions in the portal.

### 4.5 Privacy
- Lawful basis: consent, given by the logged-in user's own action; `consented_at` and the text version shown are stored. The e-mail address is the portal account's (verified by the invite), so no double opt-in is needed.
- Stored: the subscription, the consent record and a delivery log (recipient user id, time, kind, counts, status) kept at most 90 days. No content of sent mails beyond that log.
- Hard bounces set `status: suppressed`; the user sees it in the portal and can resume after fixing the address.

### 4.6 What the admin sees
- `GET /admin/api/notifications/subscriptions`: every subscription with retailer, user (name, e-mail), brand, collections, events, frequency, language, status, created and last sent. Read-only, except `DELETE` (for example on a user's request).
- `GET /admin/api/notifications/deliveries` (cursor-paginated, newest first) and `GET /admin/api/notifications/deliveries/{id}`: recipient, subscription, kind, time, counts per section, status (`sent`, `bounced`, `failed`, `skipped_rate_limit`), and for the last 7 days the rendered headers and text part (for support, and for the conformance suite).
- `PATCH /admin/api/settings` gains `notifications: {enabled, weekly_day, weekly_hour, sender_name}`. With `enabled: false` nothing is sent and the portal hides the feature.
- `POST /admin/api/notifications/run` with `{"frequency": "weekly" | "immediate"}` sends due mails now (testing and support); `202`.

### 4.7 Endpoints (to be added to node-admin.yaml in 0.3)

| Method and path | Who | What |
|---|---|---|
| `GET`, `POST /admin/api/portal/notification-subscriptions` | retailer user | own subscriptions; create (`201`) |
| `GET`, `PATCH`, `DELETE /admin/api/portal/notification-subscriptions/{id}` | retailer user | read, change (`events`, `collections`, `frequency`, `language`, `status`), delete |
| `GET /admin/api/portal/notification-preview?subscription_id=&frequency=` | retailer user | what the next mail would contain now (same sections and counts; nothing is sent) |
| `POST /admin/api/public/unsubscribe/{token}` | anyone with the token | RFC 8058 one-click |
| `GET /admin/api/notifications/subscriptions`, `DELETE …/{id}` | admin | overview |
| `GET /admin/api/notifications/deliveries`, `…/{id}` | admin | delivery log |
| `POST /admin/api/notifications/run` | admin | send due mails now |

```yaml
    NotificationSubscription:
      type: object
      required: [id, brand_id, collections, events, frequency, language, status, consented_at, created_at, updated_at, last_sent_at]
      properties:
        id: {type: string}
        brand_id: {type: string}
        collections: {type: array, maxItems: 50, items: {type: string, maxLength: 200}}
        events:
          type: array
          minItems: 1
          uniqueItems: true
          items: {type: string, enum: [new_products, new_images, changed_gtins]}
        frequency: {type: string, enum: [immediate, weekly]}
        language: {type: string, description: One of the node's content languages.}
        status: {type: string, enum: [active, paused, suppressed]}
        consented_at: {type: string, format: date-time}
        created_at: {type: string, format: date-time}
        updated_at: {type: string, format: date-time}
        last_sent_at: {type: [string, 'null'], format: date-time}
    NotificationSubscriptionInput:
      type: object
      required: [brand_id, events, frequency]
      properties:
        brand_id: {type: string}
        collections: {type: array, items: {type: string}}
        events: {type: array, minItems: 1, items: {type: string, enum: [new_products, new_images, changed_gtins]}}
        frequency: {type: string, enum: [immediate, weekly]}
        language: {type: string}
    NotificationDelivery:
      type: object
      required: [id, subscription_id, user_id, kind, at, status, counts]
      properties:
        id: {type: string}
        subscription_id: {type: string}
        user_id: {type: string}
        recipient_email: {type: string, format: email}
        kind: {type: string, enum: [immediate, weekly]}
        at: {type: string, format: date-time}
        status: {type: string, enum: [sent, bounced, failed, skipped_rate_limit]}
        counts:
          type: object
          properties:
            new_products: {type: integer, minimum: 0}
            new_images: {type: integer, minimum: 0}
            changed_gtins: {type: integer, minimum: 0}
        headers: {type: [object, 'null'], additionalProperties: {type: string}, description: Rendered headers (7 days).}
        text: {type: [string, 'null'], description: Rendered text part (7 days).}
```

## Compatibility with 0.2

Nothing is breaking:

| Change | Why a 0.2 client keeps working |
|---|---|
| New query parameters on `/products` | not sent by 0.2 clients; the 0.2 behaviour (filters `ids`, `brand_id`, `updated_since`, `id` order, `limit` 25) is the default |
| `brand_id` accepts a list | one id is still one id (ids cannot contain commas) |
| `total` member, sparse responses | only with `include=total` / `fields`, which 0.2 clients do not send |
| Webhook limit "at most 5" becomes "at least 5, see `limits.webhook_subscriptions_max`" | a node that allows 5 is conformant; clients never needed more |
| New WebhookEvent members (`subscription_id`, `sequence`), new event types, new subscription members and the `paused` status | clients MUST ignore unknown members, event types and enum values ([protocol.md §2](../protocol.md#2-conventions)) |
| `webhook.verify` on creation | by default the subscription is created whatever the receiver answers |
| Retries 24 h minimum, 3-day disabling | unchanged; 72 h retries are a SHOULD |
| `Asset.previous_sha256` | new optional member |
| "Never serve old bytes for an old ETag" | what every 0.2 node already does (the ETag is the hash of the current bytes); now written down |
| `portal.notifications` | a new capability and new endpoints |

The closed JSON Schemas get the new members as optional properties, so 0.2 documents stay valid against them. `DiscoveryDocument.limits` gets `webhook_subscriptions_max` as optional (`minimum: 5`). Against a 0.2 node a 0.3 client checks `products.search` before filtering (a 0.2 node ignores the parameters and returns everything) and reads `obx_version` before relying on 2.x and part 3.

## Conformance test ideas

Protocol profile (when the capability is advertised):

| Id | Test |
|---|---|
| P-SRCH-1 | `products.search` advertised; without it, the suite checks that the node is 0.2-shaped (skips the rest) |
| P-SRCH-2 | each filter on the Kestrel fixtures returns exactly the products in `expected/search/<case>.json` (season, collection, item_type, target_group, color_code, gtin as EAN-13 and GTIN-14, brand_id list) |
| P-SRCH-3 | OR within a list, AND between parameters; `color_code`+`gtin` must match one variant; matched products carry all their variants |
| P-SRCH-4 | `q`: `merino`, `MÉRINO`, `crew merino` find KO-1001; a GTIN finds its product; one character → 400 `invalid_request` with `pointer` `query:q`; the fold vectors of `fixtures/search/fold.json` (through `q` on fixture names) |
| P-SRCH-5 | every sort key ascending and descending: order as expected; paging with `limit=1` gives the same sequence as `limit=100`; ties broken by `id` |
| P-SRCH-6 | a cursor from `season=AW26` sent with `season=SS26` → 400 `cursor_invalid`; changing `limit` and `fields` between pages works |
| P-SRCH-7 | `include=total` exact on every fixture case; absent without it; `include=nope` → 400 |
| P-SRCH-8 | `fields=name`: only `id`, `brand_id`, `style_number`, `updated_at`, `name`; `fields=nope` → 400 with one `errors[]` entry; with `ids=` too |
| P-SRCH-9 | the restricted client never finds `kestrel-trail` products through any filter, `q` or `gtin` |
| P-SRCH-10 | 101 values in one filter → 400 `limit_exceeded`; unknown sort → 400 `invalid_request`; `ids=` still ignores the other filters |
| P-HOOK-2 | `limits.webhook_subscriptions_max` ≥ 5; that many subscriptions can be created, one more → 409 |
| P-HOOK-3 | creation sends `webhook.verify`; with `verify: challenge` a receiver that echoes is created, one that answers 204 → 422 and nothing is created |
| P-HOOK-4 | events carry `subscription_id` and `sequence` 1, 2, 3 … per subscription; a retry keeps `id` and `sequence` |
| P-HOOK-5 | receiver answers 500, then 429 with `Retry-After: 5`, then 200: three attempts, the third not before 5 s, each with a valid signature and `OBX-Webhook-Attempt` 1, 2, 3; then visible in the delivery log with status codes and durations |
| P-HOOK-6 | `filter.brand_ids: [kestrel-trail]`: an ingest write to `kestrel` gives no `changes.available`, one to `kestrel-trail` gives one within 60 s whose `latest_seq` ≥ the entry's `seq` |
| P-HOOK-7 | redeliver by event id and by time range: same `id`, `sequence` and body, new timestamp |
| P-HOOK-8 | paused: no events during writes; resume: one `changes.available` |
| P-HOOK-9 | rotate with `overlap_seconds: 5`: two signatures (new first) during the overlap, only the new one after; the old secret alone stops verifying |
| P-HOOK-10 | (if `webhooks.batch`) `max_events: 3`: `webhook.batch` with up to 3 events with their own ids; every body ≤ 256 KiB |
| P-HOOK-11 | `410` from the receiver disables the subscription (`receiver_gone`); `PATCH status: active` re-activates it |
| P-MEDIA-4 | replace `KO-1001_NVY_1` with other bytes (ingest, import or operator hook): exactly one `asset` upsert, same asset id, `previous_sha256` = the old `sha256`; a webhook subscriber gets `changes.available`; `If-None-Match` with the old ETag → 200 with the new bytes and ETag; a signed URL fetched before → new bytes; the same bytes again → no entry, no event |

Ingest and portal profiles:

| Id | Test |
|---|---|
| I-IMP-11 | import `KO-1001_NVY_1.jpg` with new bytes: one asset upsert with `previous_sha256`; the same file again: all unchanged, no entries; a metadata-only change keeps `previous_sha256` |
| A-CAT-2 | "replace image" through the admin catalog API gives the same entry and `previous_sha256` as the Ingest API |
| A-NOTIF-1 | (if `portal.notifications`) subscription CRUD for a retailer user; brand outside the grant → 422; language not offered → 422; an admin cannot create one for a user |
| A-NOTIF-2 | immediate: ingest a new Highland product → after `notifications/run` one delivery for the `collections: [Highland]` subscriber, none for `[Trail]`; 30 writes in a minute → one mail |
| A-NOTIF-3 | weekly digest via `notifications/run`: new product, replaced image (marked replaced) and changed GTIN (old → new) in the right sections; an embargoed image is not mentioned; nothing new → no delivery |
| A-NOTIF-4 | delivery headers: `List-Unsubscribe` with an https URL and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; `POST` with `List-Unsubscribe=One-Click` and no cookies → 200, subscription gone, again → 200; `GET` does not unsubscribe; an unknown token → 200 |
| A-NOTIF-5 | a `nl` subscription gets Dutch names and `Content-Language: nl`; text part present; no tracking parameters in links |
| A-NOTIF-6 | restricted or blocked retailer: no mail about brands outside its grant; deleted user → subscriptions gone |
| A-NOTIF-7 | the admin sees subscriptions and deliveries (with headers and text for 7 days); `notifications.enabled: false` → nothing sent |

Fixtures: `expected/search/*.json` (one file per case), `fixtures/search/fold.json` (fold vectors), a second image file for KO-1001_NVY_1 (`fixtures/replace/`), expected notification sections for the digest case.

## Rollout

One release with proposal 0004, as 0.3.0: OpenAPI and schemas (`products` parameters and `total`, `ProductDetailPartial`, `WebhookEvent`, `WebhookSubscription`, `WebhookDelivery`, `Asset.previous_sha256`, `DiscoveryDocument.limits.webhook_subscriptions_max`), protocol.md §7 and §9 rewritten, node-admin.yaml with the notification endpoints marked normative for `portal.notifications`, the conformance tests above in obx-go, the SDK (`ProductsQuery` gets the new fields, a capability check, `Total`), then the three nodes. Nodes may ship part 1 and part 4 later: they are capabilities. Part 2 (except 2.9) and part 3 come with the 0.3 version number.

## Open decisions for the owner

1. **List syntax.** Comma-separated with `\,` escape (as asked; short URLs) or repeated parameters (`season=SS26&season=AW26`, what the portal API uses). *Recommendation:* comma, and also accept repetition (both are cheap; repetition avoids escaping).
2. **Case-insensitive exact matching** for text filters. *Recommendation:* yes, brands type `AW26` and `aw26`; import already matches colour codes case-insensitively.
3. **Total.** Exact up to 10 000, `gte` above. *Recommendation:* as specified; always-exact would make D1 and MySQL slow on big catalogs.
4. **What `q` searches.** Names, style numbers, colours, SKU, GTIN, external id; not descriptions. *Recommendation:* as specified; descriptions later, if retailers ask.
5. **Unknown `fields` and `include` values.** 400 (strict) or ignore. *Recommendation:* 400, typos fail loudly; clients check `obx_version` for newer names.
6. **Webhook URL verification.** Opt-in challenge in 0.3, default in 0.4? *Recommendation:* yes.
7. **Batching.** Keep `webhooks.batch` (optional) or drop it, since coalescing covers `changes.available`. *Recommendation:* drop from 0.3 unless a retailer needs it; the 256 KiB body limit stays.
8. **Retry window.** MUST 24 h, SHOULD 72 h, disable after 72 h of failures. *Recommendation:* as specified (equal to 0.2's 3 days).
9. **Old fingerprint after a replacement.** 200 with new bytes, or 404/410 for URLs and ETags of old bytes. *Recommendation:* 200: URLs name the asset, not a version, and every 0.2 node already behaves so.
10. **Where the normative notification text lives.** Inside node-admin.yaml (then "non-normative except `portal.notifications`") or a new `docs/notifications.md` with the endpoints in node-admin.yaml. *Recommendation:* the doc plus the endpoints, tagged.
11. **Filtered change feed** (`/changes?brand_id=`), so a webhook filter can be matched by a feed filter. *Recommendation:* not in 0.3; it complicates cursors and snapshots.
12. **Filters on 0004 terms** (material code, qualifier such as `organic`) and on `color.family`, `item_subtype`. *Recommendation:* `color_family` and `item_subtype` in 0.3 (same cost as the others); materials after 0004 is released.
13. **Weekly digest time.** Monday 08:00 node time, set by the brand admin. *Recommendation:* yes; per-recipient time zones later.
