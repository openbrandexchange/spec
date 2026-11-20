#!/usr/bin/env node
// Licence check: every package in bun.lock, and every third-party file vendored into the
// repository, must carry a licence from the allowlist. Nothing is shipped from node_modules
// (all npm packages are build tools), but the rule keeps the tooling open too. bun.lock has
// no licence field, so the licence comes from the installed package.json (run bun install first).
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ALLOWED = ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0", "CC-BY-4.0", "BlueOak-1.0.0", "Python-2.0"];
// File-level copyleft is fine for tools that only run in tests and are never shipped.
// Zlib (permissive, OSI) is pako, the deflate library of jszip under exceljs (tools/templates.mjs).
export const DEV_ONLY_ALLOWED = ["MPL-2.0", "Zlib"];
// Third-party files committed to the repository (shipped in site/ and the release bundle).
export const VENDORED = [
  { path: "tools/vendor/redoc.standalone.js", name: "redoc", version: "2.5.4", license: "MIT", notice: "tools/vendor/redoc.LICENSE" },
];

// The packages of bun.lock as { name, version, license, integrity, dev }. bun.lock is JSON
// with trailing commas. A key "a/b" is package b nested in node_modules/a/node_modules/b.
export function readLock() {
  const text = readFileSync(join(root, "bun.lock"), "utf8").replace(/,(\s*[}\]])/g, "$1");
  const lock = JSON.parse(text);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  // Every dependency is a devDependency (nothing from node_modules is shipped).
  const dev = Object.keys(manifest.dependencies ?? {}).length === 0;
  const entries = lock.packages ?? {};
  const nameOf = (key) => { const id = entries[key][0]; return id.slice(0, id.lastIndexOf("@")); };
  const dirOf = (key) => {
    const name = nameOf(key), parent = key.slice(0, -name.length - 1);
    return parent ? join(dirOf(parent), "node_modules", name) : join(root, "node_modules", name);
  };
  return Object.keys(entries).map((key) => {
    const [id, , , integrity] = entries[key];
    const name = nameOf(key), version = id.slice(name.length + 1);
    const pj = join(dirOf(key), "package.json");
    let license;
    if (existsSync(pj)) {
      const meta = JSON.parse(readFileSync(pj, "utf8"));
      license = meta.license ?? meta.licenses;
      if (Array.isArray(license)) license = license.map((l) => l.type ?? l).join(" OR ");
      else if (license && typeof license === "object") license = license.type;
    }
    return { name, version, license, integrity: typeof integrity === "string" ? integrity : undefined, dev, installed: existsSync(pj) };
  });
}

export function checkLicenses(packages) {
  const problems = [], seen = [];
  for (const pkg of packages) {
    const name = pkg.name;
    if (!pkg.installed) { problems.push(`${name}@${pkg.version}: not installed (run bun install)`); continue; }
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
  const { problems, seen } = checkLicenses(readLock());
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
