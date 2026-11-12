# Notes for implementers

Decisions taken while writing v0.1.0 where the plan was silent or ambiguous. Each is the simplest reading; challenge them with a pull request.

## Interpretation decisions

1. **Change types include `brand`.** The plan listed `product|variant|asset|grant`; brand unpublishing needs a tombstone too, and clients must ignore unknown types anyway.
2. **`/changes` entries embed the current object** (`data` on upserts) so a consumer syncs in one pass. Upsert entries of objects that are not visible at read time are omitted (a delete entry always follows a visible → invisible transition).
3. **Grant changes trigger a resync** (`grant` entry with `resync: true`) instead of per-retailer synthetic upserts/deletes. Consumers restart without a cursor and mark-and-sweep after the snapshot (first `phase: live` page).
4. **Product responses embed variants and assets** (`ProductDetail`); feed entries do not (separate entries).
5. **A product is visible without images.** OBX publishes article data (GTIN, materials) even before photos exist. An implementation MAY be stricter for its own reasons (one commercial implementation hides products without a final image); consumers must cope with both.
6. **PUT replaces, except `status` and asset `files`** (omitted = keep), so nightly syncs never republish what a person unpublished.
7. **One key per object**: the external id in the path. Conventions: product = style number, variant = GTIN as supplied, asset = `{style}_{color}_{position}`.
8. **Position uniqueness is enforced on write** (`position_conflict`) among non-deleted assets of product + colour; reordering has its own atomic endpoint (`asset-order`), and one import applies a product colour's positions atomically.
9. **GTINs are strict on ingest** (valid check digit, unique per node) and lenient on lookup (check digit not validated, 8/12/13/14 digits).
10. **Embargo = delivered but not shown publicly**; `expires_at` = removed from the feed (tombstone within 1 h).
11. **Default rights** when the brand configured nothing: `retailer-use`, channels `webshop, marketplace, social` (not `print`), worldwide.
12. **Access-request credentials** are handed to the requester once via the polling endpoint; the brand admin never sees the secret.
13. **Setup code** is required for first-run setup (printed in the log on first start or preset by `OBX_SETUP_CODE`), so an internet-facing fresh node cannot be claimed by someone else. There is never a default password.
14. **Selections are stored server-side** per user (max 1000 products); sync zips are capped at 400 images, larger sets go through background download jobs.
15. **Imports accept an `images_manifest`** of already-uploaded blobs, so the CLI and the admin UI upload only new images and there is one parser (in the node).
16. **`mirror` imports** refuse to unpublish more than half of the affected brands' products unless `allow_mass_unpublish` is set.
17. **CSV export = canonical import columns + `image_files`**, so exports can be re-imported.
18. **Renditions are always JPEG** (`web`, `square` on white, `thumb`); `original` keeps its type and bytes.
19. **Admin catalog endpoints reuse ingest semantics** (same bodies and results, session auth), so nodes implement one write path.
20. **Webhook secret is the HMAC key as UTF-8 bytes including the `whsec_` prefix.**

## Decisions for v0.2.0 (product data)

The design is [proposal 0002](docs/proposals/0002-product-data.md). Where it was silent:

21. **Output conventions.** New product and variant properties are always present (`null` when not stated). Inside `measurements` and `features` only stated members are present (never an empty object), and the fibre flags `recycled`/`organic` only when true, so 0.1 objects and expected fixtures do not change shape.
22. **Fibre normalisation is general**: every `recycled_<fibre>` and `organic_<fibre>` key is normalised on every write path, not only the four 0.1 keys.
23. **Certifications in the CSV** take an optional `(material)` / `(product)` suffix (default `product`), the same style as the `(recycled)` fibre flag; the proposal's CSV example had no scope.
24. **`strap_length_cm` with one number** means a fixed strap (`min` = `max`). Measurement cells accept `,` as decimal separator.
25. **Registry feature values are validated** (`validation_failed`); unknown feature keys are stored as sent (CSV: as a string, with a warning).
26. **Schemas moved to `/schemas/v0.2/`**; the 0.1 schemas stay unchanged in `schemas/v0.1/` so their `$id`s keep resolving.
27. **Label completeness warnings** (`fibre_composition_missing`, `animal_origin_unknown`, `footwear_materials_missing`, `fibre_percentages_not_100`) are warnings with stable codes, never errors.

## Shared node conventions (non-normative, for node-go, node-php, node-ts and admin-ui)

| Setting | Meaning |
|---|---|
| `OBX_PUBLIC_URL` | public base URL (links in e-mails, discovery `api_base`) |
| `OBX_SETUP_CODE` | optional preset setup code (otherwise generated and logged on first start) |
| `OBX_SECRET_KEY` | 32+ byte key for encrypting stored credentials and signing URLs |
| `OBX_ALLOW_PRIVATE_URLS` | `true` only in development: allow private/loopback import and webhook URLs |
| `PORT` | listen port, default `8080` |

- The node serves the admin-ui build at `/` with SPA fallback (any GET outside `/admin/api`, `/obx/`, `/.well-known/` that accepts `text/html` returns `index.html`). Links the node e-mails: `/invite/{token}`, `/reset-password/{token}`; public pages `/login`, `/request-access`.
- The admin UI generates `web`/`square`/`thumb` in the browser when `Settings.node.renditions_server_generated` is false, uploads them as blobs and imports with an `images_manifest`.
- The UI shows enum keys (roles, views, care codes, item types) with its own en/nl labels.
- E-mails (as built in node-go; the other nodes should match): texts are the `email.*` groups in the vendored admin-ui `dist/locales/<lang>.json` (`invite`, `accessRequestReceived`, `accessRequestNew`, `accessApproved`, `accessRejected`, `zipReady`, `passwordReset`), in the recipient's language with `en` fallback. Plain text in this order: `greeting` (or `greetingNoName`), `body`, `reason`, `apiNote` (only when an API key was created), `button` + `:` + newline + link, `expiry`, `ignore`, `contact`, `signoff`, then `-- ` and `footer`. A line with an unfilled `{{placeholder}}` is left out. `{{portal}}` is `<brand> · <word>`, the word being the brand's `portal_name` for that language or `glossary.portal`; `{{expires}}` is written `YYYY-MM-DD`. Links: invite `/invite/{token}`, reset `/reset-password/{token}`, admin review `/admin/requests`, approved `/login`, zip `/downloads`.
- `branding.portal_name` (Settings and PublicBranding in node-admin.yaml): optional LocalizedText that replaces the portal word; updated by JSON merge patch, so removing one language means sending `null` for it.
- **Several brand companies on one host.** The protocol assumes one node per host. A hosted service that serves several brand companies from one application host MAY select the company with a query parameter (for example `?portal=<slug>`) on discovery and access requests, provided the discovery document it returns hands out `api_base`, `token_endpoint`, `access_request_url` and `ingest_url` that already carry the selector, so a consumer never has to know about it. A separate hostname per brand company remains the RECOMMENDED setup.
- **Import counts** count brands only when the import created them (see [import-format.md §4](docs/import-format.md#4-processing-rules), rule 7).
- **API keys** made in the admin get `catalog:read` and `media:read` (+ `media:original` when allowed) unless the admin picks scopes; `usage:write` only on request.
- **Images of all colours** are named `{style}_ALL_{position}` ([import-format.md](docs/import-format.md#all-colours)).
- **`obx pull`** downloads the `web` version by default (`--renditions original,web,square,thumb` for more); it mirrors a catalog for a retailer and is not a backup of the brand's originals.

## Open questions

- Trademark registration of "Open Brand Exchange" (governance: planned at BOIP by the foundation).
- Whether `print` belongs in the default channels.
- Video/3D asset types (reserved: `media_type` values beyond `image`).
- Per-collection grants (v0.1 grants are per brand).
- Footwear with no material reaching 80 % of a part: Directive 94/11/EC then asks for the two main materials, while `footwear_materials` holds one value per part (the main one).
