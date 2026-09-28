# Notes for implementers

Decisions taken while writing v0.1.0-draft where the plan was silent or ambiguous. Each is the simplest reading; challenge them with a pull request.

## Interpretation decisions

1. **Change types include `brand`.** The brief listed `product|variant|asset|grant`; brand unpublishing needs a tombstone too, and clients must ignore unknown types anyway.
2. **`/changes` entries embed the current object** (`data` on upserts) so a consumer syncs in one pass. Upsert entries of objects that are not visible at read time are omitted (a delete entry always follows a visible → invisible transition).
3. **Grant changes trigger a resync** (`grant` entry with `resync: true`) instead of per-retailer synthetic upserts/deletes. Consumers restart without a cursor and mark-and-sweep after the snapshot (first `phase: live` page).
4. **Product responses embed variants and assets** (`ProductDetail`); feed entries do not (separate entries).
5. **A product is visible without images.** The Photopilot portal requires at least one final image per article; OBX publishes article data (GTIN, materials) even before photos exist.
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
- E-mails (as built in node-go; the other nodes should match): texts are the `email.*` groups in the vendored admin-ui `dist/locales/<lang>.json` (`invite`, `accessRequestReceived`, `accessRequestNew`, `accessApproved`, `accessRejected`, `zipReady`, `passwordReset`), in the recipient's language with `en` fallback. Plain text in this order: `greeting` (or `greetingNoName`), `body`, `reason`, `apiNote` (only when an API key was created), `button` + `:` + newline + link, `expiry`, `ignore`, `contact`, `signoff`, then `-- ` and `footer`. A line with an unfilled `{{placeholder}}` is left out. `{{portal}}` is "<brand> · <word>", the word being the brand's `portal_name` for that language or `glossary.portal`; `{{expires}}` is written `YYYY-MM-DD`. Links: invite `/invite/{token}`, reset `/reset-password/{token}`, admin review `/admin/requests`, approved `/login`, zip `/downloads`.
- `branding.portal_name` (Settings and PublicBranding, not yet in node-admin.yaml): optional LocalizedText that replaces the portal word.

## Open questions

- Final name after trademark search (governance).
- Whether `print` belongs in the default channels.
- Video/3D asset types (reserved: `media_type` values beyond `image`).
- Per-collection grants (v0.1 grants are per brand).
