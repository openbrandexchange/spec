# Vocabularies: adding a code

The codes that `materials` and `care` use, and their names per language, live in [`vocabularies/`](../vocabularies) as data: `parts.json`, `materials.json`, `qualifiers.json` and `care.json`. The schemas only say that a part, material, qualifier or care instruction is a term `{code, name}` ([protocol.md §5.9.1](protocol.md#composition)). So the list grows without a schema change, and every node returns the same name for the same code.

## What a node does with codes

- **Known code** (in the vocabulary): the node returns the vocabulary's name (and, for care, category and symbol). A node with its own reviewed translations MAY return those.
- **Unknown code**: always accepted. The node stores it and returns the name it was given on write, or `null`. Consumers fall back to the code. A brand can therefore use a new claim the day it needs it; the vocabulary catches up later.
- Codes are lowercase with `_` (`post_consumer`). The import lowercases and turns spaces and `-` into `_`.

## Qualifiers: claims about a fibre

A fibre has a list of qualifiers, in the brand's order: `95% cotton (organic) (regenerative)`, `100% polyester (recycled) (post_consumer)`. Today's codes:

| code | meaning |
|---|---|
| `organic` | grown organically (e.g. certified to GOTS or OCS) |
| `in_conversion` | organic in conversion: grown organically on land that is still in its conversion period |
| `recycled` | made from recycled material |
| `pre_consumer` | the recycled content comes from production waste |
| `post_consumer` | the recycled content comes from used products |
| `regenerative` | grown with regenerative agriculture |

A qualifier is a claim the brand can prove; proof (a certificate) goes in `certifications` with the scope `material`.

## Adding a code

1. Open a pull request on the `spec` repository that adds the entry to the right `vocabularies/*.json` file: `code`, and `name` in at least English (`en`). Dutch, German and French are welcome; a missing language is left out, never an empty string. Care entries also need `category` and `symbol` (`null` when the GINETEX notation has no code).
2. Explain in the pull request what the code means and where it comes from (a regulation, a certification scheme, a data pool), and why an existing code does not cover it.
3. `bun run check` must pass (it validates the vocabularies and regenerates the website copy and the Excel templates' lists).
4. A new code is a **minor** change ([versioning.md](versioning.md)): nodes that do not know it yet keep working, because unknown codes are always accepted.

Renaming or removing a code is a breaking change; mark it as deprecated in the pull request instead and keep it in the file.

## In the reference implementations

The nodes (node-go, node-php, node-ts) and the admin UI embed a copy of `vocabularies/` at build time. After a release with new codes they pick up the names with their next version; until then the new code is an unknown code, as above.
