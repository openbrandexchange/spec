# OBX in 10 minutes

For a **retailer's developer** who wants a brand's products, sizes, EANs and final images in a shop, PIM or ERP. You need `curl` and `jq`, and nothing else. Everything here is the [OBX Protocol](protocol.md), the part of OBX that every brand's portal speaks. The Ingest API, the import format and the admin API are for the brand's side and you do not need them.

The examples use the fictional brand portal `https://brands.kestrel.example` and its test catalog ([`fixtures/kestrel`](../fixtures/kestrel)).

## 1. Discovery: what does this brand offer?

```sh
HOST=https://brands.kestrel.example
curl -s $HOST/.well-known/obx | jq '{obx_version, api_base, token: .auth.token_endpoint, capabilities, brands: [.brands[].name]}'
```

The [discovery document](../schemas/DiscoveryDocument.json) is public. It tells you the API address (`api_base`, always ending in `/obx/v1`), where to get a token, where to request access, and which optional parts the portal offers (`exports`, `webhooks`, ...). Ignore capabilities you do not know.

## 2. Access: get an API key

No key yet? Ask the brand in its portal ("Request access", tick API access), or from code ([protocol.md §4.1](protocol.md#41-access-requests)):

```sh
curl -s -X POST $HOST/obx/v1/access-requests -H 'Content-Type: application/json' \
     -d @fixtures/examples/AccessRequestInput.example.json        # → 202 with id and request_token (shown once)
```

Poll `GET /obx/v1/access-requests/{id}` with `Authorization: Bearer <request_token>` at most once a minute. After the brand approves, the **first** read returns the `client_id` and `client_secret`; store them, because they are never shown again.

## 3. Token

```sh
TOKEN=$(curl -s -u "$CLIENT_ID:$CLIENT_SECRET" -d grant_type=client_credentials \
        $HOST/obx/v1/oauth/token | jq -r .access_token)
```

OAuth2 client credentials. A token lives about an hour; when a call answers `401 invalid_token`, get a new one. `401 access_revoked` means the brand ended your access: stop syncing and tell a person.

## 4. The change feed: everything, then only what changed

```sh
curl -s -H "Authorization: Bearer $TOKEN" "$HOST/obx/v1/changes?limit=500" | jq '{phase, has_more, next_cursor, n: (.changes | length)}'
```

Without a cursor you get a **snapshot**: one `upsert` for every brand, product, variant and asset you may see, each with its current `data`. Keep calling with `cursor=<next_cursor>`. The first page with `phase: "live"` means the snapshot is complete; from then on you only get changes. When `has_more` is `false`, store `next_cursor` and ask again later (once a minute is plenty, or when a webhook says so).

Apply each entry by `type` and `op`:

| Entry | Do |
|---|---|
| `upsert` | create or replace your copy of the object with `data` (it is always the current version) |
| `delete` | remove it (ignore ids you do not know) |
| `grant` with `resync: true` | what you may see changed: start again without a cursor, then delete what the new snapshot did not contain |

Entries can repeat and a variant can arrive before its product; key everything on `id`. Details: [protocol.md §6](protocol.md#6-the-change-feed).

## 5. Products, variants and images

A product in the feed is the style; its sizes (`variant`) and images (`asset`) are separate entries. To read one product with everything in it:

```sh
curl -s -H "Authorization: Bearer $TOKEN" "$HOST/obx/v1/products/<id>" | jq '{style_number, item_type, item_subtype, materials, features, variants: [.variants[] | {gtin, size, measurements}], assets: [.assets[] | {position, role, view}]}'
```

What you get ([protocol.md §5](protocol.md#5-data-model)):

- **product**: style number, names and descriptions per language, item type and subtype, composition per part (with `recycled`/`organic` flags), care codes, country of origin, footwear materials, certifications and typed features (wheels, lock, closure, ...);
- **variant**: colour (with a colour family for filters), size, the EAN as `gtin` (14 digits; `gtin_original` is what the brand typed) and measurements in cm, kg and litres;
- **asset**: a final image with its colour, order (`position`), role, view, usage rights and AI provenance.

Which of these the law requires you to show is in [protocol.md §5.9.7](protocol.md#legal-basis). Respect `rights.embargo_until` (do not show the image publicly before then) and pass `provenance` on to your own channels.

Already have EANs? Look them up directly (up to 2000 per call):

```sh
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"gtins": ["2000100801017", "2000100101025"]}' "$HOST/obx/v1/products:by-gtin"
```

## 6. Renditions: the image files

Every asset has `renditions`: `web` (JPEG, at most 2000 px), `square` (the web image on a white square), `thumb` (at most 600 px) and, if the brand allows it for you, `original` (the exact uploaded file).

```sh
curl -s -H "Authorization: Bearer $TOKEN" -o KO-1008_BLK_1.jpg "$HOST/obx/v1/assets/<asset id>/renditions/web"
```

Or use the rendition's `url`: when `url_expires_at` is set it works without a token until then; read the asset again (`GET /obx/v1/assets/{id}`) for a fresh one. Every rendition has a `sha256`: download only when it changed, and check the bytes. Details: [protocol.md §5.5](protocol.md#55-renditions).

## Done. Optional extras

| When you want | Use | Capability |
|---|---|---|
| a nudge instead of polling | webhooks, `changes.available` ([§9](protocol.md#9-webhooks-capability-webhooks)) | `webhooks` |
| one big download of everything | bulk exports: manifest + zip parts ([§8](protocol.md#8-bulk-exports-capability-exports)) | `exports` |
| to tell the brand where its images are used | usage events ([§10](protocol.md#10-usage-events-capability-usage)) | `usage` |

Check `capabilities` in the discovery document first; a portal without one answers `501 not_implemented`. To test your code without a real brand, run the mock portal from [obx-go](https://github.com/openbrandexchange/obx-go): `obx-conformance mock --addr :8080` starts an in-memory portal that speaks the whole protocol.
