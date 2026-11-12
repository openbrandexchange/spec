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

## Decisions for the Excel import (import-format.md §5, unreleased)

28. **A node feature, specified exactly.** Optional, but the conversion is fixed (sheet choice, cell values, row numbers, limits, error codes) so node-go, node-ts and node-php give the same rows and errors; after the conversion it is a CSV import and nothing else changes.
29. **The file name decides** (`.xlsx`, or the xlsx content type of a part without a name), never the first bytes: a CSV renamed to `.xlsx` is refused (`workbook_invalid`) rather than silently read as CSV.
30. **Sheet**: the visible sheet named `Products`/`Assets`, else the first visible sheet with the key column in row 1. Hidden sheets are never read, so the template's hidden `Lists` and an old hidden copy cannot be imported by accident.
31. **Rows are imported as they are**: the template's yellow example rows, hidden rows and hidden columns are ordinary data (as Excel's "Save as CSV" does); formatting is ignored. The Read me tells brands to delete the examples.
32. **Stored values only**: no formula is calculated (no engine in three runtimes could agree), so a formula without a cached value is a row error, not a guess. Numbers are written from the stored decimal text, rounded to Excel's 15 digits, without exponent, so GTINs typed as numbers keep every digit; number formats are ignored except dates and all-zero formats (barcodes with a leading zero).
33. **Excel row numbers** in errors (header = row 1), with a `row 12, column ean (C): ` locator, because the brand looks at the sheet, not at a CSV. Empty rows inside the data keep their place so the numbers stay Excel's.
34. **Fixed limits** (1 000 zip entries, 256 MiB inflated, 100× ratio above 10 MiB, 100 000 data rows, 1 000 columns) rather than node settings, so a zip bomb and a large sheet get the same answer everywhere. Macros, ActiveX, external links, data connections and `DOCTYPE`s are refused, not ignored: the node never runs or fetches them, and a brand learns that the file is not what it thinks.
35. **Four new error codes** (`workbook_invalid`, `workbook_unsafe`, `workbook_sheet_missing`, `workbook_too_large`) instead of overloading `import_invalid`, so a UI can tell the brand what to do (save as .xlsx without macros, rename the sheet, split the file). Adding error codes is a minor change ([versioning](docs/versioning.md)).
36. **A refused workbook fails the import run**, as an unreadable `products.csv` does: `status` `failed`, `error` the Problem with the workbook code, nothing of the import written, and one ImportRowError (row and column `null`) in the results so a UI and I-IMP-10 read it where they read every other import problem. Going on with the rest of the import (images, `assets.csv`) without the products file would publish half of what the brand meant to send.
37. **Order of the safety checks**: unsafe entry names before `[Content_Types].xml` is read, so a macro workbook is called a macro workbook even when its content types are broken; a part read twice counts once toward the inflated total.
38. **Excel's own bounds**: a number outside 1E-308 to below 1E+308 is `workbook_invalid` (Excel cannot store it, so the file is not what Excel writes), and a date after 9999-12-31 is a conversion error of that cell (the number is fine; the brand chose a date format for it). Both are cheap to check from the decimal text, so no node needs a big-number library.
39. **Columns without a header**: an empty header cell is no column, in a CSV (no warning) and in a workbook; a workbook warns once per such column that holds values (as for values right of the header), because those values are lost. The locator of a cell in such a column is `row <n>, column <letter>: `. CDATA is text (other programs than Excel write it).
40. **One header normalisation**: §1.1 trims white space (space, tab, CR, LF) and counts each run of white space and `-` as one `_`, for CSV headers and for the sheet choice alike, so `Style  Number` and a header cell with a line break work in both.
41. **Folders**: the "only `*.csv`" fallback is for folders without `products.csv` and `products.xlsx`; it never picks a workbook, and a folder with `products.xlsx` and another CSV reads the workbook.
42. **`payload_too_large`** for a workbook above the node's CSV limit is refused like any workbook error (failed run, one ImportRowError), when the upload itself was accepted.

## Decisions for v0.3.0 (terms with names, proposal 0004)

43. **Materials and care are terms**: `part`, `material` and `qualifier` are `{code, name}`; care entries carry `category`, `symbol` and `name`. Breaking, allowed before 1.0; only 0.3 is supported; the 0.1 and 0.2 schemas stay frozen in `schemas/v0.1/` and `schemas/v0.2/` so their `$id`s keep resolving.
44. **The vocabulary is data in the spec** (`vocabularies/*.json`, en/nl/de/fr). A node returns the vocabulary's names for known codes and what it was given for others; a missing language is omitted, never `""`.
45. **One qualifier per fibre** (`organic`, `recycled`, `regenerative`, open list); the 0.2 flags are gone. The 0.1 keys `recycled_*`/`organic_*` are still normalised on write.
46. **`symbol` is GINETEX notation** (`1_C_40`), informative, `null` where the data pools have no code.
47. Proposal 0003 (home and sport) moves to 0.4.
48. **A node that upgrades to 0.3 expires every cursor it issued before** (`410 cursor_expired`, protocol.md §6): a consumer that kept a 0.2 cursor would otherwise keep 0.2 shapes for unchanged objects. The existing restart-without-cursor path is the migration; consumers need no new code.
