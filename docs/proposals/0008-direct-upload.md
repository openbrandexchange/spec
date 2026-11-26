# Proposal 0008: direct upload in the Ingest API (spec 0.4)

Status: **draft** 2026-11-25 · non-breaking (additive), target spec **0.4.0** · open for comments for at least 14 days ([governance](../governance.md#process))

Discussion: to be opened in [Discussions](https://github.com/openbrandexchange/spec/discussions) when this draft is published for comments.

## Why

Campaign originals and layered TIFFs run to hundreds of megabytes. In 0.3 every byte goes through the node: `PUT /blobs/{sha256}` up to `max_upload_bytes`, then resumable multipart parts through `PUT /uploads/{id}/parts/{n}` ([ingest.md §4](../ingest.md#files)). Nodes that keep files in object storage (S3, R2, GCS, MinIO) then receive each file twice, pay for the bandwidth, hold request workers for minutes and run into body limits of their platform (a Cloudflare Worker accepts 100 MB). Object storage already solves this with presigned uploads; OBX only has to say how a node hands them out and what it checks afterwards.

Goals: bytes straight to storage, the same upload session and the same Blob at the end, resumable, verified by the node, nothing left behind when an upload is abandoned.

## Decisions

1. **One session, a second transfer.** `POST /uploads` keeps its body and gains `transfer: "direct"`. A node with the capability `ingest.direct_upload` answers the same [Upload](../../schemas/Upload.json) with `transfer: direct`, a `mode` and presigned URLs; a node without it ignores the member and answers a node upload, so a client can always ask. Dedupe stays: a known sha256 answers `200` with the Blob.
2. **Single or multipart, the node decides.** `mode: single` gives one `put` URL; `mode: multipart` gives `part_urls`, one per missing part, every part except the last exactly `part_bytes` (≥ 5 MiB, the S3 minimum), at most 10,000 parts (the S3 maximum). A node MAY answer `single` up to `max_upload_bytes` and SHOULD answer `multipart` above it; `bytes` above `max_object_bytes` is `413` at once.
3. **Signed headers.** Each URL comes with the `headers` its signature covers, at least `Content-Length` (and `Content-Type` for a single PUT), so storage refuses a longer body. URLs are https and valid 15 minutes to 24 hours.
4. **Never the token.** A client MUST NOT send `Authorization` or its ingest token to a storage URL. The URL is the only credential, bound to one object (and part).
5. **Resume by reading the session.** `GET /uploads/{id}` returns `received_parts` and fresh URLs for the missing parts, so an upload survives expired URLs and a restarted client. Re-sending a part replaces it, as in 0.3.
6. **The node verifies.** `POST /uploads/{id}/complete`, optionally with the storage's part ETags. The node MUST check the size and compute the sha256 of what is stored, never trusting the client or the storage's ETag. Missing parts: `409 upload_incomplete`. Wrong size or hash: `422 checksum_mismatch`, the object is deleted and the upload is `aborted`. Success returns the Blob, exactly as for a node upload, and the bytes are then used by `sha256` as before.
7. **Cleanup is a MUST.** `DELETE /uploads/{id}` aborts the storage upload and removes every part. Parts and objects of aborted, failed and expired uploads MUST be gone within 24 hours after the upload ended (a storage lifecycle rule such as "abort incomplete multipart uploads after 1 day" satisfies this) and never count against a brand's limits. Unreferenced completed blobs keep the 0.3 rule (MAY be collected after 24 hours).

## Normative text

In this pull request: [ingest.md §4](../ingest.md#files) method 4 and §9 (URL lifetime), the capability list in [protocol.md §3](../protocol.md#3-discovery), the `Upload` schema (`transfer`, `mode`, `put`, `part_urls`; `parts_total` at most 10,000), the uploads endpoints of `obx-ingest.yaml`.

## Conformance

**I-FILE-3** (if `ingest.direct_upload`) with the files in [`fixtures/ingest/files`](../../fixtures/ingest/files): a direct single upload without `Authorization` gives the Blob with the fixture's sha256; a 12 MiB direct multipart upload with a skipped part is `409 upload_incomplete`, `GET` returns a URL for exactly that part, then it completes; bytes that do not match the declared sha256 are `422 checksum_mismatch` and the session is `aborted`; after `DELETE` the part URLs no longer accept bytes. The examples [`Upload.direct-single.json`](../../fixtures/examples/Upload.direct-single.json) and [`Upload.direct-multipart.json`](../../fixtures/examples/Upload.direct-multipart.json) are validated by `bun run check`.

## Compatibility

Additive. `transfer` is optional and defaults to `node`; 0.3 clients never see the new members. A 0.3 node answers a direct request with a node upload, which a 0.4 client recognises by `transfer` being absent.

## Implementations

Photopilot (the founder's company) uploads brand portal images and campaign files this way: one presigned PUT that signs `Content-Type` and `Content-Length`, multipart above 16 MB in 8 MB parts with all part URLs in the answer, URLs valid one hour, and on completion a size check and its own sha256 over the stored object. It relies on a storage lifecycle rule for abandoned multipart uploads.

## Open questions

1. **Checksums in the signature.** S3 can sign `x-amz-checksum-sha256` so storage itself rejects wrong bytes. Should a node that can SHOULD do it, which would let `complete` skip reading the object back?
2. **Admin uploads.** The Node Admin API's own uploads (branding images, imports) could use the same session. Worth aligning there too?
3. **Part URLs on demand.** Handing out 10,000 URLs at once is large; should a node be allowed to return only the next N and the rest on `GET`?
