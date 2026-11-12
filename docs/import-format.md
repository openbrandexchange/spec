# Canonical import format 0.2

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
| `item_subtype` | no | `item_subtype` | [recommended keys](protocol.md#item-subtypes), e.g. `cabin`; lowercased, spaces → `_` |
| `target_group` | no | `target_group` | `women`, `men`, `unisex`, `girls`, `boys`, `kids`, `baby` recommended |
| `season` | no | `season` | free text, e.g. `SS26`, `AW26`, `NOS` |
| `collection` | no | `collection` | |
| `gpc_brick` | no | `gpc_brick` | 8 digits |
| `materials` | no | `materials` | grammar in 1.4, e.g. `outer: 100% polyester (recycled); lining: 88% polyamide, 12% elastane` |
| `contains_animal_origin` | no | `contains_animal_origin` | `yes` / `no` (booleans as in 2.2); empty = not stated (`null`) |
| `footwear_materials` | no | `footwear_materials` | `upper: leather; lining_and_sock: textile; outer_sole: other` (1.6) |
| `care` | no | `care` | care codes separated by `\|` (section 1.5) |
| `country_of_origin` | no | `country_of_origin` | ISO 3166-1 alpha-2 |
| `certifications` | no | `certifications` | `gots:CU 123456; oeko_tex_standard_100:21.HUS.12345` (1.6) |
| `dpp_url` | no | `dpp_url` | |
| `status` | no | product `status` | `published` / `unpublished`; empty = keep (default for new) |
| `feature:<key>` | no | `features.<key>` | one column per feature, e.g. `feature:wheels` = `4`, `feature:detachable_parts` = `shoulder_strap\|lining` (1.6) |
| `attr:<key>` | no | `attributes.<key>` | key `^[a-z][a-z0-9_]{0,63}$`; value as string |

Variant columns:

| Column | Required | Maps to | Notes |
|---|---|---|---|
| `variant_id` | no | variant external id | default: `gtin` as written; without GTIN `<style_number>-<color_code>-<size>` |
| `gtin` | recommended | `gtin` | aliases `ean`, `barcode`. Digits only after removing spaces; 8/12/13/14 digits with a valid check digit. Excel-mangled values (`2.00010010102E+12`) are an error, not a guess. |
| `sku` | no | `sku` | |
| `color_code` | yes, when any variant column is filled | `color.code` | alias `colour_code` |
| `color_name`, `color_name:<lang>` | no | `color.name` | alias `colour_name` |
| `color_family` | no | `color.family` | alias `colour_family`; one of the [families](protocol.md#595-colour-family-and-second-size), lowercased (`gray` = `grey`, `multicolor` = `multicolour`); the same on every row of one colour (a different value is a warning) |
| `supplier_color` | no | `color.supplier_color` | |
| `size` | no | `size` | e.g. `M`, `42`, `32/34`, `ONE SIZE` |
| `size_length` | no | `size_length` | the second size, e.g. `34` for jeans `32/34` (then `size` is `32`) |
| `size_system` | no | `size_system` | `EU`, `UK`, `US`, `INT`, … |
| `height_cm`, `width_cm`, `depth_cm`, `weight_kg`, `volume_l`, `volume_expanded_l` | no | `measurements.<column>` | numbers, e.g. `55`, `40`, `20`, `2.6`, `38`, `44` (1.6); [how to measure](protocol.md#measurements) |
| `handle_drop_cm`, `strap_length_cm`, `laptop_max_inch`, `heel_height_cm`, `shaft_height_cm`, `inseam_cm` | no | `measurements.<column>` | numbers, e.g. `22`, `15.6`; `strap_length_cm` is `min-max`, e.g. `80-130` (1.6) |
| `variant_status` | no | variant `status` | as `status` |

A row without any variant column (no `gtin`, `variant_id`, `sku`, `color_code`, `size`) only creates/updates the product; values in its `color_family`, `size_length` and measurement cells are ignored with a warning.

Exports (portal "CSV" download) use the same columns in the order of the tables above, with `name:<lang>`, `description:<lang>` and `color_name:<lang>` for every content language instead of the plain columns, a `feature:<key>` column for every key of the [feature registry](protocol.md#features) and for every other feature key the exported products have (after the registry keys, sorted), plus a final `image_files` column (file names of the visible images of that variant's colour, separated by `|`). An exported CSV can be imported again.

### 1.3 Languages
`name:nl`, `name:en`, … set that language. The plain column sets the **import default language**: `options.default_language`, else the node's first content language. Both plain and `:<default>` present → the tagged column wins.

### 1.4 <a id="materials"></a>Materials grammar
```
materials := part (";" part)*
part      := [part_name ":"] fiber ("," fiber)*        part_name defaults to "main"
fiber     := number "%" fiber_key flag*                e.g. "95% cotton", "100% polyester (recycled)"
flag      := "(recycled)" | "(organic)"
```
Examples: `100% cotton (organic)` · `outer: 65% cotton, 35% polyamide; lining: 100% polyester (recycled)`. Fibre keys are lowercase with `_`; a node lowercases and replaces spaces with `_` (`Merino Wool` → `merino_wool`). A flag sets `recycled: true` or `organic: true` on that fibre ([protocol.md §5.9.1](protocol.md#composition)). Percentages of a part SHOULD sum to 100; for textile item types a part that does not gives the warning `fibre_percentages_not_100` ([rule 10](#label-completeness)).

**0.1 fibre keys.** A key `recycled_<fibre>` or `organic_<fibre>` (the 0.1 keys `recycled_cotton`, `recycled_polyester`, `recycled_polyamide`, `organic_cotton`) is normalised to the fibre with the flag: `100% recycled_polyester` = `100% polyester (recycled)`, `100% organic_cotton` = `100% cotton (organic)`. Files written for 0.1 therefore keep working, and give the same result as files with flags.

<a id="fibres"></a>**Recommended fibre keys** (the English names of Annex I of Regulation (EU) No 1007/2011 where one exists): `cotton`, `linen`, `hemp`, `silk`, `wool`, `merino_wool`, `lambswool`, `cashmere`, `alpaca`, `mohair`, `viscose`, `lyocell`, `modal`, `cupro`, `acetate`, `polyester`, `polyamide`, `elastane`, `acrylic`, `polypropylene`, `polyurethane`, and the non-textile materials `leather`, `suede`, `down`, `feather`, `rubber`, `metal`, `other`.

**Recommended part keys:** `main`, `outer`, `lining`, `filling`, `padding`, `trim`, `pocket_lining`, `shell` (luggage), `handle`, `strap`, and for footwear `upper`, `sole`, `insole`.

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

### 1.6 <a id="article-data"></a>Article data columns

The fields are described in [protocol.md §5.9](protocol.md#59-article-data). A cell that does not follow these rules is an error `validation_failed` for that row, with the column in the error.

- **`footwear_materials`**: `part: value` pairs separated by `;`, parts `upper`, `lining_and_sock`, `outer_sole`, values `leather`, `coated_leather`, `textile`, `other` (lowercased, spaces → `_`). A part that is not in the cell is `null`.
- **`certifications`**: entries separated by `;`, each `scheme:licence_number`, optionally followed by `(material)` or `(product)`: `rws:CU 123456 (material)`. The scheme is lowercased (spaces → `_`); the licence number is everything after the first `:`, trimmed, and may contain spaces; without `:` the licence number is `null`. The scope is `product` unless `(material)` is given. Entries keep their order.
- **Measurement columns**: a positive number with `.` or `,` as the decimal separator, no thousands separator and no unit (`2.6`, `2,6`; not `2.6 kg`). `strap_length_cm` is `min-max` (`80-130`) or one number for a strap that cannot be adjusted (`120` = `{"min": 120, "max": 120}`); `min` larger than `max` is `validation_failed`. The empty cells of a row are not stated; a row with no measurement at all gives `measurements: null`.
- **`feature:<key>`**: the value per the [registry](protocol.md#features) type. Enums are lowercased (spaces → `_`); integers are digits; booleans as in 2.2 (`yes`/`no`, …); lists separated by `|` (`shoulder_strap|lining`), duplicates dropped. A value outside the registry is an error. A key that is not in the registry is stored as the string in the cell, with one warning per column. A product with no feature cells has `features: null`.
- **`contains_animal_origin`**: a boolean as in 2.2; empty = `null`.

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
| `KO-1001_NVY_6_model_other.jpg` | KO-1001 | NVY | 6 | model | other |
| `KO-1001_NVY_7_other.jpg` | KO-1001 | NVY | 7 | other | null |
| `KO-1001_NVY_front.jpg` | — | — | — | error `validation_failed`: no position | |

These and more edge cases are test vectors in [`fixtures/expected/image-filenames.json`](../fixtures/expected/image-filenames.json); every implementation should parse each name exactly as listed there.

Images whose style/colour is not in the catalog (this import or already on the node) are errors `unknown_parent` (`ALL` always matches). Images that match neither the pattern nor an `assets.csv` row are errors (`validation_failed`). Two files resolving to the same external id in one import are an error for both.

### 2.2 assets.csv (optional)
Same file rules as `products.csv`. One row per image file; an empty cell (or a column the file does not have) keeps the value from the file name, the value the image already has on the node, or, for a new image, the node default ([rule 8](#4-processing-rules)).

| Column | Notes |
|---|---|
| `file` | **required**; image file name (basename) in this import or in `images_manifest` |
| `asset_id` | external id override |
| `product_id` / `style_number`, `color_code`, `position` | needed only when the file name does not follow the pattern; `color_code` empty = all colours (and `ALL` here is an ordinary colour code) |
| `role`, `view` | override the qualifiers |
| `alt_text`, `alt_text:<lang>` | |
| `license`, `license_text`, `channels` (`\|`-separated), `territories` (`\|`-separated), `embargo_until`, `expires_at`, `credit`, `model_release` | rights; empty = keep (a new image: node default) |
| `ai_generated`, `ai_edited`, `source`, `c2pa`, `c2pa_manifest_url`, `generator` | provenance |
| `status` | `published` / `unpublished` |

Booleans accept `true/false`, `yes/no`, `ja/nee`, `1/0` (case-insensitive). Dates are RFC 3339 or `YYYY-MM-DD` (= midnight UTC).

A row in `assets.csv` whose `file` is not provided is an error `files_missing`.

### 2.3 <a id="assets-csv-in-downloads"></a>assets.csv in portal downloads

Every zip a retailer downloads from a portal (one product, the selection, a background download) holds an `assets.csv` at its top level, one row per image in the zip, so the usage rights, the embargo and the AI provenance travel with the files. Columns, in this order: `file` (the image's file name in the zip, without its folder), `style_number`, `color_code` (empty = all colours), `position`, `role`, `view`, `alt_text:<lang>` (a column for every language the images' alt texts have; more are allowed), `license`, `license_text`, `channels`, `territories` (both `|`-separated; empty territories = worldwide), `embargo_until`, `expires_at`, `credit`, `model_release`, `ai_generated`, `ai_edited`, `source`, `c2pa`, `generator`. The values are the image's effective ones (node defaults applied); booleans are `true`/`false`, dates RFC 3339, the delimiter is `,`, and a cell that starts with `=`, `+`, `-` or `@` gets a leading `'` so spreadsheets do not run it (as `data.csv`). The file follows 2.2, so it can be imported again.

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
8. **An import never takes away what it does not state about an image.** For an image the node already has (same external id), the file, product, colour, position, role and view come from the file name or its `assets.csv` row as usual, but alt text (per language), each rights field, each provenance field and `status` change only where that row has a non-empty cell. Everything else keeps its stored value, whether it came from an earlier import, the admin or the Ingest API; with no row, or no `assets.csv` at all, nothing of it changes. A new image gets the node defaults for what the import does not state. So a nightly import of the images alone never lifts an embargo, removes a credit or clears an AI label. To change one of them, send a cell with the new value (for example a past `embargo_until` to lift an embargo) or change it in the admin or through the Ingest API. The Ingest API's `PUT` keeps its replace semantics ([ingest.md](ingest.md)); this rule is for imports only.
9. **A column the file does not have leaves that field as it is.** For a product or variant the node already has, every field whose column is missing from `products.csv` keeps its stored value. For texts in several languages (`name`, `description`, `color_name`) this holds per language: a language without its column ([1.3](#13-languages)) keeps its text. A column that is there with an empty cell removes the value ("no value", [1.1](#11-file-rules)). So a file with only `style_number` and `name:nl` changes only the Dutch names, and materials or care codes entered in the admin survive a nightly export from a system that does not have them. The same holds per key for `feature:<key>` and for each measurement column: a file without `feature:wheels` keeps the stored number of wheels, a file with an empty `feature:wheels` cell removes it, and a file with only `weight_kg` changes only the weight (when the last feature or measurement is removed, the object becomes `null`). `footwear_materials`, `certifications`, `color_family`, `size_length` and `contains_animal_origin` are one column each and follow the rule as a whole. A new product or variant gets only what the file has. (`brand` and the columns that make the external ids keep their own rules above.)
10. <a id="label-completeness"></a>**Label completeness warnings.** After a product row is applied, the node checks the product as stored (the file's values plus what rule 9 kept) and reports what a consumer label would miss as an [ImportRowError](../schemas/ImportRowError.json) with `severity: warning`, the row of the product's first row, the column named below and one of these stable codes in `obx_error`. Warnings never block the import or publishing; the product is written and published as usual. Each code is reported at most once per product and import (`fibre_percentages_not_100` once per part). *Textile item types* are the [recommended](protocol.md#item-types) apparel keys (`t_shirt` to `socks`, `hat`, `cap`, `scarf`, `gloves`, `tie`), `bag`, `backpack` and `luggage`; *footwear item types* are `shoes`, `sneakers`, `boots`, `sandals`. Other and unknown item types get no label warnings.

| Code | When | Column | Why (legal basis) |
|---|---|---|---|
| `fibre_composition_missing` | a textile item type without `materials` | `materials` | the fibre composition of a textile product is mandatory on the label and before purchase, also online: Reg. (EU) No 1007/2011 Art. 9, 11 and 16(1). For bags and luggage it applies when the product is a textile product (at least 80 % textile fibres by weight, Art. 2(2)) |
| `animal_origin_unknown` | a textile item type with `contains_animal_origin` empty while `materials` has a fibre `leather`, `suede`, `fur`, `down`, `feather`, `wool` (or a kind of wool such as `merino_wool`, `lambswool`, `cashmere`, `alpaca`, `mohair`) or `silk` | `contains_animal_origin` | a textile product with non-textile parts of animal origin must say so on the label: Reg. (EU) No 1007/2011 Art. 12. Wool and silk are textile fibres and do not need the statement themselves; the warning asks the brand to state `yes` or `no` |
| `footwear_materials_missing` | a footwear item type without `footwear_materials`, or with one of its three parts empty | `footwear_materials` | the material of the upper, the lining and sock and the outer sole is mandatory on footwear labels: Directive 94/11/EC |
| `fibre_percentages_not_100` | a part of `materials` whose percentages do not sum to 100 (one per part) | `materials` | the composition is given as percentages of the total fibre weight: Reg. (EU) No 1007/2011 Art. 9 (and Art. 11 per component) |

The import of [`fixtures/kestrel`](../fixtures/kestrel) gives none of these warnings.
