# Node Admin API

**Non-normative.** The Node Admin + Portal API ([`openapi/node-admin.yaml`](../openapi/node-admin.yaml)) is the contract between the shared [admin-ui](https://github.com/openbrandexchange/admin-ui) and the reference nodes. It is not part of the OBX standard and is versioned with the nodes and the UI ([versioning](versioning.md)). The OpenAPI file is complete; this page explains the parts that need more than a field list.

## Collection release

[Proposal 0006](proposals/0006-collection-release.md) (draft). `GET /admin/api/catalog/collections` lists every collection record, held or released; `PUT`/`PATCH`/`DELETE /admin/api/catalog/collections/{external_id}` behave exactly like the Ingest API (same results, same change entries). The release toggle of the admin UI is a `PATCH` of `state` (`held`, `released`) or `release_at` (only on a node with `collections.scheduled_release`). The admin sets membership per colour by the record's external id. `portal.hold_new_collections` (default `false`) makes a product or variant write that names a new `collection_external_id` create its record as `held`.

## Portal appearance

A brand can make its portal look like its own showroom without code: colours, fonts, a login page with its own image and a start page built from blocks. Everything lives in `branding` of `GET`/`PATCH /admin/api/settings` (schema `BrandingSettings`), a JSON merge patch like the other settings. The admin UI previews from the settings it is editing; there is no preview endpoint. The protocol (`/obx/v1`) does not change.

Rules for every node:

- **Optional and nullable.** Every member may be absent or `null`; that means the node default, the look before 0.3.1. Old clients keep working.
- **Forward compatible.** Unknown members inside `theme`, `login`, `home` and in any block, and blocks of an unknown `type`, MUST be stored and returned unchanged. The UI ignores them. Known members are validated (enumerations, colour pattern, lengths); an invalid value is `422 validation_failed` with a JSON pointer.
- **Texts** shown to retailers are per language (`{"en": "…", "nl": "…"}`, BCP 47 keys as in LocalizedText), at most 2,000 characters per language; a text block's `body` at most 10,000. Plain text only: the UI never renders HTML or Markdown from them, and a blank line in `body` starts a paragraph. The UI shows the reader's language, else the brand's default language, else any.
- **Size.** The whole `branding` object, serialised, MUST be at most 64 KiB.
- **Image ids** MUST exist on the node (else `422` with a pointer).
- **Arrays.** Merge patch replaces arrays, so a client sends `home.blocks` as a whole.
- `accent_color` is still honoured; `theme.colors.primary` wins when set.

The fixture [`fixtures/examples/BrandingSettings.full.json`](../fixtures/examples/BrandingSettings.full.json) is a complete example (the MAISON NOOR showroom, in English, Dutch and German); `bun run check` validates it. Each node SHOULD test a round trip of it.

### Theme

| Member | Values |
|---|---|
| `color_scheme` | `light`, `dark`, `auto` (follows the reader's system) |
| `colors.primary`, `secondary`, `background`, `surface`, `text` | `#rrggbb` |
| `heading_font`, `body_font` | see below |
| `radius` | `none`, `small`, `medium`, `large` |
| `grid_density` | `compact`, `comfortable`, `editorial` |
| `card_style` | `plain`, `bordered`, `elevated` |
| `image_fit` | `contain`, `cover` |
| `image_background` | `#rrggbb`, behind product images |

**Fonts.** `system`, `inter`, `dm-sans`, `manrope`, `work-sans`, `jost`, `space-grotesk`, `fraunces`, `playfair-display`, `libre-baskerville`, `cormorant-garamond`. All are SIL Open Font License fonts that the admin UI bundles and serves itself, so the portal's Content-Security-Policy stays `font-src 'self'` and no reader's address goes to a font host. `system` is the platform's UI font. A brand cannot upload fonts.

### Login page

`login.layout` is `centered` or `split` (the image fills the start side, left in left-to-right languages, the form the other; on narrow screens the image becomes a band above the form). `login.background_image` is an image id, `login.title` and `login.text` are texts. `GET /admin/api/public/branding` returns `favicon_url`, `theme` and `login` with `background_image_url` resolved. The start page is not public.

### Start page blocks

`home.blocks` holds at most 30 blocks, shown top to bottom. Without blocks the catalogue is the start page, as before. Every block has `id` (chosen by the client, at most 40 characters, unique within the page) and `type`; every other member is optional and the UI leaves out what is empty.

| `type` | Members |
|---|---|
| `hero` | `image`, `title`, `text`, `button_label`, `link`, `align` (`left`, `center`), `height` (`medium`, `large`), `overlay` (`none`, `dark`, `light`) |
| `tiles` | `title`, `columns` (2, 3, 4), `items` (1 to 12 of `image`, `title`, `link`) |
| `text` | `title`, `body` |
| `image_text` | `image`, `title`, `text`, `button_label`, `link`, `image_side` (`left`, `right`) |
| `products` | `title`, `style_numbers` (at most 24) or `query`, `max` (1 to 24, default 8) |
| `announcement` | `text`, `tone` (`neutral`, `info`, `success`) |
| `contact` | `title`, `name`, `email`, `phone` (plain strings: the brand's account manager) |

A `products` block shows the listed style numbers in that order (ones the reader cannot see are left out), else the result of `query`, else the most recently updated products; `style_numbers` wins when both are set. `query` is the query string of `GET /admin/api/portal/products` without `?`, for example `season=AW26` or `qualifier=organic`. The UI loads the products with the normal portal endpoints, so a retailer only ever sees what it may see.

`GET /admin/api/portal/viewer` returns `branding.home` with every image resolved: blocks and tiles keep `image` (the id) and get `image_url`.

### Links

`link` is either a portal path that starts with a single `/` (`/catalog?item_type=sweater`, `/products/MN-1001`) or an `https://` URL. Nothing else is valid: no `http:`, `javascript:`, `data:` or `mailto:`, no `//host` and no `/\host`. The UI opens portal paths inside the portal and `https://` URLs in a new tab with `rel="noopener noreferrer"`.

### Images

| Endpoint | What |
|---|---|
| `POST /admin/api/settings/images` | upload, multipart field `file`: PNG, JPEG or WebP, at most 10 MB and 8,000 px per side. `201` with `id`, `url`, `width`, `height`, `bytes`, `content_type` |
| `GET /admin/api/settings/images` | all images (not paginated), each with `used` (referenced from `login` or `home`) |
| `DELETE /admin/api/settings/images/{id}` | `204`; `409 conflict` while the image is used |
| `GET /admin/api/public/images/{id}` | the image, without login (it appears on the login page); `404` when unknown |
| `PUT` / `DELETE /admin/api/settings/favicon` | the favicon: PNG or WebP, square, at most 1 MB; sets `branding.favicon_url` |

Uploads and deletes are brand-admin writes with the CSRF header like every other write. A node checks the file's content, not just its declared type (`415` otherwise, `413` when too large, `422` when a side exceeds 8,000 px), stores the original and serves it unchanged; it MAY serve a resized variant of at most 2,560 px. A node holds at most 200 branding images; beyond that an upload is `409 limit_exceeded`. Ids are never reused, so the public image is served with `Cache-Control: public, max-age=31536000, immutable` (in demo mode `private, max-age=300`, like other demo files) and `X-Content-Type-Options: nosniff`. Replacing an image means uploading a new one and pointing the settings at the new id.
