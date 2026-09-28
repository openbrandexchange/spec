# Contributing to the Open Brand Exchange specification

Thank you for helping. Brands, retailers, software vendors and individuals are all welcome. How decisions are made is described in [docs/governance.md](docs/governance.md); everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Questions and ideas:** open an issue with the *Question* or *Spec change* template.
- **Vulnerabilities:** never in public; see [SECURITY.md](SECURITY.md).
- **Anything beyond wording** (a new field, endpoint, error code, change of behaviour): open an issue or a pull request with the `RFC` label and a short rationale first. Substantive RFCs stay open for comments for at least 14 days.

## Making a change

```sh
npm ci
npm run check        # Redocly lint, schema/fixture/doc validation, glossary, links, versions
npm run build:site   # regenerate the HTML reference in site/ (commit it with your change)
```

A normative change updates, in the same pull request:

1. the OpenAPI file(s) in `openapi/` and the JSON Schemas in `schemas/`;
2. the prose in `docs/`;
3. the fixtures and expected objects in `fixtures/` (and `fixtures/generate.py` when the generated files change);
4. the rendered reference in `site/` (`npm run build:site`);
5. `CHANGELOG.md` under **Unreleased** (Added / Changed / Clarified / Fixed / Security; "Breaking" with a migration note).

`npm run check` must pass; CI also verifies that `site/` matches the sources.

Style: short sentences, active voice, RFC 2119 keywords in capitals only when they are meant normatively, `snake_case` field names, examples with the fictional *Kestrel Outfitters* (GTINs with the restricted `200` prefix, `.example` domains). Never put real customer data in fixtures or examples. User-facing words follow the [glossary](docs/glossary.md).

## Sign your commits (DCO)

Contributions are accepted under the [Developer Certificate of Origin 1.1](https://developercertificate.org/). By signing off you certify that you wrote the change or otherwise have the right to submit it under this repository's licence (CC-BY-4.0). Add a `Signed-off-by` line to every commit:

```sh
git commit -s -m "Clarify tombstone retention"
# Signed-off-by: Your Name <you@example.org>
```

Use your real name and an address you can be reached at. There is no contributor licence agreement: you keep the copyright in your contribution. Pull requests with unsigned commits cannot be merged; `git rebase --signoff main` fixes an existing branch.

## Patents

By contributing you are asked to commit, as the publisher does, not to assert patents you hold or control against implementations of the specification, to the extent needed to implement it ([governance](docs/governance.md#patents)).

## Releases

Maintainers release by tagging `vX.Y.Z` after the changelog is complete ([versioning](docs/versioning.md)). The release workflow then builds the spec bundle (OpenAPI, schemas, fixtures, rendered reference) with checksums and a software bill of materials, as a draft GitHub release.
