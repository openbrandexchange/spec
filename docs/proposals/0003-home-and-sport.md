# Proposal 0003: product data for home and sport (spec 0.3)

Status: **draft** 2026-11-12 · non-breaking (additive), target spec **0.3.0** · open for comments for at least 14 days ([governance](../governance.md#process))

## Why

Version 0.2 describes fashion, shoes, bags and luggage well ([proposal 0002](0002-product-data.md)).
Brands that also sell **home** products (furniture, home textiles, lighting, decoration) and
**sport** products (sportswear, sport shoes, equipment) still end up with free `attributes`
strings for everything that makes those products sellable: seat height, mattress size, the
number of parcels, assembly, lumen and energy class, the sport a shoe is made for, the protection
standard of a helmet. Retailers retype that from PDFs and supplier portals.

Photopilot's data (see "Sources") shows the gap plainly: the brand portals it reads for sport
brands deliver images and no attributes, retailers' ERPs carry a handful of label/value pairs
(dimensions, weight, volume, warranty, water resistance), and rackets, balls and skis fall back
to `generic_product` because there is no item type for them. What home and sport fields exist
today were typed in by hand from price lists or derived from photos. So this proposal leans less
on what feeds already carry than 0002 did, and more on what the law and the trade's own product
sheets ask for; the open decisions say where that makes it a judgement call.

EU law decides which fields a seller must show, and for home and sport that is more than for
fashion: the textile regulation also covers bed linen, curtains and furniture coverings, lamps
carry an energy label, protective sports equipment is PPE, and since December 2024 every online
offer of a consumer product must name the manufacturer and the product's warnings (GPSR).

Goals (the same as 0002):

1. **Legal first.** Everything the EU requires on a label or a product page has a precise field,
   named after the law, with a pointer to the article that requires it.
2. **Simple.** Reuse what 0.2 has (item types, `materials`, `care`, `measurements`, `features`,
   `certifications`, `footwear_materials`); add few new fields; fixed units in the field name.
   Optional everywhere, so a 0.2 node stays conformant on the 0.2 profile.
3. **Own names.** Names come from the regulations, ISO/EN standards and plain words, not from any
   vendor's or platform's API. The supplier portals that informed this proposal are sources of
   *which* information exists, never of *how it is named*.

Non-goals: a full product information model, assembly or spare-part catalogues, prices, stock,
logistics master data beyond what a webshop shows (no pallet data, no customs tariff numbers),
bicycles and motorised equipment, toys (the Toy Safety Regulation is its own world), food-contact
articles (tableware and kitchenware are left for a later proposal).

## Scope

| Category | In scope | Reuses from 0.2 |
|---|---|---|
| **Home: furniture** | seating, tables, beds and bed frames, storage, garden furniture | `measurements`, `features`, `certifications` (`fsc`) |
| **Home: bedding** | mattresses, toppers, duvets, pillows, mattress protectors | `materials` (cover, filling), `contains_animal_origin` (down, feathers), `care` |
| **Home: home textiles** | bed linen, towels, curtains, cushions, throws, table linen, rugs | `materials`, `contains_animal_origin`, `care`, `certifications` (`oeko_tex_standard_100`, `gots`) |
| **Home: lighting** | luminaires (lamps) and light sources (bulbs) | `measurements`, `features` |
| **Home: decoration** | vases, mirrors, frames, candles, wall art, baskets, clocks | `measurements` |
| **Sport: clothing** | the apparel item types of 0.2 used for sport | `fit`, `sleeve_length`, `neckline`, `water_resistance`, `materials`, sizes |
| **Sport: shoes** | running, trail, court, football, hiking and other sport shoes | `shoes` and its subtypes, `footwear_materials`, `closure`, sizes |
| **Sport: equipment** | balls, rackets, fitness equipment, mats, protective equipment, sport eyewear | `measurements`, `features` |

## What the law requires (EU), and what OBX does with it

| Information | EU status | Legal basis | OBX field |
|---|---|---|---|
| Fibre composition of **home textiles** (bed linen, towels, curtains, cushion covers, throws, table linen, duvets and pillows), in % per component | **mandatory**, also online before purchase | Regulation (EU) No 1007/2011, Art. 9, 11, 16(1) | `materials` (exists) |
| Fibre composition of **furniture coverings** (upholstery) with at least 80 % textile components by weight, of **mattress coverings**, and of the **upper layer of multi-layer floor coverings** (rugs, carpets) | **mandatory** for the covering or upper layer (not for the frame, foam or backing) | Reg. 1007/2011, Art. 2(2)(b) and (c) | `materials` with part `upholstery`, `cover`, `pile` (new part keys) |
| "Contains non-textile parts of animal origin" (for example down and feather fillings, leather upholstery trims) | **mandatory** when true, on a textile product | Reg. 1007/2011, Art. 12 | `contains_animal_origin` (exists) |
| Fibre composition of **sportswear** | **mandatory** (sportswear is an ordinary textile product) | Reg. 1007/2011 | `materials` (exists) |
| Fibre composition of **protective sports requisites** (pads, guards; gloves excepted) | **not mandatory** (Annex V, item 31); voluntary | Reg. 1007/2011, Art. 17(2) and Annex V | `materials` (exists) |
| Material of upper, lining and sock, outer sole of **sport shoes** | **mandatory** | Directive 94/11/EC | `footwear_materials` (exists) |
| **Manufacturer** (name, postal and electronic address) and, for a manufacturer outside the EU, the **EU responsible person**, in every online offer | **mandatory** for consumer products sold online since 13 December 2024 | Regulation (EU) 2023/988 (GPSR), Art. 19(a), Art. 16 | new `safety.manufacturer`, `safety.responsible_person` |
| **Warnings and safety information** that must be on the product or come with it, in a language the consumer understands, also in the online offer | **mandatory** where the product has them | GPSR, Art. 19(c), Art. 9(7) | new `safety.warnings` |
| Product identification (picture, type, other identifier) in the online offer | **mandatory** | GPSR, Art. 19(b) | images, `style_number`, GTIN (exist) |
| **Energy label** (class A–G) of a **light source**, shown with the price online, and the product information sheet; registration in EPREL | **mandatory** for light sources | Regulation (EU) 2017/1369; Delegated Regulation (EU) 2019/2015, Art. 3, 4 and Annex VIII (distance selling) | new variant `energy_label` |
| Energy class of the light source in a **luminaire** ("containing product"): a sentence in the user manual, not a label | **mandatory** in the manual and technical documentation; no label on the luminaire | Del. Reg. (EU) 2019/2015, Annex V | new variant `lighting.contained_energy_class` |
| Light output, colour temperature, power and other data on the packaging of light sources | **mandatory** on packaging (product information requirements) | Regulation (EU) 2019/2020 (ecodesign, light sources), Annex II | new variant `lighting` |
| **PPE** (helmets, protectors, sport goggles and sunglasses, harnesses, buoyancy aids): CE marking, instructions, and the EU declaration of conformity or the internet address where it can be read | **mandatory** for PPE | Regulation (EU) 2016/425, Art. 8(9), Art. 17, Annex II point 1.4 | new `ppe` |
| Filter category (0–4) of sunglasses and sport eyewear | marked on the product by EN ISO 12312-1, the harmonised standard sunglasses (PPE category I) are in practice assessed against; the standard itself is voluntary | Reg. (EU) 2016/425; EN ISO 12312-1 | new feature `lens_filter_category` |
| Substances of very high concern (SVHC) above 0.1 % w/w in an article | **mandatory** to the recipient (the retailer) automatically, and to a consumer on request within 45 days | Regulation (EC) No 1907/2006 (REACH), Art. 33 | new `svhc` |
| Safety of furniture (stability, strength, durability): EN 12520 (domestic seating), EN 1335 (office chairs), EN 581 (outdoor furniture), EN 14749 (storage), EN 1725 / EN 597 (beds, mattress flammability), EN 747 (bunk beds) | **voluntary** standards; they can support the safety assessment that GPSR requires but are not a labelling obligation | the standards themselves; GPSR Art. 5–7 | new `standards` (voluntary, as stated by the brand) |
| Fitness equipment (EN ISO 20957), UV protection of clothing (EN 13758-2), sport surfaces | **voluntary** standards | the standards themselves | `standards`, features |
| Care instructions, country of origin | voluntary | ISO 3758 (textiles); none at EU level | `care`, `country_of_origin` (exist) |
| Certifications (FSC, PEFC, OEKO-TEX, GOTS, EU Ecolabel …) | voluntary | the scheme's own rules (EU Ecolabel: Regulation (EC) No 66/2010, voluntary) | `certifications` (exists; new recommended keys) |
| Deforestation-free due diligence for wooden furniture | obligation of the operator placing it on the market; **not** consumer information | Regulation (EU) 2023/1115 (EUDR); application dates were postponed, check the current text | none (out of scope) |
| Digital Product Passport | coming; furniture and mattresses are on the ESPR working plan, no delegated act yet | Regulation (EU) 2024/1781 (ESPR) | `dpp_url` (exists) |

National rules exist beside these (for example fire-safety rules for upholstered furniture in
Ireland, and in the United Kingdom, which is outside the EU). OBX does not model them; a brand
can name the standard it meets in `standards`. As in 0002: mandatory is mandatory, voluntary is
voluntary, and a standard or certification is not a legal requirement unless a law says so.

*Note on 0.2 found while writing this:* Annex V of Reg. 1007/2011 also lists "travel goods of
textile materials" (item 17) as products for which a fibre label is not mandatory. 0.2 gives the
warning `fibre_composition_missing` for `bag`, `backpack` and `luggage`. That deserves its own
patch-level clarification (see open decision 12); this proposal does not change it.

## The additions

### 1. Product: classification

`item_type` stays an open vocabulary. `home` and `generic_product` stay valid as catch-alls.
New RECOMMENDED keys, each with RECOMMENDED `item_subtype` keys:

| `item_type` | `item_subtype` |
|---|---|
| `furniture` | `sofa`, `corner_sofa`, `sofa_bed`, `armchair`, `chair`, `dining_chair`, `office_chair`, `stool`, `bar_stool`, `bench`, `pouf`, `dining_table`, `coffee_table`, `side_table`, `console_table`, `desk`, `bed_frame`, `box_spring_bed`, `bunk_bed`, `nightstand`, `wardrobe`, `chest_of_drawers`, `cabinet`, `sideboard`, `bookcase`, `wall_shelf`, `tv_unit`, `garden_set`, `lounger` |
| `bedding` | `mattress`, `mattress_topper`, `mattress_protector`, `duvet`, `pillow` |
| `home_textile` | `duvet_cover`, `fitted_sheet`, `flat_sheet`, `pillowcase`, `bedspread`, `towel`, `bath_mat`, `beach_towel`, `curtain`, `sheer_curtain`, `cushion`, `cushion_cover`, `throw`, `tablecloth`, `table_runner`, `napkin` |
| `rug` | `rug`, `runner`, `doormat`, `outdoor_rug` |
| `lighting` | `ceiling`, `pendant`, `wall`, `floor`, `table`, `desk`, `outdoor`, `string_lights` |
| `light_source` | `bulb`, `spot`, `tube`, `led_strip` |
| `decoration` | `vase`, `mirror`, `frame`, `wall_art`, `candle`, `candle_holder`, `plant_pot`, `basket`, `clock`, `ornament` |
| `sports_equipment` | `ball`, `racket`, `bat`, `stick`, `club`, `net`, `goal`, `skis`, `ski_poles`, `snowboard`, `skates`, `board`, `bottle`, `other` |
| `fitness_equipment` | `dumbbell`, `kettlebell`, `weight_plate`, `bench`, `mat`, `resistance_band`, `jump_rope`, `treadmill`, `exercise_bike`, `rowing_machine`, `cross_trainer` |
| `protective_equipment` | `helmet`, `knee_protector`, `elbow_protector`, `wrist_protector`, `back_protector`, `shin_guard`, `mouthguard`, `goggles`, `buoyancy_aid` |

Sport **clothing** keeps the apparel item types of 0.2 (`t_shirt`, `leggings`, `shorts`,
`jacket`, ...), with three new keys that have no apparel equivalent: `sports_bra`, `base_layer`,
`tracksuit`. What makes an article a sport article is the new feature `sports` (section 4), not
a separate item type, so a running shirt filters both as a T-shirt and as running.

Sport **shoes** keep `item_type` `shoes`; new `item_subtype` keys next to 0.2's `running` and
`hiking`: `trail_running`, `walking`, `training`, `court`, `football`, `cycling`, `golf`,
`climbing`, `ski_boot`. Sport **bags** keep `bag` with new subtype `sports_bag`. Sport
**eyewear** keeps `eyewear` with new subtypes `sunglasses` and `sport_glasses`.

Rugs are their own type (and not `home_textile`) because only their upper layer is a textile
product under Art. 2(2)(c), and their measurements differ. Light sources are their own type
(and not `lighting`) because the energy label applies to the light source, not to the luminaire.
Mattresses sit under `bedding` because their cover is a textile covering (Art. 2(2)(c)(ii)) and
retailers sell them next to duvets and pillows.

### 2. Product: materials, legally precise and also for hard goods

- `materials` stays the **textile fibre composition**, unchanged in shape, with new RECOMMENDED
  part keys: `upholstery` (furniture covering), `cover` (mattress, duvet, pillow and cushion
  covering), `filling` (exists), `pile` (rug use-surface), `backing` (rug), `face` and `back`
  (two-sided textiles), `core` (mattress, when it is textile). New RECOMMENDED fibre keys for
  fillings that are not Annex I fibres: `down`, `feather` (exist), `polyurethane_foam`,
  `memory_foam`, `latex`. A part that is not textile and has no percentages belongs in
  `component_materials`.

- New **`component_materials`** for everything that is not a textile fibre composition: wood,
  metal, glass, stone, plastic, foam cores, springs. No percentages (brands do not state them for
  hard goods), one entry per part:

  ```json
  "component_materials": [
    { "part": "frame", "material": "solid_wood", "species": "oak", "finish": "oiled" },
    { "part": "legs", "material": "steel", "finish": "powder_coated" },
    { "part": "top", "material": "veneer", "species": "oak", "core": "mdf", "finish": "lacquered" },
    { "part": "core", "material": "pocket_springs" }
  ]
  ```

  - `part` (RECOMMENDED keys): `frame`, `top`, `legs`, `base`, `seat`, `back`, `armrests`,
    `doors`, `drawers`, `shelves`, `handles`, `headboard`, `slats`, `core`, `springs`, `shade`,
    `glass`, `body`, `head`, `grip`, `shaft`, `sole`; unknown keys allowed.
  - `material` (RECOMMENDED keys): `solid_wood`, `veneer`, `mdf`, `particleboard`, `plywood`,
    `bamboo`, `rattan`, `wicker`, `cork`, `paper`, `steel`, `stainless_steel`, `aluminium`,
    `iron`, `brass`, `copper`, `glass`, `ceramic`, `porcelain`, `stone`, `marble`, `concrete`,
    `plastic`, `polypropylene`, `polycarbonate`, `acrylic_glass`, `rubber`, `eva`, `carbon_fibre`,
    `glass_fibre`, `leather`, `polyurethane_foam`, `memory_foam`, `latex`, `pocket_springs`,
    `bonnell_springs`, `other`.
  - `species` (wood only, open vocabulary in English: `oak`, `beech`, `ash`, `walnut`, `pine`,
    `teak`, `acacia`, `mango`, `eucalyptus`, ...), `core` (what a veneer or coating is on),
    `finish` (RECOMMENDED: `untreated`, `oiled`, `waxed`, `lacquered`, `varnished`, `stained`,
    `painted`, `powder_coated`, `chromed`, `brushed`, `polished`, `anodised`), `density_kg_m3`
    (foams: furniture makers state the density of each seat foam, e.g. `45`), and the 0.2 flag
    `recycled` (present only when true). All but `part` and `material` are optional.

- `contains_animal_origin` applies unchanged; for duvets and pillows with down or feathers it is
  `true`.

### 3. Variant: measurements (new keys, fixed units)

`measurements` stays on the variant (a 140 and a 160 cm mattress are different variants). The
0.2 keys `height_cm`, `width_cm`, `depth_cm`, `weight_kg` keep their meaning: the **assembled**
article as used, without packaging. New keys:

| Key | Unit | What |
|---|---|---|
| `length_cm` | cm | items that lie flat (mattresses, rugs, towels, bed linen, mats, skis, boards): the longer side; then `width_cm` is the shorter side and `height_cm` the thickness |
| `seat_height_cm`, `seat_depth_cm`, `seat_width_cm` | cm | seating: from the floor to the top of the seat (compressed by nothing), the usable depth and width of the seat |
| `armrest_height_cm` | cm | seating: from the floor to the top of the armrest |
| `height_adjustable_cm` | cm | an adjustable height as `{"min": 42, "max": 53}` (office chairs, desks, bar stools), like 0.2's `strap_length_cm` |
| `width_extended_cm` | cm | extendable tables and sofa beds: the width fully extended or unfolded |
| `mattress_width_cm`, `mattress_length_cm` | cm | bed frames, slatted bases, fitted sheets, mattress protectors: the mattress size it is made for (`160` × `200`) |
| `mattress_height_max_cm` | cm | fitted sheets and protectors: the highest mattress it fits |
| `pile_height_cm` | cm | rugs: the height of the pile above the backing |
| `fill_weight_kg` | kg | duvets, pillows, cushions: the weight of the filling |
| `diameter_cm` | cm | round items (tables, lamp shades, mirrors, balls, plates): the diameter; replaces width and depth |
| `cable_length_cm` | cm | lighting: the cable or suspension length (the maximum, when adjustable) |
| `max_load_kg` | kg | the static load the article is made to carry as the brand states it (a shelf, a table top, a bed, a lounger) |
| `max_user_weight_kg` | kg | seating, beds, fitness equipment: the heaviest user it is made for |
| `head_circumference_cm` | cm | helmets: the head size range as `{"min": 54, "max": 58}` |
| `drop_mm`, `stack_height_mm` | mm | sport shoes: heel-to-toe drop and stack height at the heel, as the trade states them in millimetres |

And the **packages** the article ships in (a wardrobe in three boxes), on the variant beside
`measurements`, because webshops show the number of parcels and use the sizes for delivery
options:

```json
"packages": [
  { "height_cm": 205, "width_cm": 62, "depth_cm": 12, "weight_kg": 48.5 },
  { "height_cm": 105, "width_cm": 55, "depth_cm": 8, "weight_kg": 21 }
]
```

The number of parcels is the length of the list (no separate count to keep in sync); `null`
when not stated, never an empty list. A package's three dimensions are the outer dimensions of
the box (their order carries no meaning for a box), `weight_kg` is its gross weight.

How to measure, added to 0.2's rules:

- **Furniture**: outer dimensions of the assembled article in its normal position; for seating,
  `height_cm` includes the back, `depth_cm` is front to back including armrests and cushions.
  Adjustable furniture states the lowest setting in `height_cm` and the range in
  `height_adjustable_cm`.
- **Mattresses, rugs, textiles**: lying flat; `width_cm` × `length_cm` is the nominal size the
  brand sells it as (`160` × `200`), `height_cm` the thickness.
- **Curtains**: hanging; `width_cm` is the width of one panel as sold, `height_cm` the drop. A
  pair sold together states one panel and the pack size in `features.pieces`.
- **Lamps**: the luminaire with shade, without the cable; pendants give the height of the
  luminaire itself and the suspension in `cable_length_cm`.
- **Sport shoes**: `weight_kg` is **one** shoe of the stated size (that is what the trade
  quotes); 0.2 left this open.

### 4. Product: features (new registry keys and values)

New keys in the registry of [protocol.md §5.9.4](../protocol.md#features). Same rules as 0.2:
registry keys are validated, other keys are allowed and not validated.

General (home and sport):

| Key | Type | Values | For |
|---|---|---|---|
| `use_location` | enum | `indoor`, `outdoor`, `indoor_and_outdoor` | furniture, rugs, lighting, decoration, equipment |
| `assembly_required` | boolean | | furniture, lighting, equipment |
| `assembly_persons` | integer | `1`–`4` | furniture, equipment |
| `assembly_time_minutes` | integer | > 0 | furniture, equipment |
| `tools_included` | boolean | | furniture, equipment |
| `wall_fixing` | enum | `required`, `included`, `recommended`, `not_needed` | furniture (tip-over), mirrors, shelves |
| `pieces` | integer | > 0 | sets: number of items in the pack (2 pillowcases, 4 chairs, 3 balls) |
| `foldable` | boolean | | furniture, equipment |
| `stackable` | boolean | | furniture |
| `commercial_warranty_years` | integer | > 0 | all: the brand's own guarantee; not the legal guarantee of conformity (Directive (EU) 2019/771), which applies regardless |

Furniture and bedding:

| Key | Type | Values | For |
|---|---|---|---|
| `seats` | integer | > 0 | sofas, benches, garden sets; dining tables: the number of people it seats |
| `shape` | enum | `round`, `oval`, `square`, `rectangular`, `irregular` | tables, rugs, mirrors, cushions |
| `sleeping_function` | boolean | | sofas |
| `extendable` | boolean | | tables (extended size in `measurements.width_extended_cm`) |
| `reclining` | enum | `none`, `manual`, `electric` | seating, beds |
| `swivel` | boolean | | chairs |
| `castors` | boolean | | chairs, tables, storage |
| `orientation` | enum | `left`, `right`, `reversible` | corner sofas, chaise longues |
| `storage_space` | boolean | | beds, ottomans, benches |
| `firmness` | enum | `soft`, `medium_soft`, `medium`, `medium_firm`, `firm` | mattresses, toppers, pillows |
| `comfort_zones` | integer | > 0 | mattresses |
| `turnable` | boolean | | mattresses |
| `warmth` | enum | `light`, `medium`, `warm`, `extra_warm`, `four_seasons` | duvets |

Home textiles, rugs and lighting:

| Key | Type | Values | For |
|---|---|---|---|
| `thread_count` | integer | > 0 | bed linen |
| `fabric_weight_g_m2` | integer | > 0 | towels, bed linen, throws (grams per m²) |
| `weave` | enum | `percale`, `sateen`, `jersey`, `flannel`, `terry`, `waffle`, `velvet`, `plain` | home textiles |
| `opacity` | enum | `sheer`, `translucent`, `dimout`, `blackout` | curtains |
| `curtain_heading` | enum | `eyelets`, `pleats`, `hooks`, `rod_pocket`, `tab_top`, `wave` | curtains |
| `rug_construction` | enum | `hand_knotted`, `hand_tufted`, `hand_woven`, `machine_woven`, `tufted`, `flatweave`, `shaggy` | rugs |
| `non_slip` | boolean | | rugs, mats |
| `underfloor_heating_suitable` | boolean | | rugs |
| `light_source_included` | boolean | | lighting |
| `light_source_replaceable` | enum | `by_user`, `by_professional`, `not_replaceable` | lighting (Reg. 2019/2020 requires the information) |
| `dimmable` | boolean | | lighting, light sources |
| `smart_control` | boolean | | lighting, light sources |

Sport:

| Key | Type | Values | For |
|---|---|---|---|
| `sports` | list | `running`, `trail_running`, `walking`, `hiking`, `cycling`, `fitness`, `yoga`, `swimming`, `football`, `tennis`, `padel`, `hockey`, `basketball`, `volleyball`, `golf`, `skiing`, `snowboarding`, `climbing`, `watersports`, `outdoor`, `other` | all sport articles |
| `skill_level` | enum | `beginner`, `intermediate`, `advanced` | equipment |
| `surface` | list | `road`, `trail`, `track`, `indoor_court`, `clay`, `grass`, `firm_ground`, `soft_ground`, `artificial_grass`, `turf`, `snow`, `water` | shoes, balls |
| `support` | enum | `neutral`, `stability` | running shoes |
| `cushioning` | enum | `minimal`, `moderate`, `high` | sport shoes |
| `shoe_width` | enum | `narrow`, `regular`, `wide`, `extra_wide` | all shoes |
| `impact_support` | enum | `low`, `medium`, `high` | sports bras |
| `upf` | integer | `15`–`50` (50 = 50+) | clothing (EN 13758-2, voluntary) |
| `reflective` | boolean | | clothing, shoes, bags |
| `hydrostatic_head_mm` | integer | > 0 | waterproof clothing, tents (ISO 811) |
| `breathability_g_m2_24h` | integer | > 0 | clothing (the brand states the method in `attributes`) |
| `fill_power` | integer | > 0 | down jackets and duvets (cubic inches per ounce, as stated) |
| `lens_filter_category` | integer | `0`–`4` | sunglasses, sport glasses, goggles (EN ISO 12312-1) |

New **values** for existing registry keys (additive):

- `fit`: `compression`, `athletic`.
- `detachable_parts`: `cover` (a removable, washable cover), `cushions`, `legs`, `shade`.
- `adjustable_parts`: `height`, `backrest`, `armrests`, `headrest`, `seat_depth`, `lumbar_support`.
- `closure`: (no change; cushion and duvet covers use the existing values).

### 5. Product: assembly, documents and care

- **Assembly** is described by the features above (`assembly_required`, `assembly_persons`,
  `assembly_time_minutes`, `tools_included`, `wall_fixing`). The instructions themselves are a
  document.
- **Documents.** Assembly instructions, user manuals, PPE instructions, the EU declaration of
  conformity, the product information sheet of a light source and safety information are files
  a retailer needs, often must pass on, and usually gets as PDFs. Proposed: assets with the new
  `media_type` **`document`** (`content_type` `application/pdf`), a `document_type`
  (`assembly_instructions`, `user_manual`, `safety_information`, `declaration_of_conformity`,
  `product_information_sheet`, `energy_label`, `care_instructions`, `warranty`, `other`) and a
  `language` (BCP 47, `null` = multilingual). They have only the `original` rendition. Consumers
  written for 0.1 and 0.2 already MUST ignore assets with an unknown media type
  ([protocol.md §5.4](../protocol.md#54-asset)), so this is additive. Images keep their rules.
- **Care** stays an ordered list of codes. New RECOMMENDED codes outside ISO 3758 for products
  that are not washed: `wipe_damp_cloth`, `wipe_dry_cloth`, `spot_clean`, `vacuum`,
  `do_not_use_abrasives`, `treat_with_oil`, `treat_with_wax`, `avoid_direct_sunlight`,
  `keep_away_from_heat`, `air_regularly`, `turn_regularly`, `professional_cleaning`,
  `store_dry`. ISO 3758 codes stay the only codes for textiles' labels. New optional **`part`**
  on a care entry (a part key from `materials` or `component_materials`; absent = the whole
  product), because a cushion's cover is washed at 40 °C and its filling is not:

  ```json
  "care": [
    { "code": "wash_40", "part": "cover" },
    { "code": "do_not_tumble_dry", "part": "cover" },
    { "code": "spot_clean", "part": "filling" }
  ]
  ```

### 6. Product: safety (GPSR), PPE, standards and substances

New optional **`safety`** object on the product, and the same object as a default on the
**brand** (most brands have one manufacturer and one EU responsible person). A product's value
replaces the brand's as a whole; consumers read the product's, then the brand's.

```json
"safety": {
  "manufacturer": {
    "name": "Kestrel Outfitters B.V.",
    "address": "Voorbeeldstraat 1, 1234 AB Utrecht, NL",
    "email": "safety@kestrel.example",
    "url": "https://kestrel.example/safety"
  },
  "responsible_person": null,
  "warnings": [
    { "code": "wall_fixing_required",
      "text": { "en": "To prevent tipping over, this furniture must be fixed to the wall.",
                "nl": "Om omvallen te voorkomen moet dit meubel aan de muur worden bevestigd." } }
  ]
}
```

- `manufacturer` and `responsible_person`: `name`, `address` (one postal address as text),
  `email` and/or `url` (GPSR asks for a postal and an electronic address). `responsible_person`
  is `null` when the manufacturer is established in the EU.
- `warnings`: an ordered list; `text` (localised) is the warning as it must be shown, `code` an
  optional key from an open vocabulary for filters and icons (RECOMMENDED: `wall_fixing_required`,
  `adult_assembly_required`, `not_suitable_for_children_under_36_months`, `keep_away_from_fire`,
  `outdoor_use_only`, `indoor_use_only`, `max_load`, `do_not_leave_unattended`,
  `use_under_adult_supervision`, `not_a_toy`, `contains_small_parts`). The text is authoritative;
  OBX does not generate warnings from codes.

New optional **`ppe`** object (protective equipment only, `null` otherwise):

```json
"ppe": {
  "category": "II",
  "standards": ["EN 1078:2012+A1:2012"],
  "notified_body": "0123",
  "declaration_of_conformity_url": "https://kestrel.example/doc/KT-2101.pdf"
}
```

`category` is `I`, `II` or `III` (Reg. 2016/425, Annex I). `notified_body` is the four-digit
number next to the CE mark (category III, and II where one was involved), or `null`. The
declaration can also be a `document` asset; the URL is what Art. 8(9) allows in the instructions.

New optional **`standards`**: the voluntary standards the brand states the product meets, as
written (`["EN 12520:2015", "EN 1022:2018"]`). Like certifications, the node passes on what the
brand states and checks nothing.

New optional **`svhc`**: substances of very high concern above 0.1 % w/w, as REACH Art. 33
requires the brand to tell the retailer:

```json
"svhc": [ { "substance": "Bis(2-ethylhexyl) phthalate (DEHP)", "ec_number": "204-211-0", "cas_number": "117-81-7", "part": "base" } ]
```

`[]` means the brand states there is none above the threshold; `null` means not stated.

New RECOMMENDED `certifications.scheme` keys: `pefc`, `eu_ecolabel`, `nordic_swan`,
`oeko_tex_made_in_green` (exists), `oeko_tex_step`, `cradle_to_cradle`, `blauer_engel`,
`downpass`, `idfl`, `certipur`, `fairtrade`.

### 7. Variant: lighting and energy label

Light sources and luminaires vary per variant (2700 K and 4000 K are different models with
different EPREL registrations), so these live on the variant:

```json
"energy_label": {
  "energy_class": "D",
  "eprel_registration_number": "1234567",
  "regulation": "2019/2015"
},
"lighting": {
  "luminous_flux_lm": 806,
  "power_w": 5.9,
  "colour_temperature_k": 2700,
  "colour_rendering_index": 90,
  "beam_angle_deg": null,
  "lamp_base": "E27",
  "light_sources": 1,
  "contained_energy_class": null,
  "ip_rating": "IP20"
}
```

- `energy_label` (light sources, and later other labelled products): `energy_class` `A`–`G`,
  `eprel_registration_number` (the label and the product information sheet can be fetched from
  EPREL with it; the label image MAY also be a `document` or image asset with `document_type`
  `energy_label`), `regulation` (the delegated regulation the class is under).
- `lighting`: `luminous_flux_lm`, `power_w` (on-mode power), `colour_temperature_k`,
  `colour_rendering_index`, `beam_angle_deg` (directional light sources), `lamp_base` (open
  vocabulary as printed: `E27`, `E14`, `GU10`, `G9`, `GU5.3`, `integrated`), `light_sources`
  (number of light sources a luminaire takes or contains), `contained_energy_class` (luminaires
  with a light source included: the class the manual must state), `ip_rating` (IEC 60529,
  `IP20`, `IP44`, `IP65`).

## In the CSV (import format)

One plain column per field, as in 0.2:

| Column | Example |
|---|---|
| `component_materials` | `frame: solid_wood oak (oiled); legs: steel (powder_coated); top: veneer oak on mdf (lacquered)` |
| `length_cm`, `seat_height_cm`, `seat_depth_cm`, `seat_width_cm`, `armrest_height_cm`, `width_extended_cm`, `mattress_width_cm`, `mattress_length_cm`, `mattress_height_max_cm`, `pile_height_cm`, `fill_weight_kg`, `diameter_cm`, `cable_length_cm`, `max_load_kg`, `max_user_weight_kg`, `drop_mm`, `stack_height_mm` | numbers, per variant row |
| `height_adjustable_cm`, `head_circumference_cm` | `42-53`, `54-58` (as `strap_length_cm`) |
| `packages` | `205x62x12 48.5; 105x55x8 21` (centimetres `x`-separated, then the gross weight in kg; one package per `;`) |
| `feature:<key>` | `feature:seats` = `3`, `feature:sports` = `running\|trail_running` |
| `care` (existing) | `wash_40@cover\|do_not_tumble_dry@cover\|spot_clean@filling` (`@part` optional) |
| `safety_manufacturer`, `safety_responsible_person` | `Kestrel Outfitters B.V.; Voorbeeldstraat 1, 1234 AB Utrecht, NL; safety@kestrel.example` (name; address; email or url) |
| `safety_warnings`, `safety_warnings:<lang>` | `wall_fixing_required: To prevent tipping over, …` (entries separated by `\|`) |
| `ppe` | `II; EN 1078:2012+A1:2012; 0123; https://kestrel.example/doc/KT-2101.pdf` |
| `standards` | `EN 12520:2015\|EN 1022:2018` |
| `svhc` | `none`, or `DEHP 204-211-0 117-81-7 @base` (entries separated by `\|`) |
| `energy_class`, `eprel_registration_number` | `D`, `1234567` (per variant row) |
| `luminous_flux_lm`, `power_w`, `colour_temperature_k`, `colour_rendering_index`, `beam_angle_deg`, `lamp_base`, `light_sources`, `contained_energy_class`, `ip_rating` | per variant row |

The brand-level `safety` default is set in the node's admin or through the Ingest API's brand
upsert; a CSV row only overrides it per product. Documents arrive like images, named
`{style}_{ALL|color}_{position}_{document_type}.pdf` (`KH-3001_ALL_1_assembly_instructions.pdf`),
with `language` in `assets.csv`.

## Label completeness warnings (rule 10, extended)

New stable warning codes; like 0.2's, they never block publishing:

| Code | When | Why (legal basis) |
|---|---|---|
| `fibre_composition_missing` (extended) | also for `home_textile`, `bedding` (except subtype `mattress`), the apparel keys `sports_bra`, `base_layer`, `tracksuit`; for `rug` and `mattress` when there is no part `pile` or `cover` | Reg. 1007/2011 Art. 2(2), 9, 11, 16(1) |
| `animal_origin_unknown` (extended) | the same item types, with `down` or `feather` in `materials` | Reg. 1007/2011 Art. 12 |
| `manufacturer_missing` | any product without `safety.manufacturer`, on the product or the brand | GPSR Art. 19(a) |
| `energy_class_missing` | a `light_source` variant without `energy_label.energy_class` | Del. Reg. (EU) 2019/2015 |
| `ppe_category_missing` | a `protective_equipment` product, or an `eyewear` product with subtype `sunglasses` or `sport_glasses`, without `ppe.category` | Reg. (EU) 2016/425 |

`manufacturer_missing` applies to every item type, also the 0.2 ones; open decision 3 asks
whether it should start as opt-in.

## Compatibility with 0.2

- **Additive only.** Every new field is optional and `null` when not stated; new item types,
  subtypes, feature keys, feature values, part keys, care codes, certification schemes and
  warning codes are new vocabulary. A 0.2 document is a valid 0.3 document.
- **0.2 consumers** keep working: they MUST ignore unknown properties, unknown feature keys and
  assets with an unknown `media_type` ([protocol.md §2, §5.4](../protocol.md#2-conventions)).
  Strict validation against the 0.2 schemas fails on 0.3 objects, as 0.1 schemas did on 0.2;
  that is why schemas are versioned per minor (`/schemas/v0.3/`).
- **0.2 nodes** ignore unknown fields on write. One caveat: a 0.2 node MUST reject a registry key
  with a value outside its 0.2 values, so a brand that sends `fit: compression` or
  `adjustable_parts: ["height"]` to a 0.2 node gets `422 validation_failed`. Tooling (`obx push`)
  should check the node's `spec_version` before sending new values of existing keys.
- **Brand** gains `safety`; an older consumer ignores it.
- No renames, no changed meanings. The one clarification of existing meaning (shoe weight is one
  shoe) fills a gap 0.2 left open.

## Conformance test ideas

- **P-CAT-7** (article data round trip for home and sport): `GET /products/{id}` of the new
  fixtures matches `expected/product-*.json`, including `component_materials` order,
  `packages` order, `height_adjustable_cm` as `{min, max}`, `safety` on the product and the
  brand default on a product without its own, `ppe`, `svhc: []` vs `null`, variant
  `energy_label` and `lighting`.
- **P-CAT-8** (shape): every product has `component_materials`, `safety`, `ppe`, `standards`,
  `svhc`; every variant `packages`, `energy_label`, `lighting` (each possibly `null`); no empty
  `packages` list; every care `part` is a part key of the product.
- **P-MEDIA-4** (documents): a `document` asset has `content_type` `application/pdf`, a
  `document_type`, only the `original` rendition, and bytes identical to the fixture; a 0.2
  client ignoring it is unaffected (it never counts towards image positions).
- **I-IMP-9** (CSV columns): import, re-export and re-import of every new column gives
  identical objects; `packages` grammar errors (`205x62 48.5`, a negative weight) are
  `validation_failed` for the row; `height_adjustable_cm` `53-42` is `validation_failed`.
- **I-IMP-10** (warnings): a `home_textile` without `materials`, a duvet with `down` and no
  `contains_animal_origin`, a `light_source` without class, a helmet without PPE category, and a
  product with no manufacturer on it or its brand each give exactly their warning; the new
  fixtures give none.
- **I-ING-x**: sending a 0.3 feature value to a node that advertises `spec_version` 0.2 gives
  `422`; the same to a 0.3 node is `created`.

## Fixture ideas (fictional, Kestrel style)

A third fictional brand **Kestrel Home** (`kestrel-home`, style prefix `KH-`) next to Kestrel and
Kestrel Trail, so the brand-restricted retailer test also covers it; sport goes to Kestrel Trail
(`KT-`). GTINs stay in the restricted-circulation prefix `200`.

| Style | Product | Exercises |
|---|---|---|
| KH-3001 | Oak Dining Table, extendable, 160 and 200 cm | `furniture`/`dining_table`, `component_materials` (solid oak, steel legs), `width_extended_cm`, two `packages`, `assembly_*`, `certifications` `fsc` (material), `care` `treat_with_oil` |
| KH-3002 | Bouclé Three-Seater Sofa, left and right | `furniture`/`corner_sofa`, `materials` part `upholstery`, `seat_height_cm`, `seat_depth_cm`, `seats`, `orientation`, `detachable_parts: ["cover"]`, `standards` EN 12520, three packages |
| KH-3003 | Bookcase 80 × 200 | `wall_fixing: required`, `safety.warnings` `wall_fixing_required` (nl + en), `max_load_kg`, assembly instructions as a `document` asset |
| KH-3004 | Down Duvet, 140 × 200 and 240 × 220 | `bedding`/`duvet`, `materials` `cover: 100% cotton; filling: 90% down, 10% feather`, `contains_animal_origin: true`, `fill_weight_kg`, `warmth`, `fill_power`, `certifications` `downpass` |
| KH-3005 | Percale Fitted Sheet, three mattress sizes | `home_textile`/`fitted_sheet`, `mattress_width_cm`, `mattress_length_cm`, `mattress_height_max_cm`, `thread_count`, `weave: percale` |
| KH-3006 | Wool Rug 160 × 230 and 200 × 300 | `rug`, `materials` `pile: 100% wool; backing: 100% cotton`, `pile_height_cm`, `rug_construction: hand_tufted` |
| KH-3007 | Linen Cushion with feather inner | care with `part` (`wash_40@cover`, `spot_clean@filling`), `animal_origin_unknown` NOT given (stated `yes`) |
| KH-3008 | Opal Glass Pendant Lamp | `lighting`/`pendant`, `cable_length_cm`, `lamp_base: E27`, `light_source_included: false`, `light_source_replaceable: by_user`, `ip_rating` |
| KH-3009 | LED Filament Bulb E27, 2700 K and 4000 K | `light_source`/`bulb`, `energy_label` per variant (two EPREL numbers), `luminous_flux_lm`, `dimmable`, a manufacturer outside the EU with a `responsible_person` |
| KT-2101 | Trail Cycling Helmet, S/M and M/L | `protective_equipment`/`helmet`, `ppe` category II with EN 1078, `head_circumference_cm`, declaration of conformity as a `document` |
| KT-2102 | Trail Running Shoe | `shoes`/`trail_running`, `footwear_materials`, `drop_mm`, `stack_height_mm`, `surface: ["trail"]`, `cushioning`, `sports`, `weight_kg` of one shoe |
| KT-2103 | High-Support Sports Bra | `sports_bra`, `impact_support: high`, `fit: compression`, `materials` with `elastane` |
| KT-2104 | Cork Yoga Mat | `fitness_equipment`/`mat`, `length_cm`, `component_materials` cork + `rubber`, `non_slip`, `svhc: []` |
| KT-2105 | Sport Sunglasses | `eyewear`/`sport_glasses`, `lens_filter_category: 3`, `ppe` category I without notified body |

Plus `fixtures/imports/` files for I-IMP-9 and I-IMP-10, and `label-warnings.csv` rows for the
new codes. Existing products (KO-*, KT-2001, KT-2002) do not change, except that the brand
Kestrel gets a `safety` default so that `manufacturer_missing` is not raised for the 0.2 fixtures.

## Rollout (one release of everything, as 0.2)

1. **spec 0.3.0**: schemas (`ComponentMaterials`, `Packages`, `Safety`, `Ppe`, `Svhc`,
   `EnergyLabel`, `Lighting`; extended `Measurements`, `Features`, `Care`, `Asset`, `Brand`),
   protocol §5.9 and import-format text, Excel templates, fixtures, conformance tests.
2. **obx-go 0.3.0**: types, CSV import/export, `obx push` version check, conformance suite,
   mock node.
3. **admin-ui 0.3.0**: show and edit the new fields, the brand's safety default, documents.
4. **node-go, node-php, node-ts 0.3.0**: storage, import, API, `document` assets.
5. **website**: the label page gets the home and sport rows; developer docs.
6. **Photopilot** (its own repository): map its supplier data onto the new fields (see
   "Sources").

## Open decisions for the owner

Each with a recommendation; the draft above follows the recommendations.

1. **Item types for home: several keys or one `home` with subtypes?** Recommendation: several
   (`furniture`, `bedding`, `home_textile`, `rug`, `lighting`, `light_source`, `decoration`),
   because label rules and filters differ per key, as for `luggage` in 0002; `home` stays as a
   catch-all.
2. **How is "sport" marked: the feature `sports`, a top-level field, or sport item types?**
   Recommendation: the feature `sports` (a list) on ordinary apparel and shoe types, plus item
   types only for equipment, which has no fashion equivalent today (it falls on
   `generic_product`).
3. **`manufacturer_missing` for every item type, including the 0.2 ones?** Recommendation: yes;
   GPSR Art. 19 applies to every consumer product sold online, and the warning never blocks.
   The brand-level `safety` default makes it one entry for most brands.
4. **GPSR `safety` in this proposal, or a separate cross-category proposal 0004?**
   Recommendation: in 0003; home and sport (tip-over, PPE, candles) are where warnings matter
   most, and splitting would ship the warnings field after the products that need it.
5. **Documents as `document` assets on the node, or as links?** Recommendation: assets, so
   instructions and declarations travel with hash, rights and the change feed like images, and
   do not rot; 0.2 consumers already ignore an unknown `media_type`.
6. **Non-textile materials: a new `component_materials`, or `materials` with optional
   percentages?** Recommendation: a new field; `materials` stays the legally defined fibre
   composition with mandatory percentages, so 0.2 consumers' assumptions hold.
7. **Packages: a list of boxes, or a count plus total size and weight?** Recommendation: a list;
   the count is its length, and carriers price per box.
8. **Millimetres for sport shoes (`drop_mm`, `stack_height_mm`), breaking 0.2's cm-only habit?**
   Recommendation: yes; the unit stays in the name and the trade quotes these in mm, so `0.8` cm
   would only invite mistakes.
9. **Care: non-ISO codes for hard goods, and an optional `part` per care entry?**
   Recommendation: yes to both; ISO 3758 codes remain the only codes for textile labels.
10. **Lighting and energy data: variant objects `lighting` and `energy_label`, or feature keys?**
    Recommendation: variant objects; the energy class is legal information that differs per
    variant (each colour temperature has its own EPREL registration).
11. **`svhc` and `standards` now or later?** Recommendation: now; REACH Art. 33(1) obliges the
    brand to tell the retailer, which is exactly what OBX carries, and `standards` is a plain
    list of strings that costs nothing.
12. **0.2 erratum: "travel goods of textile materials" are exempt from fibre labelling (Annex V,
    item 17), yet 0.2 warns `fibre_composition_missing` for `bag`, `backpack` and `luggage`.**
    Recommendation: correct the legal wording in a 0.2.x patch now, and stop the warning for
    `luggage` and travel bags in 0.3 (composition stays recommended).
13. **Fixtures: a new fictional brand Kestrel Home (`KH-`), or home products under Kestrel?**
    Recommendation: a new brand, so the brand-restricted retailer test also covers a third brand;
    sport goes to Kestrel Trail (`KT-21xx`).
14. **An optional `fedas_code` next to `gpc_brick`?** Sport retailers' ERPs classify with the FEDAS
    product classification key, and Photopilot sees it in fashion and sport feeds.
    Recommendation: not in 0.3; use `attr:fedas_code` until the licence terms of the FEDAS key
    are checked, then decide.

## Sources

- Regulation (EU) No 1007/2011 on textile fibre names and labelling, Art. 2(2) (furniture,
  mattress and floor-covering coverings), Art. 12, Art. 16(1), Annex V (items 17 and 31).
- Directive 94/11/EC on footwear labelling.
- Regulation (EU) 2023/988 on general product safety (GPSR), Art. 9, 16 and 19.
- Regulation (EU) 2017/1369 (energy labelling framework); Commission Delegated Regulation (EU)
  2019/2015 (energy labelling of light sources), Art. 3–4, Annex V and VIII; Commission Regulation
  (EU) 2019/2020 (ecodesign for light sources), Annex II.
- Regulation (EU) 2016/425 on personal protective equipment, Art. 8(9), Annex I and II;
  EN 1078 (bicycle helmets), EN 1077 (ski helmets), EN 174 (ski goggles), EN ISO 12312-1
  (sunglasses).
- Regulation (EC) No 1907/2006 (REACH), Art. 33.
- Regulation (EU) 2023/1115 (EUDR); Regulation (EU) 2024/1781 (ESPR); Regulation (EC) No 66/2010
  (EU Ecolabel).
- Voluntary standards: EN 12520, EN 1335, EN 581, EN 14749, EN 747, EN 597, EN ISO 20957,
  EN 13758-2, ISO 811, IEC 60529.
- Photopilot (the founder's company, its own repository) was searched for the home and sport
  fields brands and retailers actually exchange. What it showed, and what it informed:
  - Its **brand portal scraper** covers sport brands (Reusch, Peak Performance, LOWA, LEKI,
    Deuter, Tecnica, Head, Tenson, Icepeak, Rukka, Luhta, Julbo, Björn Borg) but harvests images
    only; there are no product attributes in those portals' feeds. This is why the proposal says
    the data gap is real, and why `document` assets matter (portals hold PDFs and images, not data).
  - A **sport retailer's onboarding** notes that rackets, balls, skis and skates have no item type
    and fall on `generic_product`: the `sports_equipment` and `fitness_equipment` item types and
    subtypes (`skates`, `ski_poles`).
  - A **retail ERP's department code "Sport"** on thousands of articles: marking sport as a
    classification across item types (feature `sports`).
  - A retail ERP's **extra components** on bags and luggage (width, height, depth, weight, volume,
    warranty period, water resistance "waterproof"/"water repellent", closure, recycled, fairtrade):
    the reuse of 0.2's measurements and `water_resistance`, the new `commercial_warranty_years`
    and the `fairtrade` certification key.
  - A **content preset for water resistance that mentions the water column**: `hydrostatic_head_mm`.
  - A **furniture trial page** typed in from a manufacturer's price list (a sofa: seat height
    45 cm, width/depth/height, HR foam fillings with densities 45, 40 and 25 kg/m³, polished
    aluminium legs, upholstery options in fabric and faux leather): `seat_height_cm`,
    `component_materials` with `density_kg_m3`, the part keys `legs` and `upholstery`.
  - Photopilot's **own filter vocabulary for home** (derived from images, not from feeds): lamp
    fitting (E27, E14, GU10, G9, integrated LED) and number of light points, chair upholstery and
    leg material, table shape and number of seats, rug material: `lamp_base`, `light_sources`,
    part `upholstery`, `legs`, `shape`, `seats`.
  - A **bathroom and lighting retailer's titles** carrying "3x6,5W 2700K": power and colour
    temperature per light source as numbers (`power_w`, `colour_temperature_k`, `light_sources`).
  - Its **normalised import model** for webshop and ERP connectors (dimensions in cm, materials
    per part with percentage, care symbols, typed specs with a unit, no weight, packages or
    assembly): fixed units in the key, and that packages and assembly are new.
  - Photopilot also maps a commercial fashion platform's feed. Following 0002, no field name in
    this proposal is taken from it or from any other vendor's API; the names come from the
    regulations, standards and plain English.
