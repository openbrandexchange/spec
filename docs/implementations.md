# Implementations

The known implementations of Open Brand Exchange, what they pass, where they run and what is still missing. Non-normative; updated by hand.

Status of **2026-09-28**, spec **0.1.0**. The conformance, interop and security results below come from the full run against spec `2053882`, [obx-go](https://github.com/openbrandexchange/obx-go) `b356330` (conformance suite, CLI, interop tool) and [admin-ui](https://github.com/openbrandexchange/admin-ui) `5c948c2` (vendored by all three portals). Since then the 0.1.0 clarifications (colourless images, filename qualifiers, SSRF, CORS, default API-key scopes; see the [changelog](../CHANGELOG.md)) were made in the spec, and the portals and the suite are following them (obx-go `4dee222`, node-go `0d552e9`, node-php `f4805a5`, node-ts `18ee22b` at the time of writing); the tables are refreshed by the next full run.

## The pieces

| Repository | What it is | Language | License |
|---|---|---|---|
| [spec](https://github.com/openbrandexchange/spec) | this specification: OpenAPI, JSON Schemas, prose, fixtures | | CC-BY-4.0 |
| [node-ts](https://github.com/openbrandexchange/node-ts) | **Portal for Cloudflare** (Workers + D1 + R2; also runs on Bun and Docker) | TypeScript (Hono) | AGPL-3.0 |
| [node-go](https://github.com/openbrandexchange/node-go) | **Portal for Google Cloud & Docker** (one binary; SQLite or PostgreSQL) | Go | AGPL-3.0 |
| [node-php](https://github.com/openbrandexchange/node-php) | **Portal for web hosting** (PHP 8.3; SQLite or MySQL; FTP upload works) | PHP | AGPL-3.0 |
| [admin-ui](https://github.com/openbrandexchange/admin-ui) | the brand admin and the retailer portal, one static React app (TanStack Router + Query) talking REST to the Node Admin API; its `dist/` is vendored by every portal | TypeScript | Apache-2.0 |
| [obx-go](https://github.com/openbrandexchange/obx-go) | Go SDK, the `obx` command for brands and retailers, the GitHub Action, `obx-conformance` (suite + mock portal) and `obx-interop` | Go | Apache-2.0 |
| [website](https://github.com/openbrandexchange/website) | openbrandexchange.com | | CC-BY-4.0 content, MIT code |

The three portals are the same product in three runtimes: the same admin UI, the same e-mails (texts from admin-ui's locale files, 25 languages), the same import format and the same API. A brand picks the one that fits where it can host.

## Conformance

`obx-conformance all` against a fresh portal (setup code, fixtures, every profile). Numbers are passed / total; the second number in brackets is the REQUIRED tests.

| Profile | node-ts (Bun) | node-go | node-php (Docker) |
|---|---|---|---|
| protocol | 24 / 24 (21 / 21) | 24 / 24 (21 / 21) | 24 / 24 (21 / 21) |
| ingest | 12 / 12 (12 / 12) | 12 / 12 (12 / 12) | 12 / 12 (12 / 12) |
| portal | 11 / 11 (optional) | 11 / 11 (optional) | 11 / 11 (optional) |
| security | 11 / 11 (8 / 8) | 11 / 11 (8 / 8) | 11 / 11 (8 / 8) |

- Run with private addresses blocked (the production default). S-RATE-2 (login and token brute force) runs separately with `--rate-limit-test` because it locks the test machine's IP out of logins for a while; it passes on all three.
- The integration runs also passed `all` with `OBX_ALLOW_PRIVATE_URLS=true` (webhook delivery to a local receiver, P-HOOK-1) and with a lowered rate limit plus `--rate-limit-test` (a real 429, P-RATE-1). node-ts passes on `wrangler dev` (local D1/R2) as well; node-php passes with `OBX_RENDITIONS=client` too.
- The obx-go mock portal passes every test in CI (`go test ./conformance`).

## Interop: same automation, same answers

`obx-go/scripts/interop.sh` runs the same automation against all three portals and compares what comes out, with node ids, timestamps, cursors and signed URLs replaced by stable labels:

1. first-run setup, then `obx push` of `fixtures/kestrel` (76 new);
2. `obx pull` with all four image versions;
3. `obx-interop trace`: the whole change feed, every product and the sha256 of every downloaded file, then [`fixtures/ingest/script.ndjson`](../fixtures/ingest/script.ndjson) one operation at a time (including the image replacement, the position conflict, the asset unpublish, the product unpublish and republish and the deletes), recording the result, the new `/changes` entries, the ingest record and the product after every step;
4. an incremental and a fresh `obx pull`.

Result on 2026-09-28: the traces of all three portals are identical, the mirrors after the push are identical, and the six mirrors after the script (incremental and fresh, per portal) are identical. Originals are byte-identical everywhere. `web`, `square` and `thumb` are made by each portal's own image library, so only their dimensions are compared; when both portals leave them to the client (node-ts, and node-php with `OBX_RENDITIONS=client`), those files are byte-identical as well (81 of 81 compared). The mock portal gives the same trace.

Differences the first interop run found, all fixed: the `IngestRecord` of an asset looked different on every portal (rights and provenance with or without defaults, server-made renditions listed or not, `missing_files` present, absent or `null`), and writing that record back was not `unchanged` everywhere. See the [changelog](../CHANGELOG.md) and [ingest.md §3.4](ingest.md) (round trip).

## Security review

Reviewed on 2026-09-28 against [security.md](security.md): the conformance `security` profile for everything observable, plus a code and data review of what is not.

| Check | node-ts | node-go | node-php |
|---|---|---|---|
| retailer isolation (lists, feed, exports, GTIN lookup, downloads, jobs, selections, keys, webhooks) | pass | pass | pass |
| unpublished, invisible and not-granted content → 404; originals only with permission | pass | pass | pass |
| signed URLs: bound to asset and rendition, expiry, dead after unpublish | pass | pass | pass |
| passwords, client secrets, upload keys, invite/reset tokens hashed; import credentials encrypted (checked in the database files) | pass | pass | pass |
| no secrets in logs (checked after a full run) | pass | pass | pass |
| sessions: CSRF, logout, password change, no fixation, retailer kept out of admin | pass | pass | pass |
| SSRF: every spelling refused; redirects re-checked | pass | pass | pass |
| SSRF: resolved address pinned for the connection (DNS rebinding) | Workers: n/a (no private network); Bun: **fixed** in `ec9f166` (was not pinned), to be re-reviewed | pass (dialer control) | pass (`CURLOPT_RESOLVE`) |
| SSRF: link-local and cloud metadata refused also with `OBX_ALLOW_PRIVATE_URLS=true` | pass | pass (`773d336`) | pass |
| CORS only on the discovery document (and the public logo) | pass | pass | **fixed** (sent `*` on the whole protocol API before) |
| e-mail links never built from the request's Host (password-reset poisoning) | **fixed** (was vulnerable without `OBX_PUBLIC_URL`) | pass (fixed public URL) | pass (setup address) |
| uploads: size limits, magic bytes, no SVG, zip slip, zip size and entry caps, pixel limits | pass | pass | pass |
| CSV formula injection, `javascript:` links refused | pass | pass | pass |
| rate limits on login, setup, forgot password, access requests, token endpoint | pass | pass | pass |
| constant-time comparisons of secrets and signatures | pass | pass | pass |
| webhook signatures (test vector, P-HOOK-1) | pass | pass | pass |

## Hosting

| | node-ts: Portal for Cloudflare | node-go: Portal for Google Cloud & Docker | node-php: Portal for web hosting |
|---|---|---|---|
| one click / one command | Deploy to Cloudflare button, or `bunx wrangler deploy` | `./deploy/cloudrun.sh` (Cloud Run), `./deploy/fly.sh` | upload the release zip over FTP and open `/install` |
| own server | `docker compose up -d` (Bun), `bun start` | `docker compose up -d` with automatic HTTPS (Caddy), `install-linux.sh` without Docker | `docker compose up -d` (Apache + worker; MySQL profile), nginx + PHP-FPM |
| other | Google Cloud Run (container) | Railway, Render (config included) | Google Cloud Run (`deploy/cloudrun.sh`) |
| database | D1 / SQLite | SQLite / PostgreSQL | SQLite / MySQL |
| images | R2, disk or S3-compatible | disk or S3-compatible | disk or S3-compatible |
| web/square/thumb versions | made by the browser or `obx` (Workers has no image library) | made by the portal | made by the portal (GD), or by the client |
| e-mail | Resend, Postmark, SendGrid, MailChannels or a webhook | SMTP | PHP `mail()` or SMTP |

Every portal needs only a setup code to start (printed in the log, or preset with `OBX_SETUP_CODE`); there is never a default password.

## Automation (the same on every portal)

| You have | Use |
|---|---|
| a PIM, ERP or DAM that can call an API | the [Ingest API](ingest.md) with an automatic upload key (`obxi_…`): idempotent PUTs keyed by your own ids, blobs by sha256, batches, imports |
| a folder or nightly export | `obx push ./export` (from cron or Windows Task Scheduler), or `obx watch <folder>` as a service |
| exports in Git | the GitHub Action `openbrandexchange/obx-go/push-action` |
| files on a web address, SFTP server or S3/R2 bucket | a scheduled import in the admin (hourly, daily, weekly); node-ts on Workers: web address and S3/R2 only |
| n8n, Make, Zapier | plain HTTP steps ([automation.md](automation.md)) |
| notifications to your own systems | brand webhooks (`access_request.created`, `import_run.completed`, `ingest_job.completed`) |

For retailers: the portal in the browser, `obx pull` to mirror a catalog, or their own software on the [OBX Protocol](protocol.md) with an API key.

## Known gaps

- **Rendition bytes differ between portals that make them themselves** (Go's JPEG encoder, PHP GD). Dimensions and quality rules are the same; consumers compare by sha256 per portal, which the protocol already requires.
- **Filename qualifier edge cases** settled in 0.1.0 ([import-format.md §2.1](import-format.md#21-filename-pattern)) are not yet followed everywhere: on node-go a second role or view qualifier (`…_5_back_front.jpg`, and so also `…_6_model_other.jpg`) makes the file an error instead of the rightmost one winning, and node-php reads `…_6_model_other.jpg` as role `other` instead of role `model` with view `other`. node-ts follows the rule. No fixture uses these names, so conformance does not see it.
- The portals still report `spec_version: "0.1.0-draft"` in their discovery document; clients only use `obx_version` (`0.1`), so nothing breaks, but it should say `0.1.0`.
- An admin who edits an image's rights in the admin UI saves the rights as shown; fields equal to the defaults are not pinned, so the image keeps following the default rights.
- Not run for real (no cloud accounts): Cloud Run, Fly, Render, Railway and Cloudflare deploys, `install-linux.sh`, FTP hosting on a shared host. The Docker images, `wrangler dev` and the release zip on `php:8.3-apache` were tested locally.
- The Deploy to Cloudflare button, the README quickstarts that `git clone` and the `obx` release downloads only work once the repositories are public and packages published.
- The `obx` command is English only; the portals are in 25 languages. E-mail dates are ISO dates (`2026-10-05`) on node-go.
- node-go's e2e browser walk (`e2e/run.sh`) is not in its CI yet (needs Node and a Playwright browser on the runner).
- admin-ui tag `v0.1.0` predates fixes that `main` (vendored everywhere) contains; `v0.1.1` is to be tagged (locally first; no release tag is pushed before the repositories are public).
