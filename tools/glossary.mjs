#!/usr/bin/env node
// Checks docs/glossary.md: every table that lists languages has exactly the 25
// project languages in code order and no empty cell. With --compare <glossary.json>
// (the admin UI's machine-readable copy) it also checks that the core terms and the
// edition names are identical. Used by tools/validate.mjs; run on its own with
//   node tools/glossary.mjs [--compare ../admin-ui/src/i18n/glossary.json]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const LANGUAGES = ["bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "ga", "hr", "hu", "it", "lt", "lv", "mt", "nb", "nl", "pl", "pt", "ro", "sk", "sl", "sv"];

// Column header in glossary.md -> key in glossary.json "terms".
const CORE_COLUMNS = {
  "Portal word": "portal",
  "API key for your software": "apiKey",
  "Automatic upload": "automaticUpload",
  "Request access": "requestAccess",
  Article: "article",
  Colour: "colour",
  Size: "size",
};

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** Parses every markdown table into {header, rows}. */
export function parseTables(markdown) {
  const tables = [];
  let current = null;
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) { current = null; continue; }
    const row = cells(line);
    if (!current) { current = { header: row, rows: [] }; tables.push(current); continue; }
    if (row.every((c) => /^:?-+:?$/.test(c))) continue;
    current.rows.push(row);
  }
  return tables;
}

/** Returns a list of problems in the glossary text (empty = fine). */
export function checkGlossary(markdown, json) {
  const problems = [];
  const langTables = parseTables(markdown).filter((t) => t.header[0] === "Language");
  if (langTables.length < 2) problems.push(`expected the core-terms and the foundation tables, found ${langTables.length} language table(s)`);
  const core = {};
  for (const t of langTables) {
    const name = t.header.slice(1).join(" / ");
    const codes = t.rows.map((r) => /\(`([a-z]{2,3})`\)/.exec(r[0])?.[1] ?? `?${r[0]}`);
    if (codes.join(",") !== LANGUAGES.join(",")) problems.push(`table "${name}": languages ${codes.join(",")} instead of ${LANGUAGES.join(",")}`);
    t.rows.forEach((r, i) => {
      if (r.length !== t.header.length) problems.push(`table "${name}", ${codes[i]}: ${r.length} cells, header has ${t.header.length}`);
      r.forEach((c, j) => { if (!c) problems.push(`table "${name}", ${codes[i]}: "${t.header[j]}" is empty`); });
    });
    if (t.header[1] === "Portal word") {
      t.header.slice(1).forEach((h, j) => {
        const key = CORE_COLUMNS[h];
        if (!key) return problems.push(`core table: unknown column "${h}"`);
        core[key] = Object.fromEntries(t.rows.map((r, i) => [codes[i], r[j + 1]]));
      });
    }
  }
  if (!Object.keys(core).length) problems.push("core-terms table (Language | Portal word | …) not found");
  const editions = parseTables(markdown).find((t) => t.header[0] === "Repository" && t.header[1] === "Edition name");
  if (!editions) problems.push("editions table not found");
  if (json) {
    for (const [key, byLang] of Object.entries(core)) {
      for (const lang of LANGUAGES) {
        const want = json.terms?.[key]?.[lang];
        if (want !== byLang[lang]) problems.push(`${key}.${lang}: glossary.md "${byLang[lang]}", glossary.json "${want}"`);
      }
    }
    for (const row of editions?.rows ?? []) {
      const repo = row[0].replace(/`/g, "");
      if (json.editions?.[repo] !== row[1]) problems.push(`edition ${repo}: glossary.md "${row[1]}", glossary.json "${json.editions?.[repo]}"`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const i = process.argv.indexOf("--compare");
  const json = i > 0 ? JSON.parse(readFileSync(process.argv[i + 1], "utf8")) : null;
  const problems = checkGlossary(readFileSync(join(root, "docs", "glossary.md"), "utf8"), json);
  if (problems.length) {
    console.error(`✗ glossary: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`✓ glossary: ${LANGUAGES.length} languages complete${json ? ", identical to glossary.json" : ""}.`);
}
