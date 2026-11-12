# Proposal 0004: materials and care as terms with names (spec 0.3)

Status: **accepted** 2026-11-12 · **breaking** (pre-1.0 minor, [versioning](../versioning.md)), implemented in spec **0.3.0** ([changelog](../../CHANGELOG.md))

## Why

In 0.2 a composition is a list of bare keys: `{"part": "lining", "fibers": [{"fiber": "polyester", "percentage": 100, "recycled": true}]}`, and care is `{"code": "wash_30", "text": null}`. Every consumer that shows a label to a person has to translate `lining`, `polyester` and `wash_30` itself, in every language, and each one does it differently. A brand's own wording never reaches the shop. Recycled and organic are two booleans, so a third claim (regenerative agriculture) needs a new field, and a fibre cannot be both a code and something a person reads.

Goals:

1. **A term is a code and a name.** Machines match on the stable `code`; people read the `name` per language. Consumers no longer need their own translation tables.
2. **One vocabulary, in the spec.** The codes and their names are machine-readable files in [`vocabularies/`](../../vocabularies), so every node returns the same name for the same code.
3. **Open for more.** The qualifier of a fibre is a term, so `regenerative` (and later claims) need no schema change. Unknown codes stay allowed.

## The shapes

```json
"materials": [
  {"part": {"code": "main", "name": null},
   "fibers": [
     {"material": {"code": "cotton", "name": {"en": "Cotton", "nl": "Katoen", "de": "Baumwolle", "fr": "Coton"}},
      "percentage": 95,
      "qualifier": {"code": "organic", "name": {"en": "Organic", "nl": "Biologisch", "de": "Bio", "fr": "Biologique"}}},
     {"material": {"code": "elastane", "name": {"en": "Elastane", "nl": "Elastaan", "de": "Elastan", "fr": "Élasthanne"}},
      "percentage": 5, "qualifier": null}]},
  {"part": {"code": "lining", "name": {"en": "Lining", "nl": "Voering", "de": "Futter", "fr": "Doublure"}},
   "fibers": [{"material": {"code": "polyester", "name": {"en": "Polyester", "nl": "Polyester", "de": "Polyester", "fr": "Polyester"}},
               "percentage": 100,
               "qualifier": {"code": "recycled", "name": {"en": "Recycled", "nl": "Gerecycled", "de": "Recycelt", "fr": "Recyclé"}}}]}
],
"care": [
  {"code": "wash_30", "category": "washing", "symbol": "1_D_30",
   "name": {"en": "Wash at 30 °C", "nl": "Wassen op 30 °C", "de": "Waschen bei 30 °C", "fr": "Lavage à 30 °C"},
   "text": null}
]
```

- `part`, `material` and `qualifier` are terms `{code, name}` (`$defs/term` in [Materials.json](../../schemas/Materials.json)). `name` is a [LocalizedText](../../schemas/LocalizedText.json): a language without a name is omitted, never an empty string. `main` has the name `null` (a label shows its fibres without a heading).
- `percentage` stays a number. `qualifier` is `null` when the fibre has none.
- A care entry gets `category` (the ISO 3758 symbol group: `washing`, `bleaching`, `drying`, `ironing`, `professional_care`), `symbol` (the symbol code in the GINETEX notation fashion data pools exchange, e.g. `1_C_40`, or `null`) and `name`. `text` stays, now only for the brand's own extra text ("Wash inside out").
- **Where the names come from.** For a code in the vocabulary a node returns the vocabulary's category and symbol, and its name unless it has its own reviewed translations (SHOULD). For another code it returns the name (category, symbol) it was given on write, or `null`. On write paths `name`, `category` and `symbol` may be left out.

## Compatibility

Breaking. A 0.2 consumer that reads `part` as a string, or `fiber`, `recycled` and `organic`, breaks on a 0.3 node. There are no 0.1 or 0.2 publishers outside the reference implementations, which all move to 0.3 together; only 0.3 is supported. 0.1 and 0.2 are withdrawn (never used); their schemas are removed from `main` and the website and stay in the git tags. A node that upgrades expires every cursor it issued before (`410 cursor_expired`), so a consumer that kept a 0.2 cursor restarts with a snapshot in the 0.3 shapes; consumers need no new code for that. The import CSV is unchanged apart from the qualifier: `100% cotton (organic)` and the 0.1 keys `organic_cotton`/`recycled_polyester` keep working.

**Migration for a consumer:** read `part.code`, `fibers[].material.code`, `fibers[].qualifier.code` (instead of `part`, `fiber`, `recycled: true`, `organic: true`) and show the `name` in the shopper's language. **For a node:** store the qualifier code per fibre (`recycled: true` → `recycled`, `organic: true` → `organic`), and fill names, categories and symbols from `vocabularies/`.

## Decisions

1. One qualifier per fibre. A fibre that is both organic and recycled is rare and not a label claim; a brand states the one it can prove.
2. Names in four languages (en, nl, de, fr) to start; more languages are added to the vocabulary without a spec change.
3. `symbol` is informative: ISO 3758 does not define string codes, and the fashion data pools' GINETEX notation is what retailers' systems already map to pictograms. It is `null` where that notation has no code.
