# Go-live

What is ready, what only the owner can still do (in order), and what is known not to work yet. Written on **2026-09-28** after a last review of every repository; non-normative, and outdated once the steps below are done. The test results per portal are on the [implementations](implementations.md) page.

## In short

The code is ready for a first brand. The three portals, the SDK and `obx` command, the admin UI, the specification and the website pass their own test suites; all three portals pass the conformance suite (61 of 61 checks, the rate-limit checks included) and the cross-portal interop run; every problem this review found is fixed and pushed ([list](#found-and-fixed-in-the-last-review)).

**What stops a brand from running it in production next week** is owner work, not code:

1. Nothing can be installed yet. The repositories are private and nothing is released, so the Deploy to Cloudflare button, `git clone`, the release zip, the `obx` downloads and the container images all fail for anyone but the owner ([E](#e-the-day-the-repositories-go-public) and [F](#f-first-releases)).
2. The project's own addresses do not work. `openbrandexchange.com` has no website and no mail records yet: mail to hello@ and security@ bounces, and the problem-type URLs that every portal sends, the schemas' `$id`s and the API reference answer nothing ([B](#b-mail), step 17).
3. GitHub Actions does not run: the organisation's minutes are used up ([A](#a-github)).
4. None of the hosting paths has run on a real cloud account or shared host, and no e-mail has gone through a real provider ([G](#g-the-first-real-portals)).
5. No lawyer has read the privacy texts yet (step 10).

**What would embarrass us if the repositories went public today:** after this review, only things that are the owner's call: the personal e-mail address in every commit (step 15), the red CI history until the runs can be repeated, 21 machine-translated languages (step 26) and the open Dependabot pull requests (step 19).

## Status per repository

| Repository | Commit | Status | Checked |
|---|---|---|---|
| [spec](https://github.com/openbrandexchange/spec) | `main` with this page | ready, not tagged | `npm run check` (1285 checks: schemas, examples, fixtures, links, versions, glossary, `site/` up to date), `npm audit`, the fixtures regenerate identically, the release bundle builds, the rendered reference in Chromium with axe (16 tests) |
| [obx-go](https://github.com/openbrandexchange/obx-go) | `1ddc0fa` | ready, not tagged | gofmt, vet, golangci-lint, shellcheck, tests with the race detector, the conformance suite against the mock, the 25 languages, the push action against a local release, GoReleaser check and snapshot build for six platforms, container image, govulncheck (nothing the code calls), licences; the interop run over the three portals |
| [admin-ui](https://github.com/openbrandexchange/admin-ui) | `0b4127d` (`v0.1.1` = `d3ee574`, tagged locally only) | ready | `npm run check` (193 tests, also on Linux with Node 20 and 22; lint, types, 25 languages, build, size budget), Playwright with axe (92), licences, `npm audit` clean, API types and glossary in step with the spec, `dist/` rebuilt on Linux byte-identical |
| [node-go](https://github.com/openbrandexchange/node-go) · Portal for Google Cloud & Docker | `36e582e` | ready, not tagged | gofmt, vet, staticcheck, shellcheck, `go test ./...` on SQLite and PostgreSQL 17, the race detector, builds for six platforms, conformance in-process (SQLite and PostgreSQL) and against the binary (61/61), browser tests (19), the Docker image with Litestream and backup restore, Compose with Caddy over HTTPS, the Cloud Run script against the real gcloud CLI, licences, load test |
| [node-php](https://github.com/openbrandexchange/node-php) · Portal for web hosting | `117164c` | ready, not tagged | PHPUnit on PHP 8.2, 8.3 and 8.4 and on MySQL 8.4 and MariaDB 11 (181 tests, 3 skipped), PHPStan level 5, shellcheck, `composer audit`, licences, conformance 61/61 with and without server-side image versions, the browser walk with axe, shared hosting on PHP 8.2, 8.3 and 8.4 without cron, S3 and SFTP imports, the release zip and Docker image, load test |
| [node-ts](https://github.com/openbrandexchange/node-ts) · Portal for Cloudflare | `d34633a` | ready, not tagged | `bun run test` (137, 3 skipped), oxlint, `tsc`, shellcheck, `bun audit`, licences, the Workers bundle and smoke test, conformance 61/61 on Bun and on `wrangler dev` (Workers runtime, local D1 and R2), browser tests (14), the Docker image (health, non-root, graceful stop, configuration errors, backup and restore) |
| [website](https://github.com/openbrandexchange/website) | `1f2e98a` | ready, not deployed | `npm run check` (371 pages, 26 592 internal links, 169 tests), Playwright with axe (187), Lighthouse budgets (performance 95 to 100, everything else 100), the directory check, `npm audit` clean |

Some checks ran on an earlier commit with the same code; the commits since then only touch changelogs, CI files, test tooling or doc comments. actionlint passes on every workflow. Photopilot, the initiator's company, builds OBX into its own product in its own repository; that work is reviewed there and nothing here depends on it.

**CI.** Since about 21:15 CEST on 2026-09-28 GitHub does not start any job in the organisation: "The job was not started because recent account payments have failed or your spending limit needs to be increased." The last runs that did start were green on spec, node-ts and website, and red on obx-go, node-go, node-php and admin-ui for the reasons [fixed below](#found-and-fixed-in-the-last-review). So the CI jobs were run by hand instead, on macOS and, where the runner behaves differently, in Linux containers; only the release workflows, which run on a tag, were not. `ubuntu-latest` moves to Ubuntu 26 from 19 October 2026; watch the first runs after that.

## Owner actions, in order

### A. GitHub

1. **Actions minutes.** Organisation `openbrandexchange` → Settings → Billing and plans: fix the payment method or set a spending budget for Actions, or wait for the monthly reset. Public repositories use no minutes, so step 16 ends the problem too. Then start CI once on every repository:
   ```sh
   for r in spec obx-go admin-ui node-go node-php node-ts website; do
     gh workflow run ci.yml -R openbrandexchange/$r --ref main
   done
   ```
   While the repositories are private, obx-go's macOS test job costs ten minutes for every minute it runs.
2. **Two-factor authentication:** Settings → Authentication security → require it for every member.
3. **Read token, only while the repositories are private.** Create a fine-grained personal access token: resource owner `openbrandexchange`, repositories `spec` and `obx-go`, *Contents: read-only*, 90 days. Add it as the repository secret `OBX_READ_TOKEN` to `admin-ui` (checks its API types and words against the spec) and to `node-go`, `node-php` and `node-ts` (build the conformance suite from obx-go). Without it those jobs skip with a notice and never fail; once the repositories are public they run without it, and the token can be deleted.
4. The organisation's **billing e-mail** (visible to owners only) is a company address; change it to hello@openbrandexchange.com after step 5 if the project should not depend on it.

### B. Mail

5. **hello@ and security@.** The domain is registered at Cloudflare and uses Cloudflare's name servers, but has no MX record, so both addresses bounce today. In the Cloudflare dashboard: `openbrandexchange.com` → Email → Email Routing → enable (Cloudflare adds the MX and SPF records), add the custom addresses `hello@openbrandexchange.com` and `security@openbrandexchange.com`, each sent to an inbox you read, and confirm that destination address. Send a test mail to both. SECURITY.md promises an acknowledgement within 3 working days. Optional: a DMARC record (`_dmarc` TXT `v=DMARC1; p=none`). Check that auto-renew is on for the domain (it expires on 2027-09-28).

### C. Website and legal texts

6. **Cloudflare Pages token:** My Profile → API Tokens → Create token → custom token with *Account › Cloudflare Pages › Edit* on the account that holds the domain. Add it and the account id as the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `openbrandexchange/website`. Optionally put a required reviewer on its environment `production`.
7. Optional: a Cloudflare Web Analytics site (no cookies) and its token as the repository **variable** `PUBLIC_CF_ANALYTICS_TOKEN`. Without it the site loads nothing from third parties.
8. Optional **imprint details** in the website's `src/data/imprint.json`: `address` (one line per array item), `phone`, `registration` (the KvK number once the foundation is registered). They are `null` today, and the imprint then shows "Open Brand Exchange Foundation (in formation)" and hello@ only.
9. The deploy itself belongs to the public day (step 17), because the website links to the repositories.
10. Have a lawyer read the website's privacy, cookie and imprint pages and the portals' `docs/privacy-notice-template.md` (node-go, node-php, node-ts), and say whether the imprint needs a postal address before the foundation exists.

### D. Foundation and name

11. **Notary:** take the statutes sketch ([Dutch](../governance/statuten-schets.md), [English](../governance/statutes-sketch.md)) to a Dutch civil-law notary with its [questions for the notary](../governance/statutes-sketch.md#questions-for-the-notary): the options in brackets, the statutory name (art. 2:286 BW needs the word *stichting*), and whether ANBI status is wanted (the sketch warns it may not fit the founder's position). After the deed, the [transfer steps](../governance/statutes-sketch.md#transfer-of-the-project-to-the-foundation-steps-after-incorporation): KvK registration including the UBO, a bank account in the foundation's name, and the deed of transfer of copyright, after checking whether Photopilot has to co-sign (art. 7 Auteurswet).
12. **Trademark:** a clearance search at BOIP and EUIPO for "Open Brand Exchange", then the word mark at BOIP (classes 9, 35 and 42 suggested) in the foundation's name, or now in your own name with a recorded transfer later.
13. Confirm the **patent commitment** in [governance.md](governance.md#patents), which names you and the companies you control.
14. After incorporation, replace "(in formation)" and the publisher lines in the NOTICE files, copyright lines, governance pages and imprint, one change per repository (the last of the transfer steps).

### E. The day the repositories go public

15. **Before flipping, decide:**
    - *Commit identity.* Every commit and tag carries your personal e-mail address as author and committer. To publish another one, rewrite the history first (`git filter-repo --mailmap`, force-push every repository, re-create the admin-ui tags) and then update the commit ids that other files record: the `SPEC_COMMIT` files in obx-go, node-go and node-php, node-go's `ui/dist/ADMIN_UI_COMMIT`, the website's `src/data/errors.json`, the changelogs, and the ids on this page and on [implementations](implementations.md). Or keep the history and use a no-reply address from now on. Once the repositories are public, a rewrite no longer hides anything.
    - *Sign-off.* The commits have no `Signed-off-by` line, while CONTRIBUTING.md asks contributors for one; the check runs on pull requests only. That is fine for the author's own commits; signing off from now on sets the example.
16. **Make them public** (Settings → General → Danger zone): `spec`, `obx-go`, `admin-ui`, `node-go`, `node-php`, `node-ts`, `website`. In each one: Settings → Code security → enable *Private vulnerability reporting* (SECURITY.md and the issue templates link to it), secret scanning with push protection, and Dependabot alerts. Optionally a ruleset on `main` that requires the CI checks for pull requests (with yourself allowed to bypass).
17. **Deploy the website:** run the *deploy* workflow of `website` by hand; its first run creates the Pages project `openbrandexchange`. Then Workers & Pages → openbrandexchange → Custom domains → add `openbrandexchange.com` and `www.openbrandexchange.com` (the DNS records are created for you), add a redirect rule `www.openbrandexchange.com/*` → `https://openbrandexchange.com/$1` (301), and set SSL/TLS → Edge Certificates → *Always Use HTTPS* on and minimum TLS 1.2. The site sends HSTS with `includeSubDomains`, so every subdomain must be HTTPS-only. Check `/`, `/reference/`, `/errors/not_found` and `/schemas/v0.1/Product.json`. Details: the website's `docs/deploying.md`.
18. Run CI on every repository again (step 1). The conformance and spec cross-checks now run without `OBX_READ_TOKEN`; delete the token.
19. **Dependabot** (all major or 0.x bumps; merge only on green CI): obx-go #1 alpine 3.24, #2 golang 1.27, #3 actions; admin-ui #2 openapi-fetch 0.17, #3 @vitejs/plugin-react 6, #4 TypeScript 7, #5 vitest 5 (needs Node 22.12 or later, so drop Node 20 from the admin-ui CI matrix with it), #6 react-i18next 17; node-go #1 golang 1.27 (together with the `go.mod` toolchain); node-php #1 phpseclib 4; node-ts #1 bun 1.4, #2 litestream 0.5, #3 TypeScript 7; website #1 to #4 actions, #5 TypeScript 7. The action bumps are the safe ones to start with.

### F. First releases

Each version tag starts a release workflow that builds everything and creates a **draft** GitHub release for you to review and publish.

20. `spec`: `git tag v0.1.0 && git push origin v0.1.0` → bundle (tar.gz and zip), CycloneDX SBOM, SHA256SUMS.
21. `obx-go`: in CHANGELOG.md change `## [0.1.0] - unreleased` to the release date and commit; `git tag v0.1.0 && git push origin v0.1.0` → archives for Linux, macOS and Windows on amd64 and arm64, checksums, SBOMs, `ghcr.io/openbrandexchange/obx` (amd64 and arm64), the Homebrew formula `obx.rb` and build provenance. After publishing the release: `git tag -f v0 && git push -f origin v0` (the push action is referenced as `@v0`), make the GHCR package `obx` public, create the repository `openbrandexchange/homebrew-tap` and copy the release's `obx.rb` to `Formula/obx.rb` there.
22. `admin-ui`: the annotated tag `v0.1.1` on `d3ee574` (the build every portal vendors) exists only in the local checkout it was made in. Push it from there with `git push origin v0.1.1`, or create it anywhere with `git tag -a v0.1.1 d3ee574 -m "admin-ui 0.1.1"` first → tarball, zip, SBOM, SHA256SUMS, provenance. GitHub already has a `v0.1.0` tag from before the release workflow existed; no release was made from it, and none is needed.
23. `node-go`, `node-php`, `node-ts`: each CHANGELOG.md has `## [0.1.0] - 2026-09-28`; change that to the release date, then `git tag v0.1.0 && git push origin v0.1.0` in each → the binaries (node-go, node-ts) or the release zip for FTP hosting (node-php), checksums, SBOMs, provenance and the images `ghcr.io/openbrandexchange/node-go`, `node-php` and `node-ts` for amd64 and arm64. Publish the drafts and make the three GHCR packages public. Then update the website's status texts in all 25 languages (the draft banner, the home page status, "Version 0.1 (draft)" on the developers page, the FAQ "Is it ready?", the brochures' "Coming next" list; `npm run build:brochures`) and check the external links: `npm run build && node tools/check-links.mjs dist --external`.

### G. The first real portals

24. **Deploy each edition once for real** before a brand relies on it:
    - Portal for Cloudflare: the Deploy to Cloudflare button (or `bun run deploy`) on a Workers **Paid** account ($5 per month; the free plan's CPU and D1 limits are too small for daily use); check that D1, R2 and the cron trigger exist and `/readyz` answers 200.
    - Portal for Google Cloud & Docker: `DRY_RUN=1 ./deploy/cloudrun.sh`, then `./deploy/cloudrun.sh` in a project with billing; and once `DOMAIN=… ADMIN_EMAIL=… docker compose up -d` on a server with a public DNS name, to see Let's Encrypt issue the certificate.
    - Portal for web hosting: upload the release zip to a real shared host over FTP and open the site; the installer starts.
25. **E-mail for every portal:** node-ts `OBX_MAIL_PROVIDER` (resend, postmark, sendgrid, mailchannels or webhook) with `OBX_MAIL_API_KEY` and a verified `OBX_MAIL_FROM`; node-go `OBX_SMTP_URL` and `OBX_MAIL_FROM`; node-php PHP `mail()` or the `OBX_SMTP_*` settings. Without it no invitations, access decisions or password links go out; the admin's "Get started" list says so.
26. Have native speakers review the 21 languages other than English, Dutch, German and French (admin UI, installer, `obx`, website, brochures, and the glossary's "(in formation)" and "An initiative of"), Irish and Maltese first.

## Known limitations

Documented in each repository's NOTES.md and docs; none of them blocks a first brand.

**All three portals**
- The personal-data API (`GET /admin/api/audit-log`, the exports per retailer, person and self, `DELETE /admin/api/me`, `Settings.retention`) has the same paths and shapes everywhere but is not in `node-admin.yaml` yet, and the admin UI has no screens for it; a brand answers an access or erasure request through the API. node-go stores no IP addresses.
- Moving between upload tools (the admin's browser upload, `obx`, a portal that makes its own image versions) re-uploads every image once, because each makes slightly different web versions.
- An EAN pasted with spaces inside one code (as copied from some PDFs) becomes several invalid codes: the lookup splits on every non-digit.
- Import rules 8 and 9 (an import never removes what it does not state) are for imports; the Ingest API's `PUT` keeps its replace semantics ([import-format.md](import-format.md#4-processing-rules)).
- HSTS without `includeSubDomains`, on purpose: a brand's other subdomains are not the portal's to decide.
- Rate limits live in memory per instance on node-go (which runs as one instance) and, for the retailers' API, per isolate on Workers; the sign-in and other security limits of node-ts and all limits of node-php are kept in the database.

**Portal for Cloudflare (node-ts):** Workers has no image library, so web versions come from the browser or `obx` (without them the original is served and flagged in the admin); SFTP imports need the Bun build and are not offered on Workers; passwords are bcrypt on Workers and argon2id on Bun, so a database moved from Bun to Workers needs password resets; a missing file under `/assets/` on Workers gets the start page instead of a 404 (a documented trade-off); the D1 row figures in `docs/hosting-cloudflare.md` are estimates.

**Portal for Google Cloud & Docker (node-go):** with SQLite and Litestream on Cloud Run or Fly.io, changes made on the old instance during the few seconds of a switch-over can be lost (PostgreSQL avoids it; `docs/upgrading.md`); embedded ICC colour profiles are not converted; unreferenced files are not cleaned up; `OBX_SECRET_KEY` cannot be rotated; dates in e-mails are ISO dates in every language.

**Portal for web hosting (node-php):** GD ignores EXIF orientation and ICC profiles and cannot read TIFF (the installer and imports say so); without mod_rewrite (or the nginx rules) every address answers with a one-line explanation; hosts that ignore `.user.ini` keep PHP's own upload limits (upload images as one zip); the audit log keeps client IP addresses for at most `retention.ip_days` (30); `/metrics` has database gauges only.

**obx-go:** tests run on Linux and macOS; Windows builds are cross-compiled but not tested, and the PowerShell completion is not syntax-checked; `obx pull` of a very large catalog is bound by the file system (one file per object); govulncheck reports GO-2026-5932 (the unmaintained `golang.org/x/crypto/openpgp`) in a required module, which neither obx-go nor node-go imports and which has no fixed version.

## Found and fixed in the last review

- **CI that was red before GitHub stopped starting jobs:** obx-go's snapshot build had no `go-licenses` and its interop script failed the runner's older shellcheck; node-go failed staticcheck on an unused helper; admin-ui's committed `dist/` had been built from uncommitted work; node-php failed six jobs on Linux only (root-owned files left by Docker steps, a licence check that needed an installed `vendor/`, an installer copy without `vendor/`, S3 uploads failing once the runner's disk left room for too few storage volumes, an older shellcheck).
- **Imports that removed data:** an import of images without their `assets.csv` row lifted embargoes and cleared credits and AI labels, including ones set in the admin; a `products.csv` without some columns removed those fields, in every language. Both now keep what the file does not state ([rules 8 and 9](import-format.md#4-processing-rules)) in the spec, the three portals and the mock, with conformance checks I-IMP-5 and I-IMP-6 that fail on the old behaviour.
- **Rights that did not travel with downloads:** portal zips held only the image files. Every zip now carries an `assets.csv` with each image's rights, embargo and AI provenance ([§2.3](import-format.md#assets-csv-in-downloads), checked by A-PORT-1).
- **Implementations that had drifted from the spec:** the image filename rule was read three ways (now shared test vectors in `fixtures/expected/image-filenames.json` that every implementation runs); two portals still reported `spec_version` `0.1.0-draft`; new API keys got `usage:write` by default on node-go and node-php; renewing an approved key left a dead secret waiting for the requester on node-go and node-php; node-ts named a retention setting differently; the Cloudflare edition offered SFTP imports it cannot run; the admin did not ask a brand without e-mail to set it up; admin-ui's generated API types lagged behind the spec (its CI cross-check would have failed) and its test runner had a moderate advisory (dev only); the website's directory check used its own, already outdated copy of three spec schemas.
- **What would have looked bad in public:** a debug script in the spec; problem-type and schema URLs that led nowhere (the website now serves `/errors/<code>`, `/schemas/v0.1/…` and `/reference/`); internal wording such as "the brief" in notes; a website footer that read as the licence of all project code; the website counting three conformance profiles instead of four; CI checks that would have kept skipping after going public until someone added a token.
