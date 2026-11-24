# Proposal 0007: private asset access (spec 0.4)

Status: **draft** 2026-11-25 · non-breaking (additive), target spec **0.4.0** · open for comments for at least 14 days ([governance](../governance.md#process))

Discussion: to be opened in [Discussions](https://github.com/openbrandexchange/spec/discussions) when this draft is published for comments.

## Why

0.3 already forbids permanent public URLs and offers short-lived signed rendition URLs with `url_expires_at` ([protocol.md §5.5](../protocol.md#55-renditions)). Three things are unwritten, and each causes trouble in practice:

1. **Where the URL points.** Nodes that keep originals in private object storage want to hand out that storage's presigned URLs (or a CDN's), so large files do not stream through the node. 0.3 reads as if every signed URL is on the node itself and answers problem+json.
2. **What a client may keep.** A shop that writes a signed URL into its product page shows broken images an hour later, and a PIM that stores the URL as the image's identity re-downloads every image on every sync because the URL changed.
3. **What to cache on.** Signing a URL again changes it. Without a stable key, browsers, CDNs and consumers cannot reuse what they already have.

Goals: private storage allowed, one rule for how long a URL lives and how a client learns that, one cache key that survives re-signing, no new required fields.

## Decisions

1. **Signed URLs may be delegated.** A signed URL MAY be on another host (private object storage, a CDN). It MUST be bound to one object and one rendition, stop at `url_expires_at`, and answer `403` when expired or changed; only on the node's own host must the body be problem+json. Consumers already act on the status, not the body ([§2](../protocol.md#2-conventions)).
2. **Expiry signalling.** `url_expires_at` is the real end of the URL: at least 5 minutes after the response that carried it, at most 24 hours. The bytes response SHOULD say `Cache-Control: private, max-age=<n>` with `n` not past that moment. On the node's own host an intact but expired signature SHOULD be `403 url_expired` (new error code; a changed signature stays `forbidden`), so a client knows a refresh will help.
3. **Windowed signing is allowed.** A node MAY sign at the start of a fixed window (for example each whole hour, valid for two), so one object gives the same URL for the length of the window and HTTP caches hit. The minimum remaining lifetime of 5 minutes still holds.
4. **Clients never keep URLs.** A consumer MUST NOT store a signed URL past its expiry, MUST NOT republish it (public pages, feeds, e-mails) and MUST NOT treat a new URL as new content. It keeps the asset `id`, the rendition name and `sha256`, and re-reads the asset when it needs bytes. On `403`/`401` or within a minute of expiry it refreshes instead of retrying.
5. **The cache key is `sha256`.** Re-signing MUST NOT change `sha256`, `bytes`, `width`, `height` or `content_type`; new bytes MUST come with a new `sha256` and an asset upsert. A new signature writes no change entry (already true: [ingest.md §8 rule 1](../ingest.md#changes) excludes URLs and their expiry). `ETag` is the quoted `sha256` on every URL of a rendition, so `If-None-Match` with a known `sha256` on a fresh URL answers `304`.
6. **No new fields.** `cache_key` was considered and dropped: `sha256` already is one, is in every rendition and is checkable.

## Normative text

In this pull request: [protocol.md §5.5.1](../protocol.md#551-signed-urls) and the error table (`url_expired`), [security.md §4](../security.md#4-urls-and-downloads), the quickstart's rendition section, `Rendition` descriptions, `Common.json` `ErrorCode`, the rendition endpoint of `obx-protocol.yaml`.

## Conformance

- **P-MEDIA-4**: two reads of one asset differ only in `url` and `url_expires_at`, with no change entry in between; lifetime between 5 minutes and 24 hours; `Cache-Control` not beyond the expiry; `If-None-Match` with the `sha256` on the second URL is `304`; an expiry moved into the past is `403`.
- The example pair [`Rendition.signed.json`](../../fixtures/examples/Rendition.signed.json) and [`Rendition.signed-again.json`](../../fixtures/examples/Rendition.signed-again.json) shows a re-signed rendition; `bun run check` fails when they differ in anything but `url` and `url_expires_at`.

## Compatibility

Additive. 0.3 consumers that follow §5.5 (opaque URLs, re-read on expiry) need nothing new. `url_expired` is a new error code with the status `403` they already handle; a node that answers `forbidden` stays conformant. A consumer that stored URLs was already broken; this makes it explicit.

## Implementations

Photopilot (the founder's company) keeps portal files in private object storage and hands out presigned URLs signed per hour and valid for two, so a URL stays the same within the hour; downloads get 5-minute URLs. Its OBX renditions are signed on the node itself with a one-hour lifetime.

## Open questions

1. **A minimum lifetime above 5 minutes** for display URLs (a buyer leaving a portal tab open for an hour)? Windowed signing already gives at least one window.
2. **Should `url_expired` be a MUST** on the node's own host, so clients can rely on it rather than treating every `403` as "refresh once"?
3. **Export parts** are already signed; should export `expires_at` and the part URLs' expiry be stated separately in the manifest?
