# Conformance

An implementation is **OBX-conformant** for a profile when `obx-conformance` (in [obx-go](https://github.com/openbrandexchange/obx-go), `cmd/obx-conformance`) passes every REQUIRED test of that profile against it. Results are reported per test id so implementations can say exactly what they support.

| Profile | Tests | Who needs it |
|---|---|---|
| **protocol** | the read side ([protocol.md](protocol.md)) | every node; normative. **This is what "OBX-conformant" means** |
| **ingest** | the write side ([ingest.md](ingest.md), [import-format.md](import-format.md)) | nodes that offer the Ingest API; normative for them, optional otherwise |
| **portal** | the Node Admin + Portal API ([node-admin.yaml](../openapi/node-admin.yaml)) | nodes that want to run the shared `admin-ui`; non-normative |
| **security** | the observable parts of [security.md](security.md) that the other profiles do not cover | every node; needs admin credentials or a setup code |

## Running

```sh
obx-conformance protocol --url https://node.example --client-id obxc_… --client-secret obxs_… \
    [--second-client-id … --second-client-secret …] [--no-original-client-id … --no-original-client-secret …] [--fixtures ./spec/fixtures]
obx-conformance ingest   --url https://node.example --token obxi_… --client-id … --client-secret …   # needs a fresh node
obx-conformance portal   --url https://node.example --setup-code …                                  # needs a fresh node
obx-conformance all      --url http://localhost:8080 --setup-code …                                 # fresh node: setup, then everything
obx-conformance all      --url http://localhost:8080 --setup-code … --rate-limit-test               # also S-RATE-2 (locks the test IP out for a while)
obx-conformance list                                                                                # every test id, REQUIRED or optional
obx-conformance mock --addr :8080                                                                   # the in-memory mock node
```

`all` on a **fresh** node is the reference path used in CI by every node repository: it completes setup (company "Kestrel Outfitters", first brand "Kestrel" → external id `kestrel`, languages `nl,en`), creates an ingest token and two retailers with API clients (one restricted to brand `kestrel`, one without originals), imports [`fixtures/kestrel`](../fixtures/kestrel), then runs all profiles. The suite also ships a **mock node** (`obx-conformance mock`) that passes everything, for developing consumers.

### Nodes without the Ingest or Node Admin API

How a node gets its data and how a brand manages its retailers is up to the node. Such a node loads [`fixtures/kestrel`](../fixtures/kestrel) with its own import (company "Kestrel Outfitters", brands `kestrel` and `kestrel-trail`) and runs the protocol profile with an **operator**: a hook program, a person at the terminal, or a Go function in the node's own tests, that does the brand-side steps the tests need while they run (create, restrict and revoke an API key, approve an access request, change and unpublish a product).

```sh
obx-conformance protocol --url https://node.example --operator-hook ./obx-operator.sh
obx-conformance protocol --url https://node.example --operator-prompt
```

The actions and the hook's input and output are described in obx-go's [docs/conformance.md](https://github.com/openbrandexchange/obx-go/blob/main/docs/conformance.md#portals-without-the-ingest-or-node-admin-api). P-FEED-5 (the ingest replay) is skipped on such nodes; every other REQUIRED protocol test applies.

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
| P-CAT-1 | `GET /products/{id}` of KO-1001 and KO-1005 match `expected/product-KO-1001.json` and `expected/product-KO-1005.json`, including the 0.2 article data (KO-1001: `contains_animal_origin` `false`, `features` `{"fit": "regular", "sleeve_length": "long", "neckline": "crew"}`, certification `rws` / `CU 200101` / `material`, colour families `blue` and `beige`; KO-1005: `item_subtype` `weekender`, `contains_animal_origin` `true`, `measurements` with `strap_length_cm` `{"min": 100, "max": 130}`) |
| P-CAT-2 | `GET /products` keyset pagination is complete and stable; `ids=` filter; unknown ids silently omitted |
| P-CAT-3 | by-GTIN POST with `expected/gtin-lookup.request.json` matches `expected/gtin-lookup.json`; 2001 codes → 400 `limit_exceeded` |
| P-CAT-4 | invisible object → 404 (never 403) |
| P-CAT-5 | article data round trip ([protocol.md §5.9](protocol.md#59-article-data)): `GET /products/{id}` of KO-1008, KO-1009, KO-1010 and KT-2001 match `expected/product-KO-1008.json`, `-KO-1009.json`, `-KO-1010.json` and `-KT-2001.json`. In particular: **KO-1008** `item_type` `luggage`, `item_subtype` `cabin`, `features` `{"shell": "hard", "wheels": 4, "lock": "tsa_combination", "expandable": true, "closure": "zip"}`, lining part `{"code": "lining", "name": {"en": "Lining", "nl": "Voering", "de": "Futter", "fr": "Doublure"}}` with fibre `{"material": {"code": "polyester", "name": {"en": "Polyester", "nl": "Polyester", "de": "Polyester", "fr": "Polyester"}}, "percentage": 100, "qualifier": {"code": "recycled", "name": {"en": "Recycled", "nl": "Gerecycled", "de": "Recycelt", "fr": "Recyclé"}}}`, `contains_animal_origin` `null`; variant `2000100801017` (size `CABIN`) `measurements` `{"height_cm": 55, "width_cm": 40, "depth_cm": 20, "weight_kg": 2.6, "volume_l": 36, "volume_expanded_l": 42}`, variant `2000100801024` (size `CABIN PLUS`) `{"height_cm": 55, "width_cm": 40, "depth_cm": 23, "weight_kg": 2.8, "volume_l": 42, "volume_expanded_l": 48}`, both `size_system` `null` and `color.family` `black`. **KO-1009** `item_subtype` `laptop_bag`, `features` `{"closure": "flap", "laptop_compartment": true, "water_resistance": "water_repellent", "detachable_parts": ["shoulder_strap"], "adjustable_parts": ["shoulder_strap"]}`, `certifications` `[{"scheme": "grs", "licence_number": "CU 200901", "scope": "material"}]`, variant `2000100901014` `measurements` `{"height_cm": 30, "width_cm": 40, "depth_cm": 12, "weight_kg": 0.9, "volume_l": 14, "handle_drop_cm": 10, "strap_length_cm": {"min": 85, "max": 140}, "laptop_max_inch": 15.6}`, `color.family` `grey`. **KO-1010** `item_type` `shoes`, `item_subtype` `ankle_boot`, `footwear_materials` `{"upper": "leather", "lining_and_sock": "leather", "outer_sole": "other"}`, `contains_animal_origin` `null`, `features` `{"closure": "slip_on", "detachable_parts": ["insole"]}`, certification `lwg` / `LWG-200-1010` / `material`, variants `2000101001010`, `2000101001027`, `2000101001034` (sizes `41`, `42`, `43`, `EU`) with `heel_height_cm` `3.5` and `shaft_height_cm` `14`, `14.5`, `15`. **KT-2001** (imported with the 0.1 key `recycled_polyester`) outer fibre with material code `polyester` and qualifier code `recycled` |
| P-CAT-6 | article data shape, over the whole snapshot: every product has the properties `item_subtype`, `contains_animal_origin`, `footwear_materials`, `certifications` and `features`, every variant `size_length`, `measurements` and `color.family` (each possibly `null`); every object validates against the 0.3 schemas; no material code starts with `recycled_` or `organic_`; every `part`, `material` and non-null `qualifier` whose code is in [`vocabularies/`](../vocabularies) has exactly the vocabulary's name, the part `main` has the name `null`, and every care entry whose code is in `vocabularies/care.json` has exactly its `category`, `symbol` and `name`; no name has an empty string; no `measurements` or `features` object is empty, every `footwear_materials` has all three parts. KO-1004's variants have `size` `30`, `32`, `34`, `size_length` `32` and `measurements` `{"inseam_cm": 81}`; KO-1003 has a main fibre with material code `cotton`, percentage `100` and qualifier code `organic` and the certifications `gots` / `CU 200301` / `product` and `oeko_tex_standard_100` / `26.KST.20003` / `product`, in that order |
| P-MEDIA-1 | assets match `expected/asset-*.json` (AI provenance, embargo, large original, no-original client) |
| P-MEDIA-2 | every rendition: bytes hash to `sha256`; `ETag` and `OBX-Content-SHA256` headers; `Range` → 206; `If-None-Match` → 304; signed URL works without Authorization until expiry |
| P-MEDIA-3 | `original` bytes are identical to the fixture file; web ≤ 2000 px, thumb ≤ 600 px, square is square, all `image/jpeg`, never upscaled |
| P-ERR-1 | every 4xx/5xx body is problem+json with a known `obx_error` |
| P-RATE-1 | rate-limited responses carry `RateLimit-*`; 429 carries `Retry-After` (a real 429 is only provoked with `--rate-limit-test` against a node running with a lowered limit) |
| P-EXP-1 | (if `exports`) export of brand `kestrel` with web renditions: manifest header, lines valid, every file line matches a zip entry and its hash; `changes_cursor` usable |
| P-HOOK-1 | (if `webhooks`) subscribe to a local receiver; `webhook.test` arrives with a valid signature and timestamp; https-only and private-address targets rejected |
| P-USE-1 | (if `usage`) `POST /usage` → 202 with accepted count; appears in admin stats (portal profile) |

## Ingest profile

| Id | Test |
|---|---|
| I-INFO-1 | `GET /obx/v1/ingest` valid IngestInfo; limits ≥ the minimums in ingest.md §9 |
| I-AUTH-1 | missing scope → 403 `insufficient_scope`; brand-restricted token cannot write another brand |
| I-REPLAY-1 | replay [`fixtures/ingest/script.ndjson`](../fixtures/ingest) one operation at a time (PUT/PATCH/DELETE endpoints); results match `expected-results.json`; after each operation the new `/changes` entries match `expected-changes.json` (`after_op`). Before an asset operation's entries are read, the runner waits until the asset is no longer `pending_files` (max 60 s). On nodes with `server_generated: false` the runner adds client-generated renditions to `files`. |
| I-REPLAY-2 | the same script with every `external_id` (and `brand_external_id`/`product_external_id` reference) suffixed `-b`, sent as one `POST /batch` (JSON array), then suffixed `-c` as NDJSON: the results equal `expected-results.json`. `/changes` is read once, after the whole batch, so by [protocol.md §6.2](protocol.md#62-what-a-consumer-sees) it omits upserts of objects that are no longer visible at that moment. The expected entries are therefore `expected-changes.json` without the `upsert` entries of objects that are not visible after the last operation, in the same order (every `delete` entry stays). |
| I-IDEM-1 | repeating any upsert → `unchanged` and no change entry; `Idempotency-Key` returns the same job |
| I-FILE-1 | blob HEAD/PUT dedupe; wrong sha256 → 422 `checksum_mismatch`; unknown sha in `files` → 422 `blob_missing` |
| I-FILE-2 | multipart upload of a 12 MiB file in parts, resume after skipping a part (`upload_incomplete` first), complete |
| I-VAL-1 | invalid GTIN, duplicate GTIN, position conflict, unknown parent → the documented codes |
| I-IMP-1 | import of `fixtures/kestrel` as package zip and as csv+assets_csv+images gives the expected objects; second import → all unchanged, no change entries |
| I-IMP-2 | import with `images_manifest` instead of images gives the same result |
| I-IMP-3 | mirror import of a CSV missing one product unpublishes exactly that product; a mirror CSV with only one of the nine Kestrel products → `mass_unpublish_refused`; zip with `../evil.jpg` → `import_invalid` and nothing written |
| I-IMP-4 | row errors carry file, row, column and code; the job still succeeds |
| I-IMP-5 | an import of `products.csv` and the images without `assets.csv` keeps what the images already have ([import-format.md rule 8](import-format.md#4-processing-rules)): `KO-1002_BLK_2` stays embargoed until 2030, `KO-1003_RST_3` stays AI-generated, a credit set through the Ingest API survives, and the import is all unchanged with no change entries |
| I-IMP-6 | a `products.csv` with only `brand`, `style_number` and `name:en` (the fixture's values) keeps every other field ([import-format.md rule 9](import-format.md#4-processing-rules)): all unchanged, no change entries, `name:nl`, descriptions, materials and care still there; an empty `season` cell in a file that has the column removes the season |
| I-IMP-7 | the 0.2 columns ([import-format.md §1.6](import-format.md#article-data), rule 9 per key): on a node that holds exactly the import of `fixtures/kestrel` (as after I-IMP-1; restore it first if an earlier test changed it), import [`fixtures/imports/1-feature-update.csv`](../fixtures/imports) to `6-restore.csv` in order, each as `products.csv` (mode `upsert`, no images); after each, `counts`, the error rows, the new `/changes` entries and the listed protocol fields match the case in `fixtures/imports/expected.json`. In short: `feature:wheels` `2` changes only the wheels of KO-1008 (one `product` upsert); an empty `feature:wheels` cell removes only the wheels; `weight_kg` `2,7` on variant `2000100801017` changes only that weight (one `variant` upsert, product unchanged); KT-2001 with `100% polyester (recycled)` is unchanged (same as the 0.1 key); `5-invalid.csv` gives four `validation_failed` errors (rows 1–4, columns `feature:wheels`, `height_cm`, `color_family`, `footwear_materials`) and writes nothing; `6-restore.csv` (= `kestrel/products.csv`) updates exactly product KO-1008 and variant `2000100801017` (counts `updated` 2, `unchanged` 55) |
| I-IMP-8 | label completeness warnings ([import-format.md rule 10](import-format.md#label-completeness)): `fixtures/imports/label-warnings.csv` as `products.csv` with `dry_run: true` succeeds without errors and writes nothing; its warnings with a label code are exactly those in `label-warnings.expected.json`: row 1 `fibre_composition_missing` (`materials`), row 2 `animal_origin_unknown` (`contains_animal_origin`), row 3 `footwear_materials_missing`, row 4 `fibre_percentages_not_100` (`materials`), row 5 `footwear_materials_missing` (column `footwear_materials`, `severity` `warning`); row 6 gets none. The import of `fixtures/kestrel` (I-IMP-1) has none of the four codes |
| I-IMP-9 (optional) | Excel import ([import-format.md §5](import-format.md#excel)), for nodes that accept workbooks; skipped when the node answers a workbook with `unsupported_media_type`. Each converting case of [`fixtures/imports/xlsx/expected.json`](../fixtures/imports/xlsx) sent as `products.xlsx` (or `assets.xlsx`, with the `images_manifest` of `send` when a case has one) with `dry_run: true`: the run succeeds, the ImportRowErrors with severity error are exactly `import_errors`, with Excel row numbers and a `detail` that starts with `detail_prefix`, and the warnings include `warnings`. In short: `products-template.xlsx` (the template as it is) imports like `fixtures/kestrel/products.csv` with no errors, and without `dry_run` on a node that holds the fixtures it is all unchanged with no change entries; `edge-cases.xlsx` reads the visible sheet `Data` (not the hidden `Products`) and gives `validation_failed` at row 5 `weight_kg` (formula without a cached value, `value` `=G2*2`), `invalid_gtin` at row 6 `gtin` (`detail` starting `row 6, column gtin (D): `), `validation_failed` at row 8 `collection` (`#N/A`) and one warning for column `M`; `date1904.xlsx` and `assets-template.xlsx` (with its two images in the manifest) give no errors; `empty-header.xlsx` reads the sheet `Export` by its header `  Style - Number ` and gives the conversion errors of row 1 (`#REF!`, locator `row 1, column E: `), row 3 (`#DIV/0!` under an empty header) and row 4 (a date after 9999-12-31) and the warnings for columns `C` and `E`; a node that can show the converted rows (for example in a dry-run preview) shows `rows` |
| I-IMP-10 (optional) | Excel refusals ([import-format.md §5.5](import-format.md#excel)): each case of `fixtures/imports/xlsx/expected.json` with `error` (a macro-enabled workbook, an external link, a zip bomb, a value below row 100 001, a CSV renamed to `.xlsx`, an encrypted file, a `DOCTYPE`, a macro part next to an unreadable `[Content_Types].xml`, a number out of Excel's range, no visible products sheet), sent as `products.xlsx`: the run fails with `error.obx_error` that code, its results hold exactly one ImportRowError, with `row` and `column` `null` and that `obx_error` (`workbook_unsafe`, `workbook_too_large`, `workbook_invalid`, `workbook_sheet_missing`), and nothing is written (no change entries) |

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
| A-PORT-1 | retailer: product list, facets, detail, GTIN paste, selection, product zip, selection zip (entries and names, `assets.csv` with a row per image), CSV (canonical columns, formula-escaped), download job with file (`assets.csv` carries the embargo of `KO-1002_BLK_2`) |
| A-PORT-2 | retailer restricted to `kestrel` never sees `kestrel-trail` anywhere; originals hidden when not allowed |
| A-STAT-1 | downloads by retailers appear in stats; admin preview downloads do not |

## Security profile

Runs last (it creates extra retailers and changes settings back and forth). REQUIRED tests test a MUST of [security.md](security.md).

| Id | Test |
|---|---|
| S-HDR-1 (optional) | admin UI: `Content-Security-Policy` without inline or eval'd script, `frame-ancestors 'none'` (or `X-Frame-Options: DENY`), `Referrer-Policy`, `nosniff`; file downloads: `Cache-Control: private`, `nosniff`, portal downloads `Content-Disposition: attachment`; the protocol, ingest and admin APIs send no `Access-Control-Allow-Origin` (only discovery does) |
| S-TOK-1 | upload keys are refused on the protocol, access tokens on ingest and admin, a client secret is no bearer token |
| S-SESS-1 | a retailer user gets 403 on every admin endpoint; a session cookie is dead after logout; login does not keep a pre-login session id; changing the password ends the user's other sessions |
| S-ISO-1 | exports, retailer webhooks, access-request status, download jobs, selections and self-service API keys answer 404 to anyone but their owner; a brand-restricted key's export and GTIN lookup stay in its grant |
| S-URL-1 | a signed rendition URL cannot be moved to another asset or rendition, stripped, extended or re-signed, and stops working when the asset is unpublished |
| S-SSRF-1 | import sources, brand webhooks and retailer webhooks refuse loopback, private, CGNAT, link-local and metadata addresses in every spelling (IPv4-mapped IPv6, `0.0.0.0`, `localhost`) and non-https schemes; numeric shorthands such as `127.1` or `2130706433` may be saved but must never be fetched. With `OBX_ALLOW_PRIVATE_URLS=true`, link-local and metadata addresses are still refused ([security.md §5](security.md#5-outbound-requests-ssrf)) |
| S-UPL-1 | a blob over `max_upload_bytes` and a JSON object over `max_object_bytes` → 413; HTML sent as `image/png` → 415; an SVG logo is refused |
| S-CSV-1 (optional) | `data.csv` prefixes cells starting with `=` or `+` so spreadsheets do not run them |
| S-PATH-1 | encoded `..` paths under `/`, `/assets/`, `/locales/` and the logo URL never serve files outside the UI; `.env`, the database and configuration files are not served |
| S-URLS-2 | brand website, product `dpp_url`, company website and access-request website must be http(s) (no `javascript:`) |
| S-RATE-2 (optional, `--rate-limit-test`) | 60 failed logins or 120 failed token requests from one IP get a 429 |

Not observable from outside, so checked by review instead: hashing and encryption at rest, constant-time comparisons, secrets kept out of logs, DNS pinning of outbound requests, e-mail links built from the configured or recorded public address (never the request's `Host`). [implementations.md](implementations.md) lists the review results per node.
