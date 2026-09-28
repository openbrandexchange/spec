#!/bin/sh
# shellcheck disable=SC2086 # $paths is a list of top-level paths without spaces, split on purpose
# Builds the release bundle in dist/ from the committed tree (HEAD):
#   obx-spec-<version>.tar.gz and .zip  (docs, governance, openapi, schemas, fixtures, site, licence files)
#   obx-spec-<version>.sbom.cdx.json     (CycloneDX SBOM)
#   SHA256SUMS
# Refuses to run with uncommitted changes in the packaged paths (set ALLOW_DIRTY=1 to override).
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
name="obx-spec-$version"
paths="README.md CHANGELOG.md LICENSE NOTICE SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md docs governance openapi schemas fixtures site"
if [ -z "${ALLOW_DIRTY:-}" ] && [ -n "$(git status --porcelain -- $paths)" ]; then
  echo "uncommitted changes in the packaged files; commit them first (or ALLOW_DIRTY=1)" >&2
  exit 1
fi
node tools/build-site.mjs --check
rm -rf dist && mkdir -p dist
# git archive is reproducible for a given commit (file order, mode and mtime come from the commit).
# docs/go-live.md is the checklist for publishing the project, not part of the specification.
git archive --format=tar --prefix="$name/" HEAD $paths ":(exclude)docs/go-live.md" | gzip -n -9 > "dist/$name.tar.gz"
git archive --format=zip --prefix="$name/" -o "dist/$name.zip" HEAD $paths ":(exclude)docs/go-live.md"
node tools/sbom.mjs > "dist/$name.sbom.cdx.json"
if command -v sha256sum >/dev/null 2>&1; then sum="sha256sum"; else sum="shasum -a 256"; fi
(cd dist && $sum "$name.tar.gz" "$name.zip" "$name.sbom.cdx.json" > SHA256SUMS)
cat dist/SHA256SUMS
