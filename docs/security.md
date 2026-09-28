# Security requirements

Normative for nodes (all three faces) and for the `obx` CLI where noted. RFC 2119 keywords as in [protocol.md](protocol.md). The conformance suite tests the observable parts ([conformance.md](conformance.md)).

## 1. Isolation between retailers
- A retailer (its users and API clients) MUST only ever see objects visible under its own grant ([protocol.md §5.8](protocol.md#58-visibility)). This applies to lists, lookups, `/changes`, exports, download jobs, selections, statistics and rendition URLs.
- Objects outside the grant answer `404 not_found`, never `403` (no existence leak).
- Download jobs, selections, exports, webhook subscriptions and access-request status are bound to their owner; ids are not capabilities (always check ownership).
- A retailer never sees another retailer's name, contact, usage or downloads.

## 2. Secrets
- Passwords, client secrets, ingest tokens, request tokens, invite/reset tokens and webhook secrets are random (≥ 128 bits of entropy from a CSPRNG) and stored only as hashes: **argon2id** (RECOMMENDED; m ≥ 19 MiB, t ≥ 2) or **bcrypt** (cost ≥ 10) for passwords; SHA-256 is sufficient for high-entropy tokens.
- Webhook secrets and import-source credentials must be usable later, so they are stored **encrypted at rest** (AES-256-GCM or XChaCha20-Poly1305) with a key from the environment (`OBX_SECRET_KEY`), never in the database next to the data.
- Secrets are shown once (creation/rotation) and are write-only afterwards. Import-source credentials are never returned (`credentials_set` only says which exist).
- All secret and signature comparisons are constant-time.
- Recognisable prefixes help secret scanners: `obxi_` (ingest token), `obxc_` (client id), `obxs_` (client secret), `obxr_` (request token), `whsec_` (webhook secret).
- Secrets, tokens, `Authorization` headers, cookies and signed URL query strings MUST NOT be written to logs or error messages.
- There is never a default password. First-run setup requires a one-time **setup code** printed in the node's log on first start (or preset by the operator via `OBX_SETUP_CODE`), so a freshly deployed node cannot be claimed by a stranger.

## 3. Authentication and sessions
- Protocol: OAuth2 client credentials; access tokens ≤ 24 h (RECOMMENDED 1 h). Ingest: Bearer ingest tokens (revocable, optionally expiring, optionally brand-restricted). Admin/portal: session cookies only; bearer tokens are not accepted there, and protocol/ingest tokens are not accepted on admin endpoints.
- Session cookie `obx_session`: `HttpOnly`, `Secure` (except on `http://localhost`), `SameSite=Lax`, sliding expiry ≤ 30 days; invalidated on logout, password change, blocking and deletion. Session ids are rotated at login.
- **CSRF:** every state-changing admin request carries `X-CSRF-Token` matching the token bound to the session (double-submit with an HttpOnly `obx_csrf` cookie); mismatch → `403 csrf_failed`.
- Login, setup, password reset, invite acceptance, access requests and the token endpoint are rate-limited per IP (and per e-mail for login). Login and forgot-password responses do not reveal whether an account exists.
- Blocking a retailer or revoking a client takes effect on the next request (no cached authorisation beyond 60 s).
- Password policy: 10–72 characters; nodes SHOULD reject the 1000 most common passwords.
- Links in e-mails (invitations, password resets, approvals, "your zip is ready") MUST use the configured public address (`OBX_PUBLIC_URL`) or, without one, the address recorded at first-run setup, never the `Host` of the request that triggered the e-mail: a forged `Host` on a forgot-password request would otherwise send the victim a valid reset token on the attacker's host.

## 4. URLs and downloads
- Rendition, export and download-job URLs are either signed and short-lived (RECOMMENDED 1 h, maximum 24 h; HMAC-SHA256 over method, path and expiry with a node key) or require the Bearer token/session. No permanent public URLs for content. Logos in the discovery document are public by design.
- Responses with content set `Cache-Control: private` and `X-Content-Type-Options: nosniff`; downloads set `Content-Disposition` with a sanitised filename (RFC 6266 `filename*` for non-ASCII).
- The admin UI is served with a strict `Content-Security-Policy` (no inline script), `X-Frame-Options: DENY` (or `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`.

## 5. Outbound requests (SSRF)
Scheduled import URLs, `logo_url` fetches, SFTP/S3 endpoints and webhook URLs are attacker-influenced. Nodes MUST:
- allow only `https` (plus `sftp` for SFTP sources; `http` only with the development switch below);
- resolve the host and refuse loopback, private (RFC 1918, RFC 4193), link-local (169.254/16, fe80::/10, including cloud metadata 169.254.169.254), CGNAT (100.64/10), multicast and unspecified addresses (`422 unsafe_url`), **re-checking after every redirect** and pinning the resolved address for the connection (DNS rebinding);
- cap redirects (≤ 5), response size and time (RECOMMENDED 15 s connect, 10 min total for imports);
- allow private addresses only when the operator sets `OBX_ALLOW_PRIVATE_URLS=true` (local development, MinIO on the same host).

## 6. Uploads and archives
- Enforce size limits before buffering (`413`). Verify declared sha256 (`422 checksum_mismatch`).
- Check file signatures (magic bytes), not only `Content-Type`; accept only the image types listed in `IngestInfo.accepted_content_types`. No SVG as product image or logo (script injection).
- Image decoding (nodes that render) runs with pixel limits (RECOMMENDED ≤ 100 megapixels) to defuse decompression bombs.
- Zip imports: reject absolute paths, `..`, symlinks, drive letters and device names (zip-slip); cap total uncompressed size and entry count; never extract to paths derived from entry names without sanitising; never open nested archives.
- CSV exports: prefix cells starting with `=`, `+`, `-`, `@`, tab or CR with `'` (formula injection), except cells that are purely numeric such as GTINs.

## 7. Webhooks
HMAC-SHA256 signatures with timestamp (`OBX-Webhook-Signature: v1=…`, 300 s tolerance), constant-time verification, event ids for de-duplication, https-only targets with the SSRF rules above, no redirects followed, bounded retries. See [protocol.md §9](protocol.md#9-webhooks-capability-webhooks).

## 8. Abuse and availability
- `RateLimit-*` headers and `429` with `Retry-After` on every rate-limited endpoint.
- Background jobs (imports, exports, zips, renders) are bounded per user/client (RECOMMENDED ≤ 2 concurrent) and time-limited.
- Access requests MAY add a proof-of-work or CAPTCHA without changing the API (the form is served by the node).

## 9. Privacy
Keep personal data minimal: contact name/e-mail of retailer users and access requests. Download statistics store the retailer and account, not the IP (IPs only in short-lived abuse logs, ≤ 30 days). Deleting a user removes its personal data; statistics keep the retailer name only.

## 10. Reporting vulnerabilities
Until a dedicated address exists, report privately to the maintainers via GitHub security advisories on the affected repository. Do not open public issues for vulnerabilities.
