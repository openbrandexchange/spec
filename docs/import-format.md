# Canonical import format 0.1 (draft)

**Status:** normative. Every node (upload in the admin UI, scheduled pull imports, `POST /obx/v1/ingest/imports`) and the `obx` CLI MUST support this format with exactly these rules, so a brand's export works everywhere. Example: [`fixtures/kestrel/`](../fixtures/kestrel).

A brand needs at most three things:

1. `products.csv`: one row per variant (colour + size), product data repeated on each row;
2. images named `{style}_{color}_{position}.jpg`;
3. optionally `assets.csv` to add rights, AI provenance or alt text to specific images.

## 1. products.csv

### 1.1 File rules
- UTF-8, with or without BOM. RFC 4180 quoting (`"…"`, `""` for a quote inside). Line endings CRLF or LF.
- Delimiter: `,` or `;`, detected from the header row (whichever occurs more often outside quotes; tie → `,`). Nodes MAY also accept tab.
- First row is the header. Header names are matched case-insensitively after trimming; spaces and `-` count as `_` (`Style Number` = `style_number`). Unknown columns are ignored with one warning per column.
- Empty cells mean "no value". Leading/trailing whitespace in cells is trimmed.
- Rows that are completely empty are skipped. Row numbers in errors are 1-based data rows; problems with the header row or the file as a whole have `row: null`.

### 1.2 Columns

Product columns (the same values repeated on every row of the product; a different non-empty value on a later row is a warning and the first value wins):

| Column | Required | Maps to | Notes |
|---|---|---|---|
| `brand` | when the node has more than one brand | `brand_external_id` | brand name or external id; matched case-insensitively against both; unknown → a new brand is created with that name and the slug as external id |
| `product_id` | no | product external id | default: `style_number` |
| `style_number` | **yes** | `style_number` | alias `style` |
| `name`, `name:<lang>` | **yes** (at least one) | `name` | plain `name` = the import's default language |
| `description`, `description:<lang>` | no | `description` | |
| `item_type` | no | `item_type` | [recommended keys](protocol.md#item-types); lowercased, spaces → `_` |
| `target_group` | no | `target_group` | `women`, `men`, `unisex`, `girls`, `boys`, `kids`, `baby` recommended |
| `season` | no | `season` | free text, e.g. `SS26`, `AW26`, `NOS` |
| `collection` | no | `collection` | |
| `gpc_brick` | no | `gpc_brick` | 8 digits |
| `materials` | no | `materials` | grammar in 1.4 |
| `care` | no | `care` | care codes separated by `\|` (section 1.5) |
| `country_of_origin` | no | `country_of_origin` | ISO 3166-1 alpha-2 |
| `dpp_url` | no | `dpp_url` | |
| `status` | no | product `status` | `published` / `unpublished`; empty = keep (default for new) |
| `attr:<key>` | no | `attributes.<key>` | key `^[a-z][a-z0-9_]{0,63}$`; value as string |

Variant columns:

| Column | Required | Maps to | Notes |
|---|---|---|---|
| `variant_id` | no | variant external id | default: `gtin` as written; without GTIN `<style_number>-<color_code>-<size>` |
| `gtin` | recommended | `gtin` | aliases `ean`, `barcode`. Digits only after removing spaces; 8/12/13/14 digits with a valid check digit. Excel-mangled values (`2.00010010102E+12`) are an error, not a guess. |
| `sku` | no | `sku` | |
| `color_code` | yes, when any variant column is filled | `color.code` | alias `colour_code` |
| `color_name`, `color_name:<lang>` | no | `color.name` | alias `colour_name` |
| `supplier_color` | no | `color.supplier_color` | |
| `size` | no | `size` | e.g. `M`, `42`, `32/34`, `ONE SIZE` |
| `size_system` | no | `size_system` | `EU`, `UK`, `US`, `INT`, … |
| `variant_status` | no | variant `status` | as `status` |

A row without any variant column (no `gtin`, `variant_id`, `sku`, `color_code`, `size`) only creates/updates the product.

Exports (portal "CSV" download) use the same columns in the order of the tables above, with `name:<lang>`, `description:<lang>` and `color_name:<lang>` for every content language instead of the plain columns, plus a final `image_files` column (file names of the visible images of that variant's colour, separated by `|`). An exported CSV can be imported again.

### 1.3 Languages
`name:nl`, `name:en`, … set that language. The plain column sets the **import default language**: `options.default_language`, else the node's first content language. Both plain and `:<default>` present → the tagged column wins.

### 1.4 <a id="materials"></a>Materials grammar
```
materials := part (";" part)*
part      := [part_name ":"] fiber ("," fiber)*        part_name defaults to "main"
fiber     := number "%" fiber_key                      e.g. "95% cotton"
```
Examples: `100% organic_cotton` · `outer: 65% cotton, 35% polyamide; lining: 100% polyester`. Fibre keys are lowercase with `_`; a node lowercases and replaces spaces with `_` (`Organic Cotton` → `organic_cotton`). Percentages of a part SHOULD sum to 100 (otherwise a warning).

<a id="fibres"></a>**Recommended fibre keys:** `cotton`, `organic_cotton`, `recycled_cotton`, `linen`, `hemp`, `silk`, `wool`, `merino_wool`, `lambswool`, `cashmere`, `alpaca`, `mohair`, `viscose`, `lyocell`, `modal`, `cupro`, `acetate`, `polyester`, `recycled_polyester`, `polyamide`, `recycled_polyamide`, `elastane`, `acrylic`, `polypropylene`, `polyurethane`, `leather`, `suede`, `down`, `feather`, `rubber`, `metal`, `other`.

**Recommended part keys:** `main`, `outer`, `lining`, `filling`, `trim`, `sole`, `upper`, `insole`.

### 1.5 <a id="care-codes"></a>Care codes
Codes separated by `|`, in label order. Aligned with ISO 3758 (GINETEX symbols). Unknown codes matching `^[a-z][a-z0-9_]{0,63}$` are kept (with a warning); others are errors.

| Group | Codes |
|---|---|
| Washing | `wash_95`, `wash_70`, `wash_60`, `wash_60_mild`, `wash_50`, `wash_50_mild`, `wash_40`, `wash_40_mild`, `wash_40_very_mild`, `wash_30`, `wash_30_mild`, `wash_30_very_mild`, `hand_wash`, `do_not_wash` |
| Bleaching | `bleach_any`, `bleach_oxygen_only`, `do_not_bleach` |
| Tumble drying | `tumble_dry_normal`, `tumble_dry_low`, `do_not_tumble_dry` |
| Natural drying | `line_dry`, `drip_line_dry`, `dry_flat`, `drip_dry_flat`, `line_dry_shade`, `drip_line_dry_shade`, `dry_flat_shade`, `drip_dry_flat_shade` |
| Ironing | `iron_high`, `iron_medium`, `iron_low`, `do_not_iron` |
| Professional care | `dry_clean_p`, `dry_clean_p_mild`, `dry_clean_p_very_mild`, `dry_clean_f`, `dry_clean_f_mild`, `dry_clean_f_very_mild`, `do_not_dry_clean`, `wet_clean_w`, `wet_clean_w_mild`, `wet_clean_w_very_mild`, `do_not_wet_clean` |

## 2. Image files

### 2.1 Filename pattern
```
{style}_{color}_{position}[_{qualifier}…].{ext}
```
- `ext`: `jpg`, `jpeg`, `png`, `webp`, `tif`, `tiff` (case-insensitive).
- Parse from the **right**: strip the extension and split the rest on `_`. Then repeat: if more than four parts remain and the last **two** parts joined with `_` are a role or view key (`size_chart`, `tilted_left`, `tilted_right`), pop both as one qualifier; otherwise, if more than three parts remain and the last part is a role or view key, pop it; otherwise stop. The last part must then be the position (`1`–`999`, no leading zero), the one before it the colour code, and everything before that (joined with `_`) the style number. So style numbers may contain `_`; colour codes may not.
- Qualifiers (optional, any order): a **role** (`packshot`, `model`, `detail`, `ghost`, `flatlay`, `scene`, `swatch`, `size_chart`, `other`) and/or a **view** (`front`, `back`, `side`, `left`, `right`, `top`, `bottom`, `tilted_left`, `tilted_right`, `inside`, `detail`, `other`). Qualifiers are applied in the order they are popped (right to left), and each only fills what is still empty: `detail` sets the role and the view to `detail`; `other` is the view when the name also has another role qualifier (`KO-1001_NVY_6_model_other.jpg`), otherwise the role; any other key sets the role or the view it belongs to. A second role or view further left is therefore ignored (the rightmost one wins). Without a role qualifier the role is `packshot`; without a view qualifier the view is `null`.
- Matching the style number and colour code against the catalog is case-insensitive; the asset takes the catalog's spelling.
- <a id="all-colours"></a>**Images without a colour.** The colour part `ALL` (any case) means the image belongs to every colour of the product (`color_code: null`), for example a size chart or a detail shared by all colours: `KO-1005_ALL_4_size_chart.png`. `ALL` is therefore reserved: a product colour whose code is `ALL` cannot be addressed by file name (use `assets.csv` with an explicit `color_code`), and brands SHOULD NOT use it as a colour code.
- The asset's external id is `{style_number}_{color_code}_{position}` (catalog spelling, no qualifiers, no extension; `{style_number}_ALL_{position}` for an image without a colour), so re-sending a file with the same style, colour and position **replaces** that image, and renaming `_front` to `_back` only changes the view. The original file name becomes the asset `filename`.

| File | style | colour | position | role | view |
|---|---|---|---|---|---|
| `KO-1001_NVY_1.jpg` | KO-1001 | NVY | 1 | packshot | null |
| `KO-1001_NVY_2_back.jpg` | KO-1001 | NVY | 2 | packshot | back |
| `KO-1003_RST_3_model.png` | KO-1003 | RST | 3 | model | null |
| `AB_12_34_BLK_2_packshot_back.JPG` | AB_12_34 | BLK | 2 | packshot | back |
| `KO-1004_IND_3_detail.jpg` | KO-1004 | IND | 3 | detail | detail |
| `KO-1002_BLK_4_model_tilted_left.jpg` | KO-1002 | BLK | 4 | model | tilted_left |
| `KO-1001_NVY_5_back_front.jpg` | KO-1001 | NVY | 5 | packshot | front (rightmost wins) |
| `KO-1005_all_4_size_chart.png` | KO-1005 | `null` (all colours; external id `KO-1005_ALL_4`) | 4 | size_chart | null |
| `KO-1001_NVY_front.jpg` | — | — | — | error `validation_failed`: no position | |

Images whose style/colour is not in the catalog (this import or already on the node) are errors `unknown_parent` (`ALL` always matches). Images that match neither the pattern nor an `assets.csv` row are errors (`validation_failed`). Two files resolving to the same external id in one import are an error for both.

### 2.2 assets.csv (optional)
Same file rules as `products.csv`. One row per image file; empty cells keep the value from the filename or the defaults.

| Column | Notes |
|---|---|
| `file` | **required**; image file name (basename) in this import or in `images_manifest` |
| `asset_id` | external id override |
| `product_id` / `style_number`, `color_code`, `position` | needed only when the file name does not follow the pattern; `color_code` empty = all colours (and `ALL` here is an ordinary colour code) |
| `role`, `view` | override the qualifiers |
| `alt_text`, `alt_text:<lang>` | |
| `license`, `license_text`, `channels` (`\|`-separated), `territories` (`\|`-separated), `embargo_until`, `expires_at`, `credit`, `model_release` | rights; empty = node default |
| `ai_generated`, `ai_edited`, `source`, `c2pa`, `c2pa_manifest_url`, `generator` | provenance |
| `status` | `published` / `unpublished` |

Booleans accept `true/false`, `yes/no`, `ja/nee`, `1/0` (case-insensitive). Dates are RFC 3339 or `YYYY-MM-DD` (= midnight UTC).

A row in `assets.csv` whose `file` is not provided is an error `files_missing`.

## 3. Package (zip) layout

```
products.csv          optional when only images are imported
assets.csv            optional
<any folders>/<images> file names matter, folders do not
```
- Nodes MUST reject entries with absolute paths, `..` segments, symlinks or drive letters (`import_invalid`, zip-slip protection), MUST ignore `__MACOSX/`, `.DS_Store`, `Thumbs.db` and names starting with `.`, and MUST cap the total uncompressed size (RECOMMENDED 10× the node's upload limit) and the number of entries (RECOMMENDED 100 000) to defuse zip bombs.
- Nested zips are not opened.

Scheduled pull imports (SFTP folder, S3 prefix) treat the folder like an unpacked package: `products.csv` (or the only `*.csv` when there is exactly one), optional `assets.csv`, and every image file in the folder and its subfolders. An HTTPS URL points at a CSV or a package zip.

## 4. Processing rules

1. Parse `products.csv`, then `assets.csv`, then images. Apply per product in file order: product, its variants, then its assets. Within one product and colour, asset positions from one import are applied atomically (swapping two positions in one import is fine).
2. Each row and each image is independent: an error skips that row or file only, with an [ImportRowError](../schemas/ImportRowError.json) (`file`, `row`, `column`, `severity`, `obx_error`, `detail`, `value`).
3. Writes have ingest semantics ([ingest.md](ingest.md)): idempotent upserts, `unchanged` produces no change entry, the same `/changes` rules.
4. `mode: upsert` (default) only touches what is in the import. `mode: mirror` also unpublishes products of the brands present in the file that the file does not contain; refused (`mass_unpublish_refused`) when that would be more than half of them, unless `allow_mass_unpublish`.
5. `dry_run` validates and reports counts and errors without writing.
6. Images are deduplicated by sha256: an unchanged image costs no upload (CLI/UI send a manifest) and no change entry.
7. **Counts** (`ImportRun.counts`) count the objects the import wrote or compared: products, variants and assets from the files, and brands the import created. A brand the import only refers to (it already exists) is counted neither as `created` nor as `unchanged`, so a second import of the same file reports one object fewer as `unchanged` than the first reported as `created` when that first import created the brand.
