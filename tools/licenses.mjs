#!/usr/bin/env node
// Licence check: every package in package-lock.json, and every third-party file vendored
// into the repository, must carry a licence from the allowlist. Nothing is shipped from
// node_modules (all npm packages are build tools), but the rule keeps the tooling open too.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ALLOWED = ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0", "CC-BY-4.0", "BlueOak-1.0.0", "Python-2.0"];
// File-level copyleft is fine for tools that only run in tests and are never shipped.
export const DEV_ONLY_ALLOWED = ["MPL-2.0"];
// Third-party files committed to the repository (shipped in site/ and the release bundle).
export const VENDORED = [
  { path: "tools/vendor/redoc.standalone.js", name: "redoc", version: "2.5.4", license: "MIT", notice: "tools/vendor/redoc.LICENSE" },
];

export function checkLicenses(lock) {
  const problems = [], seen = [];
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (!path) continue;
    const name = path.replace(/^.*node_modules\//, "");
    const expr = pkg.license ?? "(none)";
    // An SPDX "OR" expression is fine when one side is allowed; "AND" needs every side.
    const allowed = pkg.dev ? [...ALLOWED, ...DEV_ONLY_ALLOWED] : ALLOWED;
    const ok = expr.split(/\s+OR\s+/).some((alt) => alt.replace(/[()]/g, "").split(/\s+AND\s+/).every((l) => allowed.includes(l.trim())));
    seen.push(`${name}@${pkg.version} ${expr}`);
    if (!ok) problems.push(`${name}@${pkg.version}: licence ${expr} is not in the allowlist`);
  }
  return { problems, seen };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, seen } = checkLicenses(JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")));
  for (const v of VENDORED) {
    const head = readFileSync(join(root, v.notice), "utf8");
    if (!/MIT License/.test(head) || !/Permission is hereby granted/.test(head)) problems.push(`${v.path}: notice file does not contain the ${v.license} licence`);
    seen.push(`${v.name}@${v.version} ${v.license} (vendored)`);
  }
  if (problems.length) {
    console.error(`✗ licences:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`✓ licences: ${seen.length} packages, all in the allowlist (${[...new Set(seen.map((s) => s.split(" ").slice(1).join(" ")))].join(", ")}).`);
}
