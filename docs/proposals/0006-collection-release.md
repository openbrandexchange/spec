# Proposal 0006: collection release (spec 0.4)

Status: **draft** 2026-11-25 · non-breaking (additive), target spec **0.4.0** · open for comments for at least 14 days ([governance](../governance.md#process))

Discussion: to be opened in [Discussions](https://github.com/openbrandexchange/spec/discussions) when this draft is published for comments.

## Why

Brands launch a season as drops: a collection is photographed, described and loaded weeks before it may be seen, and then goes to every retailer on the same morning. OBX has no way to say "not yet" for a whole collection. A product is `published` or not, and `rights.embargo_until` only asks a consumer not to *show* an asset: the asset is still delivered ([protocol.md §5.6](../protocol.md#rights)). So a brand either keeps the drop out of the node until launch day (and loads it in a hurry), or publishes it and trusts every retailer's software to wait.

Goals:

1. **Hold a collection, release it at once.** Until it is released, nothing of it reaches a retailer: no product, variant, asset, GTIN match, export line or change entry, and no hint that it exists.
2. **Now or at a moment.** A release can be immediate or scheduled (`release_at`), and the node releases on time without a person.
3. **One signal.** A release produces change entries in the normal way, plus one entry that names the collection, so a consumer (or a buyer notification, [proposal 0005](0005-browsing-and-notifications.md) part 4) can say "the SS27 drop Solstice is out".
4. **Additive.** A 0.3 consumer keeps working: it sees products appear and disappear as it does for publish and unpublish.

## Decisions

1. **A collection is a record with a name; membership is the product's `collection`.** `Product.collection` already exists (a free string, for example `Nocturne`). A collection record of a brand has a `name`; a product of that brand is in it when its `collection` equals the `name` exactly. No new field on products, no import column, and a nightly import keeps working. A product whose `collection` names no record is never held, so nodes and fixtures without records behave as in 0.3.
2. **Two states: `held` and `released`.** Held hides; released follows the other visibility rules. Holding goes into rule 3 of [§5.8](../protocol.md#58-visibility), so the single visibility rule still decides everything (lists, lookups, `/changes`, exports, renditions) and the cascades of [ingest.md §8](../ingest.md#changes) apply unchanged.
3. **Hold is stronger than embargo.** Embargo stays as it is (delivered, not shown). A held collection is not delivered. Both are needed: an embargoed campaign image can be prepared by the retailer; a held drop must not leak through a retailer's system at all.
4. **Scheduled release.** `release_at` on a held record: the node MUST NOT release before it, SHOULD within 60 seconds after it, and MUST within one hour (the same bound as rights expiry). `released_at` is then `release_at`, so every node reports the same moment. A `release_at` in the past releases at once.
5. **The feed.** A new change type `collection` (unknown types are skipped by 0.3 consumers, [§2](../protocol.md#2-conventions)). Release: `upsert` of the collection, then each product that becomes visible with its variants and assets, products by `external_id`. Hold: the `delete` entries in the same order. A held collection is never named in the feed; only a released one has entries.
6. **Reading released collections.** Capability `collections`: `GET /obx/v1/collections` and `/collections/{id}` ([Collection](../../schemas/Collection.json): `id`, `external_id`, `brand_id`, `name`, `season`, `released_at`, `updated_at`). Collections without a record do not appear: they were never held, so there is nothing to announce.
7. **Writing.** Ingest `PUT`/`PATCH`/`DELETE /obx/v1/ingest/collections/{external_id}` with [CollectionInput](../../schemas/CollectionInput.json) (`brand_external_id`, `name`, `season`, `state`, `release_at`), batch kind `collection`; the Node Admin API mirrors it, and its release toggle is a `PATCH` of `state`. Deleting a record releases its products (they are no longer held). `name` is unique per brand among records (`409 conflict`).
8. **Holding new collections automatically** is node policy, not protocol: a node MAY offer a setting (Node Admin `portal.hold_new_collections`) that creates a `held` record when a product write names a collection without one. It never holds an existing collection on its own, because that would take content away from retailers who already have it.
9. **Brand preview.** A node MAY show held collections to brand staff in its admin. A retailer's session or API client never sees them, also not as "coming soon".

## Normative text

In this pull request: [protocol.md §5.8 rule 3 and §5.10](../protocol.md#510-collections), §6 (change type, snapshot order), §7 (endpoints); [ingest.md §2, §3.5 and §8 rule 12](../ingest.md#35-collections); [node-admin.md](../node-admin.md#collection-release); schemas `Collection`, `CollectionInput`, `Change` (`type: collection`), `IngestOperation`/`IngestResult`/`IngestRecord` (`kind: collection`); the three OpenAPI files.

## Conformance

- **I-COLL-1** replays [`fixtures/collections/script.ndjson`](../../fixtures/collections) on a fresh node: hold `Solstice` of `maison-noor` before its product MN-7001 exists, load the product, a variant and an asset (no entries), release (collection upsert, then the cascade), release again (`unchanged`), hold (deletes), move the product out of the collection and back (product cascades only), release through a past `release_at`, hold with a future one, three refused writes (`publish` of a collection, a duplicate name, an unknown brand), delete the held record (products visible again, no collection entry), and an empty released collection (one collection upsert, one delete). `expected-results.json` and `expected-changes.json` give the results and entries; `bun run check` validates the script against the schemas.
- **P-COLL-1** checks the read side: absent everywhere while held (snapshot, `GET /products`, GTIN lookup, exports, `/collections`, `404`, dead rendition URLs), present after release.

## Compatibility

Additive. A 0.3 consumer ignores the `collection` entries and the capability, and sees held products as unpublished ones (deletes on hold, upserts on release). A node that does not hold collections passes everything as before: without records, rule 3's new condition is always true.

## Implementations

Photopilot (the founder's company) holds and releases collections per brand portal and reflects a release in its OBX feed as product upserts and deletes; it releases immediately only and identifies collections by its own collection id.

## Open questions

1. **Membership per colour.** In the implementation above, the collection is set per colour of a style: one style can have colours in two drops. This draft keeps membership on the product. Per-colour membership would need an optional `collection` on the variant (held variants and the assets of their colour hidden, the product visible when any colour is). Is that worth the extra rule?
2. **Key: name or id.** Matching by the product's `collection` string needs no new field but breaks when a brand renames a collection on its products and not on the record. An optional `collection_external_id` on ProductInput would be sturdier.
3. **Season in the key.** Brands reuse collection names across seasons (`Essentials`). Should the key be (`season`, `name`) rather than `name` alone?
4. **A webhook event** `collection.released` in addition to the change entry, for consumers that only listen to webhooks?
