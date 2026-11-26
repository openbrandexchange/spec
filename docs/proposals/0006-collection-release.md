# Proposal 0006: collection release (spec 0.4)

Status: **draft** 2026-11-25 · non-breaking (additive), target spec **0.4.0** · open for comments for at least 14 days ([governance](../governance.md#process))

Discussion: to be opened in [Discussions](https://github.com/openbrandexchange/spec/discussions) when this draft is published for comments.

## Why

Brands launch a season as drops: a collection is photographed, described and loaded weeks before it may be seen, and then goes to every retailer on the same morning. OBX has no way to say "not yet" for a whole collection. A product is `published` or not, and `rights.embargo_until` only asks a consumer not to *show* an asset: the asset is still delivered ([protocol.md §5.6](../protocol.md#rights)). So a brand either keeps the drop out of the node until launch day (and loads it in a hurry), or publishes it and trusts every retailer's software to wait.

Goals:

1. **Hold a collection, release it at once.** Until it is released, nothing of it reaches a retailer: no product, variant, asset, GTIN match, export line or change entry, and no hint that it exists.
2. **Now, or at a moment where the node offers it.** A release is immediate; a node MAY also schedule it (`release_at`) and then releases on time without a person.
3. **One signal.** A release produces change entries in the normal way, plus one entry that names the collection, so a consumer (or a buyer notification, [proposal 0005](0005-browsing-and-notifications.md) part 4) can say "the SS27 drop Solstice is out".
4. **Additive.** A 0.3 consumer keeps working: it sees products appear and disappear as it does for publish and unpublish.

## Decisions

1. **A collection is referenced by id, not by name.** A collection record has an `external_id` (the key in the Ingest API, the brand's own collection id where it has one) and a `name` for people. Products and variants point at it with `collection_external_id`; read models carry `collection_id`. A rename on the record or on the products never moves anything, and a name such as `Essentials` can return every season (`name` is unique per brand and season, not globally). `Product.collection` stays the free, informative string it is in 0.3. A product or variant without a `collection_external_id`, or with one that has no record, is never held, so nodes and fixtures without records behave as in 0.3. The CSV import format gets no column in this proposal; membership is written through the Ingest or Node Admin API.
2. **Membership is per colour.** A style often has colours in two drops. `collection_external_id` on ProductInput applies to all its colours; on VariantInput it sets that variant's colour and wins over the product's. Every variant of one colour of a product MUST have the same effective value (`422 validation_failed`). The assets of a colour follow it; an asset of all colours belongs to none. A held colour hides its variants and assets; the product is hidden only when all its colours are held.
3. **Two states: `held` and `released`.** Held hides; released follows the other visibility rules. Holding goes into rules 3 to 5 of [§5.8](../protocol.md#58-visibility) (product, variant and asset, per colour), so the single visibility rule still decides everything (lists, lookups, `/changes`, exports, renditions) and the cascades of [ingest.md §8](../ingest.md#changes) apply unchanged.
4. **Hold is stronger than embargo.** Embargo stays as it is (delivered, not shown). A held collection is not delivered. Both are needed: an embargoed campaign image can be prepared by the retailer; a held drop must not leak through a retailer's system at all.
5. **Scheduled release is a MAY.** A node MAY offer `release_at` on a held record and then says so with the capability `collections.scheduled_release`. A node that offers it MUST NOT release before it, SHOULD within 60 seconds after it, and MUST within one hour (the same bound as rights expiry); `released_at` is then `release_at`, so every node reports the same moment. A node without it answers a future `release_at` with `422 validation_failed`, so a brand never believes a drop is scheduled when it is not. A `release_at` in the past releases at once on every node.
6. **The feed.** A new change type `collection` (unknown types are skipped by 0.3 consumers, [§2](../protocol.md#2-conventions)). Release: `upsert` of the collection, then per product with a colour in it (by `external_id`) the product when it becomes visible and the variants and assets of the released colours. Hold: the `delete` entries in the same order. A held collection is never named in the feed; only a released one has entries.
7. **Reading released collections.** Capability `collections`: `GET /obx/v1/collections` and `/collections/{id}` ([Collection](../../schemas/Collection.json): `id`, `external_id`, `brand_id`, `name`, `season`, `released_at`, `updated_at`). Collections without a record do not appear: they were never held, so there is nothing to announce.
8. **Writing.** Ingest `PUT`/`PATCH`/`DELETE /obx/v1/ingest/collections/{external_id}` with [CollectionInput](../../schemas/CollectionInput.json) (`brand_external_id`, `name`, `season`, `state`, `release_at`), batch kind `collection`; membership through `collection_external_id` on ProductInput and VariantInput. The Node Admin API mirrors it, and its release toggle is a `PATCH` of `state`. Deleting a record releases its colours (they are no longer held). `name` is unique per brand and season among records (`409 conflict`).
9. **Holding new collections automatically** is node policy, not protocol: a node MAY offer a setting (Node Admin `portal.hold_new_collections`) that creates a `held` record when a product or variant write names a `collection_external_id` without one. It never holds an existing collection on its own, because that would take content away from retailers who already have it.
10. **Brand preview.** A node MAY show held collections to brand staff in its admin. A retailer's session or API client never sees them, also not as "coming soon".

## Normative text

In this pull request: [protocol.md §5.8 rules 3 to 5 and §5.10](../protocol.md#510-collections), the capabilities `collections` and `collections.scheduled_release`, §6 (change type, snapshot order), §7 (endpoints); [ingest.md §2, §3.5 and §8 rule 12](../ingest.md#35-collections); [node-admin.md](../node-admin.md#collection-release); schemas `Collection`, `CollectionInput`, `collection_external_id` on `ProductInput` and `VariantInput`, `collection_id` on `Product` and `Variant`, `Change` (`type: collection`), `IngestOperation`/`IngestResult`/`IngestRecord` (`kind: collection`); the three OpenAPI files.

## Conformance

- **I-COLL-1** replays [`fixtures/collections/script.ndjson`](../../fixtures/collections) on a fresh node: hold `solstice` of `maison-noor` before its product MN-7001 exists, load the product (by `collection_external_id`), a variant and an asset (no entries), release (collection upsert, then the cascade), release again (`unchanged`), hold (deletes), move the product out of the collection and back (product cascades only), release through a past `release_at`, hold with a future one (a node without `collections.scheduled_release` holds with `state` only and refuses the future moment), three refused writes (`publish` of a collection, a duplicate name in the same season, an unknown brand), delete the held record (products visible again, no collection entry), an empty released collection (one collection upsert, one delete), and membership per colour: colour OLV of MN-7001 in held `riviera` stays hidden while SND is visible, a SND variant pointing at `riviera` is refused (one colour, one collection), and releasing and holding `riviera` writes the collection entry and only the OLV variant and asset. `expected-results.json` and `expected-changes.json` give the results and entries; `bun run check` validates the script against the schemas.
- **P-COLL-1** checks the read side: held colours absent everywhere while held (snapshot, `GET /products`, GTIN lookup, exports, `/collections`, `404`, dead rendition URLs), present after release.

## Compatibility

Additive. A 0.3 consumer ignores the `collection` entries and the capability, and sees held products as unpublished ones (deletes on hold, upserts on release). A node that does not hold collections passes everything as before: without records, the new conditions of rules 3 to 5 are always met. `collection_external_id` and `collection_id` are optional members; a 0.3 producer never sends them.

## Implementations

Photopilot (the founder's company) holds and releases collections per brand portal and reflects a release in its OBX feed as product upserts and deletes; it sets membership per colour, releases immediately only (no `collections.scheduled_release`) and identifies collections by its own collection id, which is the `external_id` here.

## Resolved questions

Decided by the maintainer on 2026-11-26 and written into the decisions above:

1. **Membership per colour: yes.** A style can have colours in two drops; `collection_external_id` on the variant sets its colour (decision 2). Held colours hide their variants and assets; the product stays visible while any colour is.
2. **Key: id, not name.** Products and variants reference the record's `external_id`; read models carry `collection_id`. Renaming changes nothing (decision 1).
3. **Season in the key: not needed.** With an id key the same name can return every season; `name` is unique per brand and season only, so two records never look alike to a buyer.
4. **Scheduled release is a MAY**, announced as `collections.scheduled_release`; a node without it refuses a future `release_at` (decision 5).

## Open questions

1. **A webhook event** `collection.released` in addition to the change entry, for consumers that only listen to webhooks?
