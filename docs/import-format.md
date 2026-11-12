# Canonical import format 0.2

**Status:** normative. Every node (upload in the admin UI, scheduled pull imports, `POST /obx/v1/ingest/imports`) and the `obx` CLI MUST support this format with exactly these rules, so a brand's export works everywhere. Example: [`fixtures/kestrel/`](../fixtures/kestrel). Section 5 (Excel workbooks) is a non-normative node feature: optional, but a node that offers it follows it exactly.

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

The fields are described in [protocol.md §5.9](protocol.md#59-article-data). A cell that does not follow these rules is an error `validation_failed` for that row, with the column in the error; the whole row is skipped (its product and its variant part), as for every row error.

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
- A node that accepts Excel workbooks ([§5](#excel)) also takes `products.xlsx` and `assets.xlsx` in the place of `products.csv` and `assets.csv`; a workbook is opened under the limits of §5.6, it is not a nested zip.

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

## 5. <a id="excel"></a>Excel workbooks (node feature, non-normative)

**Status:** non-normative. A node MAY accept an Excel workbook (`.xlsx`) wherever it accepts `products.csv` or `assets.csv`. A node that does MUST turn it into rows exactly as this section says, so one workbook gives the same rows, the same errors and the same row numbers on every node, and then imports those rows as that CSV file: every rule of §1 to §4 (header names, columns, validation, rules 1 to 10, label warnings, counts, `/changes`, `dry_run`, `mirror`) applies unchanged. The [templates](../templates) can be uploaded as they are. Fixtures: [`fixtures/imports/xlsx/`](../fixtures/imports/xlsx) with `expected.json` (conformance I-IMP-9 and I-IMP-10, optional); a reference conversion in JavaScript: [`tools/xlsx.mjs`](../tools/xlsx.mjs).

### 5.1 Where a workbook is accepted

- A file is a workbook when its name ends in `.xlsx` (any case) or, for a multipart part without a file name, when its content type is `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Nothing else makes it a workbook (not its first bytes), and a workbook is never read as CSV: a CSV renamed to `.xlsx` is `workbook_invalid`. Other spreadsheet files (`.xlsm`, `.xls`, `.xlsb`, `.ods`, `.numbers`) are not workbooks in this sense; an upload of one SHOULD be answered with `unsupported_media_type`.
- What the workbook stands for follows from where it is: the `csv` part of `POST /obx/v1/ingest/imports` or the products upload is `products.csv`, the `assets_csv` part or the assets upload is `assets.csv`. In a package zip and in a pull folder, `products.xlsx` and `assets.xlsx` take the place of `products.csv` and `assets.csv`; a package or folder with both `products.csv` and `products.xlsx` (or both assets files) is `import_invalid`. The "only `*.csv`" fallback of §3 does not extend to workbooks.
- In an [ImportRowError](../schemas/ImportRowError.json), `file` is `products.xlsx` or `assets.xlsx`, whatever the uploaded file was called.

### 5.2 Which sheet

Only **visible worksheets** count: a sheet with `state="hidden"` or `"veryHidden"`, a chart sheet or a dialog sheet is never read. The node reads exactly one sheet:

1. the first visible worksheet, in workbook order, whose name, trimmed, is `Products` (for `products.xlsx`) or `Assets` (for `assets.xlsx`), ignoring ASCII case;
2. otherwise the first visible worksheet whose row 1 has a cell that, converted (§5.4) and normalised as a CSV header name (§1.1), is `style_number` or `style` (products) or `file` (assets);
3. otherwise `workbook_sheet_missing`.

So the templates work as they are: their sheet `Products` (or `Assets`) is read; `Read me`, `Explanation`, `Uitleg` and the hidden `Lists` are not.

### 5.3 From cells to rows

- **Row 1 is the header.** Its width W is the column number of the last cell in row 1 whose converted text is not empty. The header names are the converted texts of row 1, columns 1 to W; an empty cell in between gives an empty name, which §1.1 treats as an unknown column. With W = 0 the result is an empty file (§1.1: no header, `import_invalid`).
- **Data rows** are the rows 2 to R, R being the last row with a non-empty cell in columns 1 to W. Each is a row of exactly W fields (missing cells are empty). An empty row before R stays in its place as an empty row: §1.1 skips it, and row numbers stay Excel's (§5.5). Rows and columns that have only formatting, a data validation (dropdown) or a comment are empty.
- **Cells right of column W** are ignored, with one warning per such column that has a non-empty cell (§5.5).
- **Hidden rows and hidden columns are imported**, as Excel's own "Save as CSV" does. Filters, grouping, row heights, fonts and fill colours are ignored. The yellow example rows of the templates are ordinary rows: the template's Read me tells the brand to delete them, and rows that are left import like any other row.
- **Merged cells**: the value is the value of the top-left cell; every other cell of the merged range is empty, even when the file has a value for it.
- A converted text is not trimmed or otherwise changed here; trimming, header matching and the like are the CSV rules of §1.1.
- **Canonical CSV.** The rows written as `products.csv` / `assets.csv` text (the fixtures do this; a node MAY pass the rows to its CSV import directly): UTF-8 without BOM, delimiter `,`, CRLF after every row including the last, a field in double quotes (a `"` inside doubled) only when it contains `,`, `"`, CR or LF. `templates/products.xlsx` gives [`fixtures/kestrel/products.csv`](../fixtures/kestrel/products.csv) byte for byte.

### 5.4 Cell values

A node uses only the value stored in the file. It never calculates a formula, never runs a macro, never fetches anything, and applies a number format only in the two cases below (dates and zero padding). The cell's `t` attribute decides:

| `t` | Text |
|---|---|
| `s` (shared string) | the `<si>` entry: its `<t>`, or the `<t>` of its runs `<r>` joined (rich text loses its formatting); phonetic runs `<rPh>` are ignored. A missing index is `workbook_invalid` |
| `inlineStr` | the same for `<is>` |
| `str` (text result of a formula) | the text of `<v>` |
| `b` | `1` → `true`, `0` → `false` (§2.2 accepts both; Excel writes `TRUE`/`FALSE`) |
| `e` (`#N/A`, `#REF!`, `#DIV/0!`, …) | a conversion error (§5.5) with the error text as `value` |
| `d` (ISO 8601 date) | `YYYY-MM-DD` when there is no time or the time is `00:00:00`, else `YYYY-MM-DDTHH:MM:SSZ` (fraction of a second dropped); anything else is a conversion error |
| `n` or no `t` | a number, below; no `<v>` (or an empty one) is an empty cell |

- **Strings.** The escape `_xHHHH_` (four hex digits) is the character U+HHHH, replaced in one pass from left to right, so `_x000D_` is a carriage return and `_x005F_x0031_` is the text `_x0031_`. Whitespace is kept as in the file.
- **Formulas.** A cell with `<f>` has the type of its cached result (`t`) and is converted like any cell of that type from its `<v>`. A formula cell without `<v>` (a file written by a program that does not calculate) is a conversion error with `value` `=` followed by the formula (`=G2*2`); the node does not calculate it.
- **Dates.** A number cell is a date when its number format (the cell's `s` → `cellXfs` → `numFmtId`) is a date format:
  - built-in ids 14 to 17, 27 to 31, 34 to 36, 50 to 54, 57 and 58 are dates; 18 to 22, 32, 33, 45 to 47, 55 and 56 are date and time; every other built-in id (0 to 13, 37 to 44, 48, 49, …) is not a date;
  - a custom format (`<numFmt>`, id 164 and up): take its first section (up to the first `;` outside double quotes) and remove text in double quotes, every character following `\`, `_` or `*`, and every `[…]` except those that hold only the letters `h`, `m` or `s` (elapsed time such as `[h]`). When what is left contains `d`, `m`, `y`, `h` or `s` (any case) it is a date format, and date and time when it contains `h` or `s`. So `yyyy-mm-dd`, `dd/mm/yyyy` and `[$-413]d mmmm yyyy;@` are dates, `yyyy-mm-dd hh:mm` is date and time, and `0.0 "kg"`, `[Red]0.00` and `00000000000000` are not.

  The serial number `v` (the `<v>` as an IEEE 754 double) becomes a date: day = floor(`v`). In the 1900 date system (the default) the date is 1899-12-30 plus day days, and `v` below 61 (before 1900-03-01, where Excel counts a 29 February 1900 that did not exist) is a conversion error. In the 1904 date system (`<workbookPr date1904="1"/>` or `"true"` in `xl/workbook.xml`) the date is 1904-01-01 plus day days, and `v` below 0 is a conversion error. A date format gives `YYYY-MM-DD`. A date-and-time format gives `YYYY-MM-DDTHH:MM:SSZ` (Excel has no time zones; the time is taken as UTC) with seconds = round((`v` − day) × 86 400), halves up; 86 400 seconds is 00:00:00 of the next day. Example: 46082 → `2026-03-01`, 46082.5 → `2026-03-01T12:00:00Z`.
- **Numbers** that are not dates are written from `<v>` (never from what Excel displays):
  1. read `<v>` as a decimal number (sign, digits, decimal point, exponent) exactly, not through a floating-point value;
  2. a number with more than 15 significant digits is rounded to 15, halves away from zero (Excel keeps 15 digits: `0.30000000000000004` → `0.3`);
  3. write it without exponent, with `.` as the decimal separator, without leading zeros, trailing zeros after the point or a trailing point, and with `-` only for a negative number (`-0` → `0`): `2000901000015` → `2000901000015`, `2.000904000012E+12` → `2000904000012`, `12.50` → `12.5`, `1E-3` → `0.001`, `1.5E+20` → `150000000000000000000`;
  4. **zero padding**: when the number format code is only zeros, at least two (`00000000000000`), and the text is an integer of 0 or more with fewer digits, it gets leading zeros up to that many digits. This keeps barcodes that were formatted to show their leading zero (`2000901000022` with format `00000000000000` → `02000901000022`).

  Every other format is ignored: thousands separators, currency, percentages and the number of decimals shown (`0.95` shown as `95%` gives `0.95`; `2.6` shown as `2.60` gives `2.6`). A `<v>` that is not a number is `workbook_invalid`.

  GTINs typed as numbers therefore keep all their digits: they have at most 14, and Excel stores 15 exactly, even when it shows `2.00091E+12`. A cell whose *text* is `2.00091E+12` (a value that already lost its digits, for example in a CSV opened and saved again) stays an error of the `gtin` column, as in §1.2.

- **Formula injection.** A text that starts with `=`, `+`, `-` or `@` is imported as that text; it is data, never a formula, exactly as in a CSV. Only the cached result of a formula reaches the import, never the formula itself. Every CSV or workbook a node writes later protects such cells as §2.3 says.

### 5.5 Errors, warnings and row numbers

- **Row numbers are Excel's.** The `row` of every ImportRowError about a workbook is the row number Excel shows: the header is row 1, the first data row is row 2. This holds for conversion errors and for every error and warning of the CSV import of those rows (a CSV import of the same rows would report one less). Problems with the header or the file keep `row: null`. `column` is what a CSV import reports for that column.
- **`detail` starts with a locator** when the error or warning is about a cell: `row <n>, column <header> (<letter>): `, where `<header>` is the header text of that column as written in row 1 (trimmed) and `<letter>` the column letter, for example `row 12, column ean (C): the check digit is wrong`. About a column without a row: `column <header> (<letter>): `, or `column <letter>: ` when it has no header; about a row without a column: `row <n>: `. The text after the locator is the node's own.
- **Conversion errors** (an error value, a formula without a cached value, a date out of range): `severity` `error`, `obx_error` `validation_failed`, `column` the header text of that column as written in row 1, trimmed (`null` when it has none), `value` the error text (`#N/A`) or the formula (`=G2*2`), one per cell in column order. The row is then imported as an empty row, so it is skipped as a whole, like every row with an error ([rule 2](#4-processing-rules)); its other cells are not validated. A conversion error in row 1 (columns 1 to W) has `row: 1` and gives that column an empty name.
- **Values right of the header** (§5.3): one warning per column, `severity` `warning`, `obx_error` `validation_failed`, `row` and `column` `null`, `detail` starting with `column <letter>: `.
- **Workbook errors**: a workbook that cannot be imported gives one ImportRowError with `row` and `column` `null`, `severity` `error` and one of the codes below, and nothing of that file is imported (the rest of the import goes on as with an unreadable CSV). A node that checks an upload while it is being sent (the admin UI) MAY answer at once with a problem+json document with that code and status. A file above the node's upload limit is `payload_too_large`, as for any upload.

| `obx_error` | HTTP | When |
|---|---|---|
| `workbook_invalid` | 422 | not a readable `.xlsx`: not a zip (a renamed CSV), an encrypted workbook or a legacy `.xls` (an OLE compound file), an encrypted zip entry, no `[Content_Types].xml` or no workbook part, a main part that is not a workbook or template (`…spreadsheetml.sheet.main+xml`, `…spreadsheetml.template.main+xml`), Strict Open XML, XML that is not well-formed, a `DOCTYPE` in any part, a number cell whose `<v>` is not a number, a shared string that does not exist |
| `workbook_unsafe` | 422 | macros or links to the outside: a part named `vbaProject.bin` anywhere, a content type containing `macroEnabled` or `vbaProject`, a part under `xl/macrosheets/`, `xl/activeX/` or `xl/externalLinks/`, `xl/connections.xml`, or a relationship of the workbook part with `TargetMode="External"`. Save the file as "Excel Workbook (.xlsx)" without them |
| `workbook_sheet_missing` | 422 | no sheet found by §5.2 |
| `workbook_too_large` | 422 | a limit of §5.6 |

### 5.6 Limits and safety

The limits are fixed, so every node gives the same answer. A node checks in this order; the first check that fails gives the code:

1. **Size**: the file is within the node's upload limit for a CSV, else `payload_too_large`.
2. **Signature**: the file starts with `PK\x03\x04`. A file starting with `D0 CF 11 E0 A1 B1 1A E1` (an encrypted workbook or a legacy `.xls`) and every other file is `workbook_invalid`.
3. **Zip**: the central directory can be read and no entry is encrypted, else `workbook_invalid`.
4. **Zip bomb**, from the central directory, before anything is inflated: at most 1 000 entries; the declared uncompressed sizes add up to at most 256 MiB; no entry declares more than 10 MiB uncompressed while that is more than 100 times its compressed size. Else `workbook_too_large`. Because declared sizes can lie, a node also counts the bytes it inflates and stops with `workbook_too_large` when an entry inflates beyond its declared size or the parts it inflated pass 256 MiB together.
5. **Unsafe parts** (`workbook_unsafe`): by entry names and `[Content_Types].xml`, before those parts are read; a node never inflates them.
6. **Structure** (`workbook_invalid`): `_rels/.rels` names the main part (relationship type `…/officeDocument`), `[Content_Types].xml` gives it a workbook content type, and its root element is `workbook` in the transitional namespace `http://schemas.openxmlformats.org/spreadsheetml/2006/main`. Every XML part the node reads is well-formed and has no `DOCTYPE`; entities other than the five XML ones (`&amp;` …) are never expanded.
7. **External relationships** of the workbook part: `workbook_unsafe`.
8. **The sheet** (§5.2): `workbook_sheet_missing`.
9. **Cells** of the chosen sheet: a non-empty cell (an error value counts) below row 100 001 (more than 100 000 data rows) or right of column 1 000 (`ALL`) is `workbook_too_large`.
10. **Conversion** (§5.3, §5.4).

Further:
- A node reads only `[Content_Types].xml`, `_rels/.rels`, the workbook part and its relationships, `styles.xml`, `sharedStrings.xml` and worksheets; images, printer settings, drawings, comments and embedded objects are never inflated.
- Parts are looked up by name in the zip and never written to disk under their entry name (so there is no zip-slip).
- Nothing is fetched: no external links, hyperlinks, external relationships, DTDs or external entities.

### 5.7 After the conversion

The rows are `products.csv` or `assets.csv` and are imported as such (§1 to §4), including `dry_run`, `mirror`, `default_language`, images and `assets.csv` next to the workbook, label completeness warnings and the change feed. A workbook import and a CSV import of the same rows write the same objects, report the same counts and produce the same `/changes` entries; only `file`, `row` and `detail` of their ImportRowErrors differ (§5.5).
