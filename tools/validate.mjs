#!/usr/bin/env node
// Validates the spec repository: JSON Schemas compile, every fixture/example validates,
// the canonical CSV fixtures follow docs/import-format.md, and docs list the same error
// codes as the schema. Exit code 1 on any failure. Run: npm run validate (or bun tools/validate.mjs).
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
let checked = 0;

// ---------------------------------------------------------------- schemas
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
addFormats(ajv);
const schemaDir = join(root, "schemas");
const schemaNames = readdirSync(schemaDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
for (const name of schemaNames) ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, `${name}.json`), "utf8")));
const validators = {};
for (const name of schemaNames) {
  try {
    validators[name] = ajv.getSchema(`https://openbrandexchange.com/schemas/v0.1/${name}.json`);
  } catch (e) {
    fail(`schemas/${name}.json`, `does not compile: ${e.message}`);
  }
}

function check(schema, value, where) {
  checked++;
  const v = validators[schema];
  if (!v) return fail(where, `no schema ${schema}`);
  if (!v(value)) fail(where, `${schema}: ${ajv.errorsText(v.errors, { separator: "\n    " })}`);
}

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------------------------------------------------------------- GTIN helpers
function gtinValid(code) {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = code.padStart(14, "0").split("").map(Number);
  const sum = digits.slice(0, 13).reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === digits[13];
}
function walkGtins(value, where) {
  if (Array.isArray(value)) return value.forEach((v, i) => walkGtins(v, `${where}[${i}]`));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if ((k === "gtin" || k === "gtin_original") && typeof v === "string" && !v.includes("{{") && !gtinValid(v)) {
        fail(where, `${k} ${v} has an invalid check digit`);
      }
      walkGtins(v, `${where}.${k}`);
    }
  }
}

// ---------------------------------------------------------------- examples
const exDir = join(root, "fixtures", "examples");
for (const file of readdirSync(exDir).sort()) {
  const schema = file.split(".")[0];
  if (!validators[schema]) continue; // e.g. webhook-signature-vector.json
  const path = join(exDir, file);
  if (file.endsWith(".ndjson")) {
    readFileSync(path, "utf8").split("\n").filter(Boolean).forEach((line, i) => check(schema, JSON.parse(line), `${file}:${i + 1}`));
  } else {
    const doc = readJSON(path);
    check(schema, doc, file);
    if (!file.includes("error")) walkGtins(doc, file);
  }
}
const sigVec = readJSON(join(exDir, "webhook-signature-vector.json"));
{
  const { createHmac } = await import("node:crypto");
  const hex = createHmac("sha256", sigVec.secret).update(`${sigVec.timestamp}.${sigVec.raw_body}`).digest("hex");
  checked++;
  if (`v1=${hex}` !== sigVec.header) fail("webhook-signature-vector.json", "signature does not match");
  check("WebhookEvent", JSON.parse(sigVec.raw_body), "webhook-signature-vector.json raw_body");
}

// ---------------------------------------------------------------- expected protocol objects
const PLACEHOLDERS = {
  "{{id}}": "x1",
  "{{datetime}}": "2026-09-28T10:00:00Z",
  "{{datetime|null}}": null,
  "{{url}}": "https://example.org/x",
  "{{sha256}}": "a".repeat(64),
  "{{int}}": 1,
};
function substitute(value) {
  if (Array.isArray(value)) return value.map(substitute);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v)]));
  if (typeof value === "string" && value.startsWith("{{")) {
    if (value in PLACEHOLDERS) return PLACEHOLDERS[value];
    if (/^\{\{product:[^}]+\}\}$/.test(value)) return value; // resolved below
    fail("expected", `unknown placeholder ${value}`);
  }
  return value;
}
const expDir = join(root, "fixtures", "expected");
const expectedProducts = {};
for (const file of readdirSync(expDir).sort()) {
  const doc = substitute(readJSON(join(expDir, file)));
  walkGtins(doc, file);
  if (file.startsWith("product-")) {
    check("ProductDetail", doc, file);
    expectedProducts[doc.external_id] = doc;
  } else if (file.startsWith("asset-")) check("Asset", doc, file);
}
{
  const lookup = substitute(readJSON(join(expDir, "gtin-lookup.json")));
  lookup.products = lookup.products.map((p) => expectedProducts[p.slice(10, -2)]).filter(Boolean);
  check("GtinLookupResult", lookup, "gtin-lookup.json");
}

// ---------------------------------------------------------------- ingest scenario
const ingestDir = join(root, "fixtures", "ingest");
const inputSchema = { brand: "BrandInput", product: "ProductInput", variant: "VariantInput", asset: "AssetInput" };
const ops = readFileSync(join(ingestDir, "script.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const results = readJSON(join(ingestDir, "expected-results.json"));
const blobShas = new Set(Object.values(readJSON(join(ingestDir, "files", "files.json"))).map((f) => f.sha256));
ops.forEach((op, i) => {
  const where = `ingest/script.ndjson:${i + 1}`;
  check("IngestOperation", op, where);
  if (op.op === "upsert") check(inputSchema[op.kind], op.data, `${where} data`);
  const expectError = results[i]?.result === "error";
  if (!expectError) walkGtins(op.data ?? {}, where);
  for (const f of Object.values(op.data?.files ?? {})) if (!blobShas.has(f.sha256)) fail(where, `unknown blob ${f.sha256}`);
});
checked++;
if (results.length !== ops.length) fail("ingest/expected-results.json", `has ${results.length} results for ${ops.length} operations`);
for (const c of readJSON(join(ingestDir, "expected-changes.json")).changes) {
  checked++;
  if (!(c.after_op >= 0 && c.after_op < ops.length)) fail("ingest/expected-changes.json", `after_op out of range: ${JSON.stringify(c)}`);
  if (results[c.after_op].result === "error" || results[c.after_op].result === "unchanged") {
    fail("ingest/expected-changes.json", `op ${c.after_op} is ${results[c.after_op].result} but produced a change`);
  }
}

// ---------------------------------------------------------------- canonical CSV fixtures
function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}
const PRODUCT_COLUMNS = /^(brand|product_id|style_number|name|description|item_type|target_group|season|collection|gpc_brick|materials|care|country_of_origin|dpp_url|status|variant_id|gtin|sku|color_code|color_name|supplier_color|size|size_system|variant_status|image_files)(:[a-z]{2,3}(-[A-Z]{2})?)?$|^attr:[a-z][a-z0-9_]{0,63}$/;
const ASSET_COLUMNS = /^(file|asset_id|product_id|style_number|color_code|position|role|view|alt_text|license|license_text|channels|territories|embargo_until|expires_at|credit|model_release|ai_generated|ai_edited|source|c2pa|c2pa_manifest_url|generator|status)(:[a-z]{2,3}(-[A-Z]{2})?)?$/;
const MATERIALS = /^\s*(([a-z][a-z0-9_]*)\s*:\s*)?\d+(\.\d+)?%\s+[a-z][a-z0-9_]*(\s*,\s*\d+(\.\d+)?%\s+[a-z][a-z0-9_]*)*\s*(;\s*(([a-z][a-z0-9_]*)\s*:\s*)?\d+(\.\d+)?%\s+[a-z][a-z0-9_]*(\s*,\s*\d+(\.\d+)?%\s+[a-z][a-z0-9_]*)*\s*)*$/;
const ROLES = ["packshot", "model", "detail", "ghost", "flatlay", "scene", "swatch", "size_chart", "other"];
const VIEWS = ["front", "back", "side", "left", "right", "top", "bottom", "tilted_left", "tilted_right", "inside", "detail", "other"];

// Filename pattern per docs/import-format.md: {style}_{color}_{position}[_{qualifier}...].{ext}
export function parseImageFilename(name) {
  const m = /^(.+)\.(jpe?g|png|webp|tiff?)$/i.exec(name);
  if (!m) return null;
  const parts = m[1].split("_");
  const quals = [];
  while (parts.length > 3 && (ROLES.includes(parts.at(-1).toLowerCase()) || VIEWS.includes(parts.at(-1).toLowerCase()))) {
    quals.unshift(parts.pop().toLowerCase());
  }
  if (parts.length < 3 || !/^[1-9][0-9]{0,2}$/.test(parts.at(-1))) return null;
  const position = Number(parts.pop());
  const color = parts.pop();
  return { style: parts.join("_"), color, position, qualifiers: quals };
}

const kestrel = join(root, "fixtures", "kestrel");
const productRows = parseCSV(readFileSync(join(kestrel, "products.csv"), "utf8"));
const header = productRows[0].map((h) => h.trim().toLowerCase());
header.forEach((h) => { checked++; if (!PRODUCT_COLUMNS.test(h)) fail("products.csv", `unknown column ${h}`); });
const col = (row, name) => row[header.indexOf(name)] ?? "";
const styles = new Map();
const seenGtins = new Set();
productRows.slice(1).forEach((row, i) => {
  const where = `products.csv row ${i + 1}`;
  checked++;
  if (row.length !== header.length) fail(where, `has ${row.length} fields, header has ${header.length}`);
  const gtin = col(row, "gtin");
  if (gtin && !gtinValid(gtin)) fail(where, `invalid GTIN ${gtin}`);
  if (gtin && seenGtins.has(gtin)) fail(where, `duplicate GTIN ${gtin}`);
  seenGtins.add(gtin);
  if (!col(row, "style_number")) fail(where, "style_number is required");
  if (!MATERIALS.test(col(row, "materials"))) fail(where, `materials does not match the grammar: ${col(row, "materials")}`);
  for (const code of col(row, "care").split("|")) if (!/^[a-z][a-z0-9_]{0,63}$/.test(code)) fail(where, `bad care code ${code}`);
  if (!styles.has(col(row, "style_number"))) styles.set(col(row, "style_number"), new Set());
  styles.get(col(row, "style_number")).add(col(row, "color_code"));
});
const images = readdirSync(join(kestrel, "images"));
const positions = new Set();
for (const img of images) {
  checked++;
  const p = parseImageFilename(img);
  if (!p) { fail(`images/${img}`, "does not match {style}_{color}_{position}[_qualifier].ext"); continue; }
  if (!styles.get(p.style)?.has(p.color)) fail(`images/${img}`, "no product row with this style and colour");
  const key = `${p.style}_${p.color}_${p.position}`;
  if (positions.has(key)) fail(`images/${img}`, `duplicate position ${key}`);
  positions.add(key);
}
const assetRows = parseCSV(readFileSync(join(kestrel, "assets.csv"), "utf8"));
assetRows[0].forEach((h) => { checked++; if (!ASSET_COLUMNS.test(h.trim().toLowerCase())) fail("assets.csv", `unknown column ${h}`); });
for (const row of assetRows.slice(1)) { checked++; if (!images.includes(row[0])) fail("assets.csv", `file ${row[0]} not in images/`); }

// A few behavioural checks of the filename rule itself (docs/import-format.md examples).
const cases = [
  ["KO-1001_NVY_1.jpg", { style: "KO-1001", color: "NVY", position: 1, qualifiers: [] }],
  ["KO-1003_RST_3_model.png", { style: "KO-1003", color: "RST", position: 3, qualifiers: ["model"] }],
  ["AB_12_34_BLK_2_packshot_back.JPG", { style: "AB_12_34", color: "BLK", position: 2, qualifiers: ["packshot", "back"] }],
  ["KO-1001_NVY_front.jpg", null],
  ["KO-1001_NVY_0.jpg", null],
];
for (const [name, want] of cases) {
  checked++;
  if (JSON.stringify(parseImageFilename(name)) !== JSON.stringify(want)) fail("filename rule", `${name} -> ${JSON.stringify(parseImageFilename(name))}`);
}

// ---------------------------------------------------------------- docs consistency
const codes = readJSON(join(schemaDir, "Common.json")).$defs.ErrorCode.enum;
const protocolDoc = join(root, "docs", "protocol.md");
if (existsSync(protocolDoc)) {
  const doc = readFileSync(protocolDoc, "utf8");
  for (const code of codes) { checked++; if (!doc.includes(`\`${code}\``)) fail("docs/protocol.md", `error code ${code} is not documented`); }
} else fail("docs/protocol.md", "missing");

if (failures.length) {
  console.error(`✗ ${failures.length} problem(s) in ${checked} checks:\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log(`✓ ${checked} checks passed (${schemaNames.length} schemas, fixtures, CSV, docs).`);
