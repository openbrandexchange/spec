# Proposal 0009: collection documents, linesheet and lookbook (spec 0.4)

Status: **draft** 2026-11-25 · non-breaking (additive), target spec **0.4.0** · builds on [proposal 0006](0006-collection-release.md) · open for comments for at least 14 days ([governance](../governance.md#process))

Discussion: to be opened in [Discussions](https://github.com/openbrandexchange/spec/discussions) when this draft is published for comments.

## Why

Buyers order from a **linesheet**: one document per collection with every style and colour, its sizes and its prices, and often a **lookbook** with the campaign. Brands make them by hand in a layout program, mail PDFs around, and a retailer that was not allowed to see a colour gets it anyway. A node already has everything a linesheet holds except the layout, and knows exactly what each retailer may see. With collections in the protocol ([proposal 0006](0006-collection-release.md)), the document can hang on the collection and follow the same visibility.

The hard part is prices. OBX keeps prices out of its data model on purpose ([protocol.md §1](../protocol.md#1-what-this-is)): wholesale prices differ per retailer and are confidential. A linesheet without prices is of little use to a buyer, so this proposal allows prices **inside the document** and ties them to who asks, without adding price fields to products.

## Decisions

1. **A document belongs to a released collection.** `GET /obx/v1/collections/{id}/documents` lists the caller's documents; `GET /obx/v1/collections/{id}/documents/{kind}?language=&prices=` returns the PDF. Capability `documents`. Kinds: `linesheet`, `lookbook`; unknown kinds are ignored, so more can follow.
2. **Metadata, not layout.** A [Document](../../schemas/Document.json) has `kind`, `collection_id`, `language`, `prices`, `currency`, `content_type` (`application/pdf`), `filename`, `url`, `url_expires_at`, `bytes`, `sha256`, `pages` and `updated_at`. `bytes`, `sha256` and `pages` may be `null` for a node that renders on request; the response then carries `OBX-Content-SHA256`. How it looks is the brand's.
3. **Content follows visibility.** A document MUST show only what the caller can see (§5.8): a restricted retailer gets a shorter linesheet, a held collection has none (`404`). Membership is per colour ([proposal 0006](0006-collection-release.md)), so a linesheet lists colours: a style with colours in two collections is in both linesheets, each with only its own colours.
4. **Three price levels.** `none`, `retail` (recommended retail prices, which shoppers see anyway) and `wholesale` (the caller's own purchase prices). `wholesale` only for **logged-in retailers**: a person of a retailer the brand allows, signed in to the brand's portal (a node with `portal` MAY accept the portal session on the document endpoints). An API client never gets wholesale, also not one of an allowed retailer: prices bought in confidence belong in front of a buyer, not in another system's database. Never listed or served to another caller (`403 forbidden` when asked), `Cache-Control: private, no-store`, signed URLs of at most 5 minutes, and never one retailer's prices in a document another caller can reach. No credentials, no documents (`401`). The list shows only the levels the caller may get, so a client never has to guess.
5. **No prices as data.** The protocol still has no price fields. Prices as structured data per retailer would need agreements per retailer, currencies and validity periods; that is a separate proposal if it is wanted at all.
6. **Changes.** A change of layout, editorial pages or languages writes an `upsert` of the collection; product changes already have their own entries. Consumers that keep a copy compare `updated_at`.

## Normative text

In this pull request: [protocol.md §5.11](../protocol.md#511-collection-documents) and the capability list, the `Document` schema, two endpoints in `obx-protocol.yaml`. How a brand designs the document (editor, pages, photos) is node business and stays out of the Node Admin API for now.

## Conformance

**P-DOC-1** (if `documents`) on the released collection `Solstice` of `maison-noor` (from [`fixtures/collections`](../../fixtures/collections)): the access table [`expected/document-access.json`](../../fixtures/expected/document-access.json) states, per caller (API client or signed-in portal user) and price level, whether the level is listed and what a read answers (`200`, `401`, `403`, `404`); every listed document validates, starts with `%PDF-`, and wholesale documents are `private, no-store` with URLs of at most 5 minutes. `bun run check` validates the table against the schema (a level is listed exactly when it can be read) and the examples [`Document.linesheet-wholesale.json`](../../fixtures/examples/Document.linesheet-wholesale.json) and [`Document.linesheet-retail.json`](../../fixtures/examples/Document.linesheet-retail.json).

## Compatibility

Additive; it needs proposal 0006 for the collection resource. A node without the capability answers `501 not_implemented`.

## Implementations

Photopilot (the founder's company) renders one linesheet PDF per collection on every request (nothing stored), in Dutch or English, with retail prices by default and wholesale prices only for a signed-in portal user; an API token asking for wholesale is refused. A retailer's linesheet holds only the colours that retailer can see.

## Resolved questions

Decided by the maintainer on 2026-11-26 and written into the decisions above:

1. **Who may get wholesale: logged-in retailers only.** A person of a retailer the brand allows, signed in to the portal; machine clients (API tokens) never, as in the implementation above (decision 4). No Grant flag is added: the document list already shows a caller exactly the levels it may get.
2. **Per-colour membership** (proposal 0006): yes, so a linesheet lists colours, and a style with colours in two collections is in both linesheets with only that collection's colours (decision 3).

## Open questions

1. **Formats.** PDF only, or also a spreadsheet linesheet (many buyers re-key into their own order sheets)?
