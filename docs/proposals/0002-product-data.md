# Proposal 0002: product data for fashion, shoes, bags and luggage (spec 0.2)

Status: **accepted** 2026-11-12 · non-breaking (additive), implemented in spec **0.2.0** ([changelog](../../CHANGELOG.md))

## Why

Version 0.1 carries images well, but the article data is thin: composition and care exist, and
everything else (dimensions, weight, volume, wheels, lock, detachable strap, certifications) ends
up in free `attributes` strings, or is dropped. Retailers rebuild that data by hand or with
scrapers. Photopilot's own data shows what brands and retailers actually exchange
(see "Sources" below); EU law decides what must be shown to consumers.

Goals:

1. **Legal first.** Everything the EU requires on a label or a product page has a precise field,
   named after the law, with a pointer to the article that requires it.
2. **Simple.** Few new fields, fixed units (cm, kg, l), plain words. Optional everywhere, so a
   0.1 node stays conformant.
3. **Own names.** Names come from the regulations, ISO/GS1 and schema.org terms and OBX's own
   conventions, not from any vendor's API.

Non-goals: a full product information model (no PIM), marketing copy fields, prices or stock.

## What the law requires (EU), and what OBX does with it

| Information | EU status | Legal basis | OBX field |
|---|---|---|---|
| Fibre composition of textile products, per component, in % | **mandatory**, also online before purchase | Regulation (EU) No 1007/2011, Art. 9, 11, 16(1) | `materials` (exists) |
| "Contains non-textile parts of animal origin" | **mandatory** when true | Reg. 1007/2011, Art. 12 | new `contains_animal_origin` |
| Material of upper, lining and sock, outer sole of footwear (leather, coated leather, textile, other) | **mandatory** | Directive 94/11/EC, Art. 1-3 and Annex I | new `footwear_materials` |
| Care instructions | voluntary (common practice) | ISO 3758 symbols (GINETEX) | `care` (exists) |
| Country of origin | voluntary in the EU | none at EU level | `country_of_origin` (exists) |
| Certifications (GOTS, OEKO-TEX, GRS …) | voluntary, private schemes | the scheme's own rules | new `certifications` |
| Digital Product Passport | coming: textiles delegated act planned for Q4 2027 | Regulation (EU) 2024/1781 (ESPR) | `dpp_url` (exists) |

The documentation and the website say exactly this: mandatory is mandatory, voluntary is
voluntary, and a certification is not a legal requirement.

## The additions

### 1. Product: classification

- `item_type` stays. New recommended key **`luggage`** (suitcases are not bags for retailers'
  filters and airline rules).
- New optional **`item_subtype`** (open vocabulary, same pattern). Recommended keys:
  - `bag`: `handbag`, `shoulder_bag`, `crossbody`, `tote`, `clutch`, `belt_bag`, `backpack`,
    `laptop_bag`, `briefcase`, `weekender`, `toiletry_bag`, `wallet`, `card_holder`.
  - `luggage`: `underseat`, `cabin`, `check_in_medium`, `check_in_large`, `pilot_case`,
    `garment_bag`, `duffel`.
  - `shoes`: `sneaker`, `running`, `hiking`, `lace_up`, `loafer`, `pump`, `sandal`,
    `slipper`, `ankle_boot`, `boot`, `knee_boot`.

### 2. Product: composition, legally precise

- `materials` stays: `[{ "part": …, "fibers": [{ "fiber": …, "percentage": … }] }]`.
  - The `part` vocabulary becomes controlled (unknown parts still allowed): `main`, `outer`,
    `lining`, `filling`, `padding`, `trim`, `pocket_lining`, `shell` (luggage), `handle`,
    `strap`.
  - **Fibre names follow Annex I of Reg. 1007/2011** (`cotton`, `wool`, `polyester`,
    `polyamide`, `elastane`, `viscose`, `lyocell` …). Recycled content is a property, not a
    fibre: `{ "fiber": "polyester", "percentage": 100, "recycled": true }`. The 0.1 keys
    `recycled_polyester`, `recycled_polyamide`, `recycled_cotton`, `organic_cotton` stay accepted
    and are normalised (`organic: true`).
- New **`contains_animal_origin`**: `true` / `false` / `null` (unknown).
- New **`footwear_materials`** (shoes only):

  ```json
  "footwear_materials": { "upper": "leather", "lining_and_sock": "textile", "outer_sole": "other" }
  ```

  Values are the directive's four categories: `leather`, `coated_leather`, `textile`, `other`.
  Fibre detail for shoes can still go in `materials`.

### 3. Variant: measurements (fixed units)

New optional **`measurements`** on the variant, because a cabin and a large suitcase of one model
are different variants:

```json
"measurements": {
  "height_cm": 55, "width_cm": 40, "depth_cm": 20,
  "weight_kg": 2.6,
  "volume_l": 38, "volume_expanded_l": 44,
  "handle_drop_cm": 22, "strap_length_cm": { "min": 80, "max": 130 },
  "laptop_max_inch": 15.6,
  "heel_height_cm": 4.5, "shaft_height_cm": 18,
  "inseam_cm": 81
}
```

How to measure, so every brand measures the same way:

- **height**: vertical, the article standing in normal use; **width**: left to right seen from
  the front; **depth**: front to back.
- **luggage**: outer dimensions *including* wheels, handles and feet (what airlines measure).
- **bags**: the body *without* handles and strap; handles go in `handle_drop_cm`, the strap in
  `strap_length_cm`.
- Numbers only, in cm, kg and litres; no unit fields, no conversions.

The retailer derives "fits as cabin luggage" from the dimensions; OBX does not store airline
rules, which change per airline.

### 4. Product: features (a small, typed registry)

New optional **`features`** object; keys from a published registry with a type and allowed
values. Unknown keys are allowed but not validated. First version:

| Key | Type | Values | For |
|---|---|---|---|
| `shell` | enum | `hard`, `soft`, `hybrid` | luggage |
| `wheels` | integer | 0, 2, 4, 8 | luggage |
| `lock` | enum | `none`, `combination`, `tsa_combination`, `tsa_key`, `key` | luggage, bags |
| `expandable` | boolean | | luggage, bags |
| `closure` | enum | `zip`, `magnet`, `flap`, `buckle`, `drawstring`, `button`, `hook_and_loop`, `laces`, `slip_on`, `open` | bags, shoes, apparel |
| `laptop_compartment` | boolean | (size in `measurements.laptop_max_inch`) | bags |
| `water_resistance` | enum | `none`, `water_repellent`, `waterproof` | all |
| `detachable_parts` | list | `shoulder_strap`, `handle`, `lining`, `insole`, `hood`, `belt`, `pouch`, `wheels` | all |
| `adjustable_parts` | list | `shoulder_strap`, `waist`, `hem`, `cuff` | all |
| `fit` | enum | `slim`, `regular`, `relaxed`, `oversized` | apparel |
| `sleeve_length` | enum | `sleeveless`, `short`, `three_quarter`, `long` | apparel |
| `neckline` | enum | `crew`, `v_neck`, `collar`, `hood`, `turtleneck`, `boat`, `scoop` | apparel |

"Removable" is answered once, generically: `detachable_parts`. A removable insole, lining or
strap is a value in that list, not a separate field per product type.

`attributes` (free strings) stays for everything else.

### 5. Variant: colour family and second size

- `color.family`: one of `black`, `white`, `grey`, `beige`, `brown`, `red`, `pink`, `orange`,
  `yellow`, `green`, `blue`, `purple`, `gold`, `silver`, `multicolour`, `transparent`. For
  filters, next to the brand's own colour name.
- `size_length`: the second size where one exists (jeans 32/**34**, bra 75/**B**).

### 6. Product: certifications

```json
"certifications": [
  { "scheme": "gots", "licence_number": "CU 123456", "scope": "product" },
  { "scheme": "oeko_tex_standard_100", "licence_number": "21.HUS.12345", "scope": "product" }
]
```

`scheme` open vocabulary, recommended: `gots`, `ocs`, `grs`, `rcs`, `oeko_tex_standard_100`,
`oeko_tex_made_in_green`, `bluesign`, `fsc`, `lwg`, `rws`, `rds`. `scope`: `product` or
`material`. The node only passes on what the brand states; checking a licence is the retailer's
business.

## In the CSV (import format)

Each new field gets one plain column, so a spreadsheet stays readable:

| Column | Example |
|---|---|
| `item_subtype` | `cabin` |
| `contains_animal_origin` | `yes` / `no` |
| `footwear_materials` | `upper: leather; lining_and_sock: textile; outer_sole: other` |
| `height_cm`, `width_cm`, `depth_cm`, `weight_kg`, `volume_l`, `volume_expanded_l` | `55`, `40`, `20`, `2.6`, `38`, `44` (per variant row) |
| `handle_drop_cm`, `strap_length_cm`, `laptop_max_inch`, `heel_height_cm`, `shaft_height_cm`, `inseam_cm` | `22`, `80-130`, `15.6` … |
| `feature:<key>` | `feature:wheels` = `4`, `feature:detachable_parts` = `shoulder_strap\|lining` |
| `color_family`, `size_length` | `blue`, `34` |
| `certifications` | `gots:CU 123456; oeko_tex_standard_100:21.HUS.12345` |
| `materials` (existing) | `outer: 100% polyester (recycled); lining: 88% polyamide, 12% elastane` |

## What gets simpler at the same time

- **One page "OBX in 10 minutes"** in the spec: discovery → token → changes → products/assets.
  Everything else (ingest, exports, webhooks, usage) is clearly marked optional.
- **The protocol profile is the standard.** Ingest and the Node Admin API are companion
  documents (already true since 0.1; the documents will say it at the top).
- **Fewer vocabularies to learn:** units are fixed, "removable" is one list, legal names are used
  as-is.

## Rollout (one release of everything)

1. **spec 0.2.0**: schemas, protocol and import-format text, fixtures (a suitcase, a bag, a shoe
   added to the Kestrel test brand), conformance tests for the new fields' validation and round
   trip.
2. **obx-go 0.2.0**: types, CSV import/export, `obx push`, conformance suite, mock node.
3. **admin-ui 0.2.0**: show measurements, features, composition and the legal lines on the
   retailer's article page and in the CSV export; edit them in the brand admin.
4. **node-go, node-php, node-ts 0.2.0**: storage, import, API.
5. **website**: the label page with the legal table above; developer docs.
6. **Photopilot** (its own repository): project `body_*` dimensions, the luggage filter
   attributes and the content presets onto `measurements` and `features`; shoe parts to
   `footwear_materials`.

## Decisions (2026-11-12)

1. Luggage is its own `item_type`: `luggage`.
2. Measurements are per **variant**.
3. Recycled and organic content are properties of a fibre (`recycled`, `organic`); the 0.1 keys
   `recycled_*` and `organic_cotton` are accepted and normalised.
4. The feature registry starts with the list above.

## Sources

- Regulation (EU) No 1007/2011 on textile fibre names and labelling (EUR-Lex).
- Directive 94/11/EC on footwear labelling ([summary](https://eur-lex.europa.eu/EN/legal-content/summary/footwear-labelling.html)).
- European Commission, [DPP for textiles and apparel](https://single-market-economy.ec.europa.eu/single-market/digital-product-passport/textile-apparel_en) (delegated act planned Q4 2027).
- ISO 3758 care labelling code; GS1 GPC; schema.org `height`, `width`, `depth`, `weight`.
- Photopilot's data model (item type catalogue with bag, luggage and shoe subtypes; `body_width/depth/height` in cm; luggage filter attributes `shell`, `wheels`, `suitcase_size`; content presets for laptop compartment, lock, expandable, volume; per-part materials and GINETEX care codes) and what its suppliers deliver (ERP extra components such as weight, volume, wheels, lock; marketplace feeds with fit, closure, sleeve length, neckline, certificates, animal parts, second size).
