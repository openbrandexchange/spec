# Proposal 0010: language selection (spec 0.4)

Status: **draft** 2026-11-27 · non-breaking (additive), target spec **0.4.0** · open for comments for at least 14 days ([governance](../governance.md#process))

Discussion: to be opened in [Discussions](https://github.com/openbrandexchange/spec/discussions) when this draft is published for comments.

## Why

Every localised field in OBX carries every language the node has: `{"nl": "Trui", "en": "Sweater", "de": …}`, and the term names of `materials` and `care` come in all four vocabulary languages. A German shop then has to pick the German text out of every map itself, and when there is none it has to decide on its own what to show. Two shops make that choice differently, and neither can tell its buyers *which* texts are missing a translation, because the response does not say what the node would have served.

Retailers also ask the opposite: a PIM or ERP that maps materials and care codes in its own system wants **codes only**, without names in any language.

Goals:

1. **One request, one language.** A consumer asks for `de` and gets every localised field in German where the node has it.
2. **Never a silent fallback.** Where a field has no German text the node serves another language, and says so per field. A node never translates on the fly.
3. **Codes only** for systems that map codes (`universal`).
4. **Additive.** A 0.3 consumer that asks for nothing gets the 0.3 response.

## Decisions

1. **A query parameter, with `Accept-Language` as the fallback.** `?lang=<BCP 47 tag>` on the read endpoints that return brands, products or assets, and on `/changes`; `lang` in an ExportRequest. Without `lang`, the node uses `Accept-Language` (first range by `q` that it can serve). The header alone never narrows a response to a language the node does not have: when no range matches, the response is the 0.3 response, so HTTP clients that send a default `Accept-Language` keep every language. An explicit `lang` always selects (rule 3).
2. **The node's languages are discoverable.** Discovery gets `selectable_languages`: the content `languages` (first = default) followed by languages the node only has term names for. With the shared vocabularies that is `nl, en, de, fr` for a node whose content is in `nl, en`.
3. **Selection is a lookup, the default is the floor.** `lang` is matched by RFC 4647 lookup (`de-CH` → `de`, `en-GB` → `en`). A tag the node has nothing for selects the default language, and `Content-Language` says so; the consumer asked for Japanese and sees it got Dutch.
4. **The shape stays LocalizedText, with one member.** Each localised field keeps its object form and holds exactly the language it is served in. A consumer written for 0.3 keeps working; the key itself already names the language of the text.
5. **Per field fallback: default, other content languages, the rest.** A node MUST serve the selected language where the field has it (stored text or vocabulary name). Otherwise the default language, then the other content languages in order, then whatever the field has (byte order). `language_fallbacks` on every Brand, Product, Variant and Asset maps the JSON Pointer of each field that fell back to the tag it is served in (`{"/name": "nl", "/color/name": "nl"}`), `{}` when none did. A node MUST NOT machine-translate at request time: a translation the brand did not make is not content the brand published.
6. **`Content-Language` names the selected language.** One header for the response; `language_fallbacks` gives the exceptions. No selection: no header and no `language_fallbacks` member.
7. **`universal` is codes only.** Term names in `materials` and `care` are `null`; codes and enumerations are what they always were. Free texts (name, description, colour name, alt text) have no code; they are served as for the default language, which is then the `Content-Language`.
8. **The feed is the same feed.** `lang` shapes `data` only. Cursors, sequence numbers, order and the snapshot do not depend on it, so a consumer can change its language without a resync of its cursor (it SHOULD still re-read the objects it stored in the old language, for example with a fresh snapshot).
9. **Caching.** `Vary: Accept-Language` on every endpoint that honours the header; the `ETag` of a product depends on the selection.
10. **CSV export (import format).** A node MAY offer its portal CSV in one language: the `:<lang>` columns of the selected language only, plus a final `language_fallbacks` column (`name:de=nl|color_name:de=nl`). An import ignores that column.

## Normative text

In this pull request: [protocol.md §2.3](../protocol.md#language-selection), the capability `language_selection` (§3), §7; [import-format.md §1.2](../import-format.md) (CSV export); schemas `Common.json#/$defs/LanguageFallbacks`, `language_fallbacks` on `Brand`, `Product`, `Variant` and `Asset`, `selectable_languages` on `DiscoveryDocument`, `lang` on `ExportRequest`; the `lang` and `Accept-Language` parameters and the `Content-Language` header in [obx-protocol.yaml](../../openapi/obx-protocol.yaml).

## Conformance

Test data: [`fixtures/expected/language-selection.json`](../../fixtures/expected/language-selection.json), ten requests to MN-1001 with the expected `Content-Language`, `language_fallbacks` and sample fields. `bun run check` recomputes each case from `expected/product-MN-1001.json`, so the fixture and the rule cannot drift apart.

- **P-LANG-1** `lang`: a content language (`en`), a region of one (`en-GB` → `en`), a term-only language (`DE_ch` → `de`: terms German, name, description and colour name Dutch and listed in `language_fallbacks`), an unknown tag (`ja` → `nl`, no fallbacks), `lang` over `Accept-Language`, and a malformed tag → `400 invalid_request`.
- **P-LANG-2** `Accept-Language`: first matching range by `q`, `*` and `q=0` skipped, and no match = the 0.3 response (every language, no `Content-Language`, no `language_fallbacks`). `Vary: Accept-Language` is present.
- **P-LANG-3** `universal`: term names `null`, codes unchanged, free texts in the default language, `Content-Language` the default language.
- **P-LANG-4** the feed: a snapshot with `lang=de` lists the same entries (`seq`, `type`, `op`, `id`) as one without, each `data` narrowed as `GET` returns it; a cursor taken with `lang=en` continues with `lang=de`.

A node without `language_selection` skips P-LANG-1 to P-LANG-4 (they are not REQUIRED for the protocol profile).

## Compatibility

Additive. A request without `lang` and without a matching `Accept-Language` gets exactly the 0.3 response. A consumer that sends `Accept-Language: de` by default and expects every language gets one language per field from a node that adopts this; it gets every language back by not sending the header (open question 3 would remove this case). `language_fallbacks` and `selectable_languages` are new optional members; closed schemas allow them.

## Implementations

Photopilot (the founder's company) serves `lang` on its OBX feed from one translation path that its other deliveries (Excel/CSV templates, the brand portal CSV) also use; content texts are stored per locale and term names come from its catalogues. A missing translation is reported, never filled. The reference node `node-rs` implements it in `obx-feed` with the conformance tests above.

## Open questions

1. **Several languages.** Should `lang` take a list (`lang=de,en`: one member per listed language, each with its own fallback)? A shop with two storefronts would then need one request instead of two.
2. **Header for `universal`.** Is `Content-Language: <default>` right for `universal`, or should a node send `zxx` (no linguistic content) and leave the language of the free texts to `language_fallbacks`?
3. **Accept-Language at all.** Should a node honour `Accept-Language` only when `lang` is absent *and* the consumer opted in (for example with `lang=auto`), so default HTTP client headers can never change a response?
