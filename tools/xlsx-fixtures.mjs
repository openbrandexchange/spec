#!/usr/bin/env node
// Fixtures for the Excel import (docs/import-format.md §5, a node feature): writes
// fixtures/imports/xlsx/*.xlsx and fixtures/imports/xlsx/expected.json.
//
//   node tools/xlsx-fixtures.mjs           # (re)write the fixtures
//   node tools/xlsx-fixtures.mjs --check   # fail when they are stale, or when the reference
//                                          # conversion (tools/xlsx.mjs) does not give expected.json
//
// The workbooks are written part by part (raw SpreadsheetML), so each edge case is exactly what
// it claims to be; the two template fixtures are copies of templates/*.xlsx. The expected rows
// below are written by hand, not computed by tools/xlsx.mjs, so the check tests the reference
// conversion against the rules rather than against itself. Output is deterministic (fixed zip
// dates); the check compares unzipped parts so a zlib difference cannot fail it.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { convertWorkbook, WorkbookError, numberText, serialText, dateKind, zeroPad, canonicalCSV, LIMITS } from "./xlsx.mjs";
import { workbookModel, specModel, parseCSV } from "./templates.mjs";

const require = createRequire(import.meta.url);
const JSZip = createRequire(require.resolve("exceljs"))("jszip");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "fixtures", "imports", "xlsx");
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

// ------------------------------------------------------------------ raw workbook writer
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CT = {
  main: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  sheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
  styles: "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
  sst: "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
};
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Cell helpers: return the <c> XML for a reference. */
const C = {
  s: (ref, i, st) => `<c r="${ref}"${st ? ` s="${st}"` : ""} t="s"><v>${i}</v></c>`,
  inl: (ref, text) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`,
  n: (ref, v, st) => `<c r="${ref}"${st ? ` s="${st}"` : ""}><v>${v}</v></c>`,
  b: (ref, v) => `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`,
  e: (ref, v) => `<c r="${ref}" t="e"><v>${esc(v)}</v></c>`,
  d: (ref, v) => `<c r="${ref}" t="d"><v>${v}</v></c>`,
  fstr: (ref, f, v) => `<c r="${ref}" t="str"><f>${esc(f)}</f><v>${esc(v)}</v></c>`,
  fnum: (ref, f, v) => `<c r="${ref}"><f>${esc(f)}</f>${v === undefined ? "" : `<v>${v}</v>`}</c>`,
  empty: (ref, st = 1) => `<c r="${ref}" s="${st}"/>`,
};

/** A shared string table that hands out indexes. Entries are raw <si> inner XML. */
function sst() {
  const items = [];
  const add = (inner) => { items.push(inner); return items.length - 1; };
  return {
    t: (text) => add(`<t xml:space="preserve">${esc(text)}</t>`),
    raw: add,
    xml: () => `${DECL}<sst ${NS} count="${items.length}" uniqueCount="${items.length}">${items.map((x) => `<si>${x}</si>`).join("")}</sst>`,
  };
}

/** Styles: index 0 General, then one xf per entry of fmts ({id, code?}). */
function styles(fmts = []) {
  const custom = fmts.filter((f) => f.code !== undefined);
  return `${DECL}<styleSheet ${NS}>` +
    (custom.length ? `<numFmts count="${custom.length}">${custom.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${esc(f.code)}"/>`).join("")}</numFmts>` : "") +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${fmts.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${fmts.map((f) => `<xf numFmtId="${f.id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

/** rows: [{r, hidden?, cells: [xml]}]; extra: XML after sheetData (mergeCells). */
const sheetXml = (rows, extra = "", pad = "") =>
  `${DECL}<worksheet ${NS}><sheetData>${rows.map((r) => `<row r="${r.r}"${r.hidden ? ' hidden="1"' : ""}>${r.cells.join("")}</row>`).join(pad)}</sheetData>${extra}</worksheet>`;

/**
 * Builds a workbook from parts. spec: {sheets: [{name, state?, xml}], sst?, styles?, date1904?,
 * mainType?, extraParts?: {name: content}, extraTypes?: [[partName, type]], extraDefaults?,
 * extraWbRels?: [xml], workbookPrefix?}
 */
async function workbook(spec) {
  const z = new JSZip();
  const types = [
    ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'],
    ['<Default Extension="xml" ContentType="application/xml"/>'],
    ...(spec.extraDefaults ?? []).map((d) => [d]),
    [`<Override PartName="/xl/workbook.xml" ContentType="${spec.mainType ?? CT.main}"/>`],
    ...spec.sheets.map((_, i) => [`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT.sheet}"/>`]),
    [`<Override PartName="/xl/styles.xml" ContentType="${CT.styles}"/>`],
    ...(spec.sst ? [[`<Override PartName="/xl/sharedStrings.xml" ContentType="${CT.sst}"/>`]] : []),
    ...(spec.extraTypes ?? []).map(([p, t]) => [`<Override PartName="${p}" ContentType="${t}"/>`]),
  ];
  const files = {
    "[Content_Types].xml": `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${types.map((t) => t[0]).join("")}</Types>`,
    "_rels/.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${DECL}${spec.workbookPrefix ?? ""}<workbook ${NS}>${spec.date1904 ? '<workbookPr date1904="1"/>' : "<workbookPr/>"}<sheets>${spec.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ""} r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${spec.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rIdS" Type="${REL}/styles" Target="styles.xml"/>${spec.sst ? `<Relationship Id="rIdT" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` : ""}${(spec.extraWbRels ?? []).join("")}</Relationships>`,
    "xl/styles.xml": spec.styles ?? styles(),
    ...(spec.sst ? { "xl/sharedStrings.xml": spec.sst.xml() } : {}),
    ...Object.fromEntries(spec.sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s.xml])),
    ...(spec.extraParts ?? {}),
  };
  for (const [name, content] of Object.entries(files)) z.file(name, content, { date: FIXED_DATE, createFolders: false });
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
}

/** A small valid products workbook, the base of the refusal fixtures. */
const tiny = (extra = {}, sheetRows) => workbook({
  sheets: [{ name: "Products", xml: sheetXml(sheetRows ?? [{ r: 1, cells: [C.inl("A1", "style_number"), C.inl("B1", "name:en")] }, { r: 2, cells: [C.inl("A2", "KX-9901"), C.inl("B2", "Tiny")] }]) }],
  ...extra,
});

// ------------------------------------------------------------------ the edge cases
const HEADER = ["brand", "style_number", "name:en", "gtin", "color_code", "size", "weight_kg", "contains_animal_origin", "attr:launch_date", "description:en", "collection", "season"];

async function edgeCases() {
  const t = sst();
  const h = HEADER.map((x) => t.t(x));
  const kestrel = t.t("Kestrel");
  const fmts = [
    { id: 49 }, // 1: text "@"
    { id: 164, code: "yyyy-mm-dd" }, // 2
    { id: 165, code: "yyyy-mm-dd hh:mm" }, // 3
    { id: 166, code: "00000000000000" }, // 4: zero padding to 14 digits
    { id: 10 }, // 5: 0.00% (ignored: the value is written as the number)
    { id: 14 }, // 6: built-in date
  ];
  const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const row = (r, cells, hidden) => ({ r, hidden, cells });
  const rows = [
    // header: shared strings, except name:en and season as inline strings
    row(1, HEADER.map((x, i) => (i === 2 || i === 11 ? C.inl(`${L[i]}1`, x) : C.s(`${L[i]}1`, h[i])))),
    row(2, [
      C.s("A2", kestrel), C.s("B2", t.t("KX-9001")), C.s("C2", t.t("Edge Case Tee")),
      C.n("D2", "2000901000015"), // GTIN typed as a number
      C.s("E2", t.t("BLK")), C.n("F2", "42"), C.n("G2", "0.25"), C.b("H2", false),
      C.n("I2", "46082", 2), // date serial with a date format
      C.inl("J2", "=SUM(1,2) is text, not a formula"), // text that starts with "="
      C.fstr("K2", '"Co"&"re"', "Core"), // formula with a cached string
      C.s("L2", t.t("SS26")), // merged L2:L3
    ]),
    row(3, [
      C.s("A3", kestrel), C.s("B3", t.t("KX-9001")), C.s("C3", t.t("Edge Case Tee")),
      C.n("D3", "2000901000022", 4), // number with format 00000000000000 -> 02000901000022
      C.s("E3", t.t("BLK")), C.inl("F3", "44"),
      C.fnum("G3", "0.1+0.2", "0.30000000000000004"), // formula with a cached number
      C.s("L3", t.t("AW26")), // inside the merge: ignored
    ]),
    row(4, [C.empty("A4"), C.inl("B4", "")]), // empty row inside the data
    row(5, [
      C.s("A5", kestrel), C.s("B5", t.t("KX-9002")), C.s("C5", t.t("Formula Gap")), C.s("D5", t.t("2000902000014"), 1),
      C.s("E5", t.t("NVY")), C.s("F5", t.t("M")),
      C.fnum("G5", "G2*2"), // formula without a cached value -> conversion error, row skipped
    ]),
    row(6, [
      C.s("A6", kestrel), C.s("B6", t.t("KX-9003")), C.s("C6", t.t("Bad Check Digit")),
      C.s("D6", t.t("2000903000018"), 1), // wrong check digit (…13 is right): error of the CSV import
      C.s("E6", t.t("RED")), C.s("F6", t.t("L")),
    ]),
    row(7, [
      C.s("A7", kestrel), C.s("B7", t.t("KX-9004")),
      C.s("C7", t.raw('<r><t xml:space="preserve">Hidden Row </t></r><r><rPr><b/></rPr><t>Still Imported</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh>')), // rich text
      C.n("D7", "2.000904000012E+12"), // GTIN as a number written with an exponent
      C.s("E7", t.t("GRN")), C.s("F7", t.t("S")),
      C.n("G7", "12.5", 5), C.b("H7", true), C.n("I7", "46082", 6),
    ], true), // hidden row: imported
    row(8, [
      C.s("A8", kestrel), C.s("B8", t.t("KX-9005")), C.s("C8", t.t("Error Cell")), C.s("D8", t.t("2000905000011"), 1),
      C.s("E8", t.t("YLW")), C.s("F8", t.t("XL")),
      C.e("K8", "#N/A"), // error value -> conversion error, row skipped
    ]),
    row(9, [
      C.s("A9", kestrel), C.s("B9", t.t("KX-9006")), C.s("C9", t.t("Escapes")), C.s("D9", t.t("2000906000010"), 1),
      C.s("E9", t.t("BLK")), C.s("F9", t.t("S")),
      C.n("I9", "46082.5", 3), // date and time
      C.s("J9", t.t("Line one_x000D_\nLine two")), // _x000D_ is a carriage return
      C.s("K9", t.t("Capsule_x005F_x0031_")), // _x005F_ escapes the underscore: Capsule_x0031_
      C.s("M9", t.t("stray")), // right of the header: ignored with a warning
    ]),
    row(10, [C.empty("A10"), C.empty("L10")]),
    row(11, [C.empty("C11")], true),
    row(14, [C.empty("A14"), C.inl("B14", "")]),
  ];
  return workbook({
    sheets: [
      { name: "Read me", xml: sheetXml([row(1, [C.inl("A1", "Notes for the team")]), row(2, [C.inl("A2", "Fill in the Data tab.")])]) },
      { name: "Products", state: "hidden", xml: sheetXml([row(1, [C.inl("A1", "style_number"), C.inl("B1", "name:en")]), row(2, [C.inl("A2", "OLD-1"), C.inl("B2", "Stale")])]) },
      { name: "Data", xml: sheetXml(rows, '<mergeCells count="1"><mergeCell ref="L2:L3"/></mergeCells>') },
    ],
    sst: t,
    styles: styles(fmts),
  });
}
const EDGE_ROWS = [
  HEADER,
  ["Kestrel", "KX-9001", "Edge Case Tee", "2000901000015", "BLK", "42", "0.25", "false", "2026-03-01", "=SUM(1,2) is text, not a formula", "Core", "SS26"],
  ["Kestrel", "KX-9001", "Edge Case Tee", "02000901000022", "BLK", "44", "0.3", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "", ""],
  ["Kestrel", "KX-9003", "Bad Check Digit", "2000903000018", "RED", "L", "", "", "", "", "", ""],
  ["Kestrel", "KX-9004", "Hidden Row Still Imported", "2000904000012", "GRN", "S", "12.5", "true", "2026-03-01", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "", ""],
  ["Kestrel", "KX-9006", "Escapes", "2000906000010", "BLK", "S", "", "", "2026-03-01T12:00:00Z", "Line one\r\nLine two", "Capsule_x0031_", ""],
];
const F = "products.xlsx";
const EDGE_ERRORS = [
  { file: F, row: 5, column: "weight_kg", severity: "error", obx_error: "validation_failed", detail_prefix: "row 5, column weight_kg (G): ", value: "=G2*2" },
  { file: F, row: 8, column: "collection", severity: "error", obx_error: "validation_failed", detail_prefix: "row 8, column collection (K): ", value: "#N/A" },
];
const EDGE_WARNINGS = [{ file: F, row: null, column: null, severity: "warning", obx_error: "validation_failed", detail_prefix: "column M: ", value: null }];

async function date1904() {
  const rows = [
    { r: 1, cells: [C.inl("A1", "brand"), C.inl("B1", "style_number"), C.inl("C1", "name:en"), C.inl("D1", "attr:launch_date")] },
    { r: 2, cells: [C.inl("A2", "Kestrel"), C.inl("B2", "KX-9101"), C.inl("C2", "Date 1904"), C.n("D2", "44620", 1)] },
    { r: 3, cells: [C.inl("A3", "Kestrel"), C.inl("B3", "KX-9102"), C.inl("C3", "ISO date cell"), C.d("D3", "2026-03-01T00:00:00")] },
    { r: 4, cells: [C.inl("A4", "Kestrel"), C.inl("B4", "KX-9103"), C.inl("C4", "Last 1904 date"), C.n("D4", "2957003", 1)] },
  ];
  return workbook({ sheets: [{ name: "products", xml: sheetXml(rows) }], date1904: true, styles: styles([{ id: 164, code: "dd/mm/yyyy" }]) });
}
const DATE1904_ROWS = [
  ["brand", "style_number", "name:en", "attr:launch_date"],
  ["Kestrel", "KX-9101", "Date 1904", "2026-03-01"],
  ["Kestrel", "KX-9102", "ISO date cell", "2026-03-01"],
  ["Kestrel", "KX-9103", "Last 1904 date", "9999-12-31"],
];

/**
 * Empty header cells, header normalisation, CDATA and dates out of range. The sheet is not named
 * Products, so it is found by its key column: "  Style - Number " normalises to style_number only when
 * every run of white space and "-" counts as one "_" (§1.1).
 */
async function emptyHeader() {
  const cdata = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t><![CDATA[${text}]]></t></is></c>`;
  const rows = [
    // C1 has no cell, E1 is an error value (a conversion error that leaves the header empty)
    { r: 1, cells: [C.inl("A1", "Brand"), C.inl("B1", "  Style - Number "), C.inl("D1", "name:en"), C.e("E1", "#REF!"), C.inl("F1", "season"), C.inl("G1", "attr:launch_date")] },
    { r: 2, cells: [C.inl("A2", "Kestrel"), C.inl("B2", "KX-9201"), C.inl("C2", "spacer"), cdata("D2", "Cdata & <Tee>"), C.inl("E2", "x"), C.inl("F2", "SS26"), C.n("G2", "2958465", 1)] },
    { r: 3, cells: [C.inl("A3", "Kestrel"), C.inl("B3", "KX-9202"), C.e("C3", "#DIV/0!"), C.inl("D3", "Error under an empty header")] },
    { r: 4, cells: [C.inl("A4", "Kestrel"), C.inl("B4", "KX-9203"), C.inl("D4", "Year 10000"), C.n("G4", "2958466", 1)] },
  ];
  return workbook({
    sheets: [
      { name: "Notes", state: "hidden", xml: sheetXml([{ r: 1, cells: [C.inl("A1", "style_number")] }]) },
      { name: "Export", xml: sheetXml(rows) },
    ],
    styles: styles([{ id: 14 }]),
  });
}
const EMPTY_HEADER_ROWS = [
  ["Brand", "  Style - Number ", "", "name:en", "", "season", "attr:launch_date"],
  ["Kestrel", "KX-9201", "spacer", "Cdata & <Tee>", "x", "SS26", "9999-12-31"],
  ["", "", "", "", "", "", ""],
  ["", "", "", "", "", "", ""],
];
const EMPTY_HEADER_ERRORS = [
  { file: "products.xlsx", row: 1, column: null, severity: "error", obx_error: "validation_failed", detail_prefix: "row 1, column E: ", value: "#REF!" },
  { file: "products.xlsx", row: 3, column: null, severity: "error", obx_error: "validation_failed", detail_prefix: "row 3, column C: ", value: "#DIV/0!" },
  { file: "products.xlsx", row: 4, column: "attr:launch_date", severity: "error", obx_error: "validation_failed", detail_prefix: "row 4, column attr:launch_date (G): ", value: "2958466" },
];
const EMPTY_HEADER_WARNINGS = ["C", "E"].map((l) => ({ file: "products.xlsx", row: null, column: null, severity: "warning", obx_error: "validation_failed", detail_prefix: `column ${l}: `, value: null }));

// ------------------------------------------------------------------ the refusals
const refusals = {
  "macro-enabled.xlsx": async () => tiny({
    mainType: "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
    extraDefaults: ['<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>'],
    extraParts: { "xl/vbaProject.bin": "not a real VBA project; its presence is enough" },
    extraWbRels: [`<Relationship Id="rIdV" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>`],
  }),
  "external-link.xlsx": async () => tiny({
    extraTypes: [["/xl/externalLinks/externalLink1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"]],
    extraParts: {
      "xl/externalLinks/externalLink1.xml": `${DECL}<externalLink ${NS}><externalBook r:id="rId1"><sheetNames><sheetName val="Prices"/></sheetNames></externalBook></externalLink>`,
      "xl/externalLinks/_rels/externalLink1.xml.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/externalLinkPath" Target="https://example.com/prices.xlsx" TargetMode="External"/></Relationships>`,
    },
    extraWbRels: [`<Relationship Id="rIdX" Type="${REL}/externalLink" Target="externalLinks/externalLink1.xml"/>`],
  }),
  // 12 MiB of whitespace between two rows: about 12 KB on disk, more than 100 times its size.
  "zip-bomb.xlsx": async () => workbook({ sheets: [{ name: "Products", xml: sheetXml([{ r: 1, cells: [C.inl("A1", "style_number")] }, { r: 2, cells: [C.inl("A2", "KX-9902")] }], "", " ".repeat(12 * 1024 * 1024)) }] }),
  "too-many-rows.xlsx": async () => tiny({}, [{ r: 1, cells: [C.inl("A1", "style_number"), C.inl("B1", "name:en")] }, { r: 2, cells: [C.inl("A2", "KX-9903"), C.inl("B2", "Far away")] }, { r: LIMITS.maxRow + 1, cells: [C.inl(`A${LIMITS.maxRow + 1}`, "KX-9904")] }]),
  "not-a-workbook.xlsx": async () => Buffer.from("style_number,name:en\r\nKX-9905,A CSV file renamed to .xlsx\r\n"),
  // The OLE compound file signature (encrypted .xlsx and legacy .xls start with it), then zeros.
  "encrypted.xlsx": async () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]),
  "doctype.xlsx": async () => tiny({ workbookPrefix: '<!DOCTYPE workbook [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>' }),
  // a macro part and a [Content_Types].xml that is not XML: the entry names are checked first (§5.6 step 5)
  "unsafe-before-types.xlsx": async () => tiny({ extraParts: { "xl/vbaProject.bin": "not a real VBA project", "[Content_Types].xml": "<Types" } }),
  // 1E+308 is outside Excel's range (§5.4, numbers, step 3)
  "number-range.xlsx": async () => tiny({}, [{ r: 1, cells: [C.inl("A1", "style_number"), C.inl("B1", "weight_kg")] }, { r: 2, cells: [C.inl("A2", "KX-9907"), C.n("B2", "1E+308")] }]),
  "no-products-sheet.xlsx": async () => workbook({
    sheets: [
      { name: "Notes", xml: sheetXml([{ r: 1, cells: [C.inl("A1", "Hello")] }, { r: 2, cells: [C.inl("A2", "Nothing to import here")] }]) },
      { name: "Products", state: "hidden", xml: sheetXml([{ r: 1, cells: [C.inl("A1", "style_number")] }, { r: 2, cells: [C.inl("A2", "KX-9906")] }]) },
    ],
  }),
};
const REFUSAL_EXPECTED = {
  "macro-enabled.xlsx": ["workbook_unsafe", "A workbook with macros (xl/vbaProject.bin, a macroEnabled content type): refused before anything is read.", "macro"],
  "external-link.xlsx": ["workbook_unsafe", "A workbook with a link to another workbook (xl/externalLinks/): refused; the link is never followed.", "externalLinks"],
  "zip-bomb.xlsx": ["workbook_too_large", `A sheet part that expands from about 12 KB to 12 MiB (more than ${LIMITS.ratio} times and more than 10 MiB): refused from the zip directory, before inflating.`, "sheet1.xml"],
  "too-many-rows.xlsx": ["workbook_too_large", `A value in row ${LIMITS.maxRow + 1}, below the row limit (${LIMITS.maxRow - 1} data rows).`, `A${LIMITS.maxRow + 1}`],
  "not-a-workbook.xlsx": ["workbook_invalid", "A CSV file renamed to .xlsx: the name decides that it is read as a workbook, and it is not a zip file. It is not imported as a CSV.", "zip"],
  "encrypted.xlsx": ["workbook_invalid", "An OLE compound file (a password-protected workbook or a legacy .xls).", "encrypted"],
  "doctype.xlsx": ["workbook_invalid", "xl/workbook.xml has a DOCTYPE with entities: refused, entities are never expanded.", "DOCTYPE"],
  "unsafe-before-types.xlsx": ["workbook_unsafe", "xl/vbaProject.bin and a [Content_Types].xml that is not well-formed: the entry names are checked before [Content_Types].xml is read, so the answer is workbook_unsafe, not workbook_invalid.", "vbaProject.bin"],
  "number-range.xlsx": ["workbook_invalid", "A number cell holding 1E+308, outside Excel's range (1E-308 to below 1E+308).", "1E+308"],
  "no-products-sheet.xlsx": ["workbook_sheet_missing", "The only sheet named Products is hidden, and the visible sheet has no style_number column in row 1.", "Products"],
};

// ------------------------------------------------------------------ vectors
const NUMBER_VECTORS = [
  ["2000901000015", "General", "2000901000015"],
  ["2.000904000012E+12", "General", "2000904000012"],
  ["2000901000022", "00000000000000", "02000901000022"],
  ["5", "000", "005"],
  ["-5", "000", "-5"],
  ["12.5", "0000", "12.5"],
  ["1234", "00", "1234"],
  ["12.5", "General", "12.5"],
  ["12.50", "General", "12.5"],
  ["2.6", "0.00", "2.6"],
  ["0.95", "0%", "0.95"],
  ["0.30000000000000004", "General", "0.3"],
  ["1E-3", "General", "0.001"],
  ["-2.5e-1", "General", "-0.25"],
  ["-0", "General", "0"],
  ["007", "General", "7"],
  ["1.5E+20", "General", "150000000000000000000"],
  ["123456789012345678", "General", "123456789012346000"],
  ["0.1234567890123456789", "General", "0.123456789012346"],
  ["9.9999999999999999", "General", "10"],
  ["42", "@", "42"],
  ["9.99999999999999E+307", "General", `999999999999999${"0".repeat(293)}`],
  ["1E+308", "General", null],
  ["9.999999999999999E+307", "General", null],
  ["1E-308", "General", `0.${"0".repeat(307)}1`],
  ["9.9999999999999999E-309", "General", `0.${"0".repeat(307)}1`],
  ["1E-309", "General", null],
  ["-1E+308", "General", null],
  ["0E+99999999999", "General", "0"],
  ["1E+99999999999", "General", null],
  ["1E-99999999999", "General", null],
  ["0.5E+3", "General", "500"],
  [".5", "General", "0.5"],
  ["5.", "General", "5"],
  ["1,5", "General", null],
  ["0x10", "General", null],
  ["Infinity", "General", null],
].map(([v, format, text]) => ({ v, format, text }));
const DATE_VECTORS = [
  ["46082", "date", false, "2026-03-01"],
  ["46082.5", "datetime", false, "2026-03-01T12:00:00Z"],
  ["46082.75", "date", false, "2026-03-01"],
  ["46082.99999", "datetime", false, "2026-03-01T23:59:59Z"],
  ["46082.999999", "datetime", false, "2026-03-02T00:00:00Z"],
  ["61", "date", false, "1900-03-01"],
  ["60", "date", false, null],
  ["44620", "date", true, "2026-03-01"],
  ["0", "date", true, "1904-01-01"],
  ["-1", "date", true, null],
  ["2958465", "date", false, "9999-12-31"],
  ["2958465.5", "datetime", false, "9999-12-31T12:00:00Z"],
  ["2958465.999999", "datetime", false, null],
  ["2958466", "date", false, null],
  ["2957003", "date", true, "9999-12-31"],
  ["2957004", "date", true, null],
].map(([v, kind, date1904, text]) => ({ v, kind, date1904, text }));
const FORMAT_VECTORS = [
  [0, "General", null], [1, "0", null], [10, "0.00%", null], [11, "0.00E+00", null], [49, "@", null],
  [14, "m/d/yyyy", "date"], [22, "m/d/yyyy h:mm", "datetime"], [20, "h:mm", "datetime"],
  [164, "yyyy-mm-dd", "date"], [164, "dd/mm/yyyy hh:mm:ss", "datetime"], [164, "[$-413]d mmmm yyyy;@", "date"],
  [164, '0.0 "kg"', null], [164, '#,##0.00 "days"', null], [164, "[Red]0.00;[Blue]-0.00", null], [164, "00000000000000", null],
  [164, "\\d0", null], [164, "[h]:mm", "datetime"],
].map(([id, code, kind]) => ({ id, code, kind }));

// ------------------------------------------------------------------ expected.json
function expected() {
  const m = specModel();
  const assets = workbookModel("assets", m);
  return {
    description: "Conformance I-IMP-9 and I-IMP-10 (optional: nodes that accept Excel workbooks, docs/import-format.md §5). For each workbook: send it as the import's products.xlsx (role products) or assets.xlsx (role assets), nothing else unless send says so (send.images_manifest: these files of fixtures/kestrel/images in the images_manifest, by file name and sha256). rows: the canonical rows the conversion gives, header first; rows[i] is Excel row i + 1, so a row that the conversion empties (a conversion error) or that is empty in the sheet is a row of empty strings. csv: the same rows as canonical CSV text (§5.3). errors / warnings: the ImportRowErrors of the conversion (detail starts with detail_prefix). import_errors: every ImportRowError with severity error of a dry-run import of the workbook on a node that holds fixtures/kestrel, sorted by row then column. error: the workbook-level refusal (§5.5: the import run fails with this code in ImportRun.error, nothing is imported, and its results hold this one ImportRowError with row null); detail_contains is a hint for humans, not checked by obx-conformance. number_vectors / date_vectors / format_vectors: unit test vectors for §5.4.",
    limits: LIMITS,
    cases: [
      {
        file: "products-template.xlsx", role: "products", sheet: "Products",
        what: "templates/products.xlsx as it is, yellow example rows included: the rows are exactly fixtures/kestrel/products.csv, so importing it equals I-IMP-1 without images (all unchanged on a node that holds the fixtures).",
        csv_file: "fixtures/kestrel/products.csv", errors: [], warnings: [], import_errors: [],
      },
      {
        file: "assets-template.xlsx", role: "assets", sheet: "Assets",
        what: "templates/assets.xlsx as it is: every column of import-format.md 2.3, the rows of fixtures/kestrel/assets.csv. Sent with the two images its rows name in the images_manifest (alone, each row would be files_missing, §2.2); on a node that holds the fixtures it is all unchanged.",
        send: { images_manifest: assets.rows.map((r) => r[0]) },
        rows: [assets.header, ...assets.rows], csv: canonicalCSV([assets.header, ...assets.rows]), errors: [], warnings: [], import_errors: [],
      },
      {
        file: "edge-cases.xlsx", role: "products", sheet: "Data",
        what: "Sheet choice: the sheet named Products is hidden, so the first visible sheet with style_number in row 1 (Data) is read. Row 2: GTIN typed as a number, numbers, FALSE, a date serial with a date format, text starting with \"=\" (kept as text), a formula with a cached string; L2:L3 merged (the value in L3 is ignored). Row 3: a number with format 00000000000000 (zero-padded GTIN-14), a formula with a cached 0.30000000000000004 (0.3). Row 4: empty. Row 5: a formula without a cached value (conversion error; row skipped). Row 6: a GTIN with a wrong check digit (an error of the CSV import, reported as row 6, column gtin (D)). Row 7: a hidden row (imported) with rich text, a GTIN with an exponent, a percent format (ignored), TRUE and a built-in date format. Row 8: #N/A (conversion error; row skipped). Row 9: date and time, _x000D_ and _x005F_ escapes, a value in column M right of the header (warning). Rows 10-14 have only formatting (not rows).",
        rows: EDGE_ROWS, csv: canonicalCSV(EDGE_ROWS), errors: EDGE_ERRORS, warnings: EDGE_WARNINGS,
        import_errors: [
          EDGE_ERRORS[0],
          { file: F, row: 6, column: "gtin", severity: "error", obx_error: "invalid_gtin", detail_prefix: "row 6, column gtin (D): ", value: "2000903000018" },
          EDGE_ERRORS[1],
        ],
      },
      {
        file: "date1904.xlsx", role: "products", sheet: "products",
        what: "The 1904 date system (serial 44620 is 2026-03-01, 2957003 is 9999-12-31, the last date) with a custom date format, and a t=\"d\" cell (ISO date). The sheet name matches Products case-insensitively.",
        rows: DATE1904_ROWS, csv: canonicalCSV(DATE1904_ROWS), errors: [], warnings: [], import_errors: [],
      },
      {
        file: "empty-header.xlsx", role: "products", sheet: "Export",
        what: "The visible sheet Export is found by its key column: B1 is \"  Style - Number \", which §1.1 normalises to style_number (each run of white space and \"-\" is one \"_\"). Row 1: C1 is empty and E1 is #REF! (a conversion error at row 1, column null, locator \"row 1, column E: \"), so columns C and E have no header: their values are ignored with one warning each (\"column C: \", \"column E: \"), and the CSV import gives no unknown-column warning for them. Row 2: a CDATA section is text; serial 2958465 is 9999-12-31. Row 3: #DIV/0! under the empty header C (conversion error, locator \"row 3, column C: \"; row skipped). Row 4: serial 2958466 (10000-01-01) is out of range (conversion error; row skipped).",
        rows: EMPTY_HEADER_ROWS, csv: canonicalCSV(EMPTY_HEADER_ROWS), errors: EMPTY_HEADER_ERRORS, warnings: EMPTY_HEADER_WARNINGS, import_errors: EMPTY_HEADER_ERRORS,
      },
      ...Object.entries(REFUSAL_EXPECTED).map(([file, [code, what, hint]]) => ({ file, role: "products", what, error: { file: F, row: null, column: null, severity: "error", obx_error: code, detail_contains: hint } })),
    ],
    number_vectors: NUMBER_VECTORS,
    date_vectors: DATE_VECTORS,
    format_vectors: FORMAT_VECTORS,
  };
}

// ------------------------------------------------------------------ build and check
async function build() {
  const files = {
    "products-template.xlsx": readFileSync(join(root, "templates", "products.xlsx")),
    "assets-template.xlsx": readFileSync(join(root, "templates", "assets.xlsx")),
    "edge-cases.xlsx": await edgeCases(),
    "date1904.xlsx": await date1904(),
    "empty-header.xlsx": await emptyHeader(),
  };
  for (const [name, fn] of Object.entries(refusals)) files[name] = await fn();
  return { files, expected: JSON.stringify(expected(), null, 2) + "\n" };
}

async function parts(buf) {
  try {
    const z = await JSZip.loadAsync(buf);
    const out = {};
    for (const n of Object.keys(z.files).sort()) if (!z.files[n].dir) out[n] = await z.files[n].async("string");
    return JSON.stringify(out);
  } catch { return buf.toString("base64"); }
}

const gtinValid = (s) => { const d = [...s].map(Number); const c = d.pop(); const t = d.reverse().reduce((a, x, i) => a + x * (i % 2 ? 1 : 3), 0); return (10 - (t % 10)) % 10 === c; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const strip = (e) => { const { detail, ...rest } = e; return rest; };
const withPrefix = (e) => { const { detail_prefix, ...rest } = e; return rest; };

/** Runs the reference conversion on the files on disk against expected.json. */
async function verify(problems) {
  const exp = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  for (const c of exp.cases) {
    const where = `fixtures/imports/xlsx/${c.file}`;
    let out;
    try {
      out = await convertWorkbook(readFileSync(join(dir, c.file)), c.role);
    } catch (e) {
      if (!(e instanceof WorkbookError)) throw e;
      if (!c.error) { problems.push(`${where}: refused with ${e.code} (${e.detail}), expected rows`); continue; }
      if (e.code !== c.error.obx_error) problems.push(`${where}: ${e.code} (${e.detail}), expected ${c.error.obx_error}`);
      else if (!e.detail.toLowerCase().includes(c.error.detail_contains.toLowerCase())) problems.push(`${where}: detail "${e.detail}" does not mention ${c.error.detail_contains}`);
      continue;
    }
    if (c.error) { problems.push(`${where}: converted, expected ${c.error.obx_error}`); continue; }
    if (out.sheet !== c.sheet) problems.push(`${where}: read sheet ${out.sheet}, expected ${c.sheet}`);
    const want = c.rows ?? parseCSV(readFileSync(join(root, c.csv_file), "utf8"));
    if (!same(out.rows, want)) {
      const i = out.rows.findIndex((r, k) => !same(r, want[k]));
      problems.push(`${where}: row ${i + 1} is ${JSON.stringify(out.rows[i])}, expected ${JSON.stringify(want[i])} (${out.rows.length} rows, expected ${want.length})`);
    }
    if (c.csv !== undefined && canonicalCSV(want) !== c.csv) problems.push(`${where}: csv in expected.json is not the canonical CSV of rows`);
    if (c.csv_file && canonicalCSV(out.rows) !== readFileSync(join(root, c.csv_file), "utf8")) problems.push(`${where}: canonical CSV differs from ${c.csv_file} byte for byte`);
    for (const [kind, got, wantList] of [["errors", out.errors, c.errors], ["warnings", out.warnings, c.warnings]]) {
      if (!same(got.map(strip), wantList.map(withPrefix))) problems.push(`${where}: ${kind} ${JSON.stringify(got)}, expected ${JSON.stringify(wantList)}`);
      got.forEach((g, i) => { if (wantList[i] && !g.detail.startsWith(wantList[i].detail_prefix)) problems.push(`${where}: detail "${g.detail}" does not start with "${wantList[i].detail_prefix}"`); });
    }
    for (const e of c.import_errors ?? []) {
      if (e.obx_error === "invalid_gtin" && gtinValid(e.value)) problems.push(`${where}: ${e.value} has a valid check digit`);
      if (e.obx_error !== "invalid_gtin" && !c.errors.some((x) => same(x, e))) problems.push(`${where}: import error at row ${e.row} is not a conversion error`);
    }
    // every GTIN in the rows except the invalid one has a valid check digit
    const gi = want[0].indexOf("gtin");
    if (gi >= 0) for (const r of want.slice(1)) if (r[gi] && !gtinValid(r[gi]) && !(c.import_errors ?? []).some((e) => e.value === r[gi])) problems.push(`${where}: GTIN ${r[gi]} has a wrong check digit`);
  }
  for (const v of exp.number_vectors) {
    let got = numberText(v.v);
    const w = zeroPad(v.format);
    if (w && /^\d+$/.test(got) && got.length < w) got = got.padStart(w, "0");
    if (got !== v.text) problems.push(`number vector ${v.v} (${v.format}): ${got}, expected ${v.text}`);
  }
  for (const v of exp.date_vectors) { const got = serialText(v.v, v.kind, v.date1904); if (got !== v.text) problems.push(`date vector ${v.v} ${v.kind}${v.date1904 ? " 1904" : ""}: ${got}, expected ${v.text}`); }
  for (const v of exp.format_vectors) { const got = dateKind(v.id, v.id >= 164 ? v.code : undefined); if (got !== v.kind) problems.push(`format vector ${v.id} ${v.code}: ${got}, expected ${v.kind}`); }
}

async function main() {
  const check = process.argv.includes("--check");
  const { files, expected: exp } = await build();
  const problems = [];
  if (check) {
    for (const [name, buf] of Object.entries(files)) {
      const p = join(dir, name);
      if (!existsSync(p)) { problems.push(`fixtures/imports/xlsx/${name} is missing; run npm run xlsx-fixtures`); continue; }
      if ((await parts(readFileSync(p))) !== (await parts(buf))) problems.push(`fixtures/imports/xlsx/${name} is stale; run npm run xlsx-fixtures`);
    }
    const extra = readdirSync(dir).filter((f) => f.endsWith(".xlsx") && !(f in files));
    if (extra.length) problems.push(`fixtures/imports/xlsx/ has files the generator does not write: ${extra.join(", ")}`);
    const p = join(dir, "expected.json");
    if (!existsSync(p) || readFileSync(p, "utf8") !== exp) problems.push("fixtures/imports/xlsx/expected.json is stale; run npm run xlsx-fixtures");
  } else {
    mkdirSync(dir, { recursive: true });
    for (const [name, buf] of Object.entries(files)) writeFileSync(join(dir, name), buf);
    writeFileSync(join(dir, "expected.json"), exp);
    console.log(`wrote fixtures/imports/xlsx/: ${Object.keys(files).length} workbooks and expected.json`);
  }
  if (!problems.length) await verify(problems);
  if (problems.length) {
    console.error(`✗ xlsx fixtures:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  if (check) console.log(`✓ xlsx fixtures: ${Object.keys(files).length} workbooks are current and the reference conversion gives expected.json.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
