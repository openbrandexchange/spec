// Reference conversion of an Excel workbook (.xlsx) to the canonical CSV rows, exactly as
// docs/import-format.md §5 describes it. It exists to compute and check the fixtures in
// fixtures/imports/xlsx/; nodes implement §5 in their own language and are tested against
// those fixtures, not against this code. Every step below names the rule it implements.
//
//   import { convertWorkbook, WorkbookError } from "./xlsx.mjs";
//   const out = await convertWorkbook(bytes, "products");  // throws WorkbookError(code, detail)
//   out.rows      [header, ...records]; rows[i] is Excel row i + 1
//   out.errors    conversion errors (ImportRowError fields, severity error)
//   out.warnings  conversion warnings (severity warning)
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fromExceljs = createRequire(require.resolve("exceljs"));
const JSZip = fromExceljs("jszip");
const { SaxesParser } = fromExceljs("saxes");

const MiB = 1024 * 1024;
/** §5.6 limits (fixed, so every node gives the same answer). */
export const LIMITS = { entries: 1000, totalBytes: 256 * MiB, ratio: 100, ratioFloor: 10 * MiB, maxRow: 100001, maxCol: 1000 };

export class WorkbookError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.detail = detail;
  }
}

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_OFFICE_DOCUMENT = `${NS_REL}/officeDocument`;
const REL_WORKSHEET = `${NS_REL}/worksheet`;
const REL_STYLES = `${NS_REL}/styles`;
const REL_SHARED_STRINGS = `${NS_REL}/sharedStrings`;
const MAIN_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
];
export const ROLES = { products: { sheet: "products", keys: ["style_number", "style"], file: "products.xlsx" }, assets: { sheet: "assets", keys: ["file"], file: "assets.xlsx" } };

// ------------------------------------------------------------------ helpers
export const colLetter = (n) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const colNumber = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
/** CSV header normalisation (import-format.md §1.1). */
export const normalizeHeader = (h) => h.trim().toLowerCase().replace(/[ -]/g, "_");

/** Parses one XML part; DOCTYPE is refused (§5.6), entities other than the five predefined ones fail. */
function parseXML(text, part, handlers) {
  const p = new SaxesParser({ xmlns: true });
  p.on("doctype", () => { throw new WorkbookError("workbook_invalid", `${part} has a DOCTYPE`); });
  p.on("error", (e) => { throw new WorkbookError("workbook_invalid", `${part} is not well-formed XML (${e.message})`); });
  for (const [ev, fn] of Object.entries(handlers)) p.on(ev, fn);
  try {
    p.write(text).close();
  } catch (e) {
    if (e instanceof WorkbookError || e?.stop) throw e;
    throw new WorkbookError("workbook_invalid", `${part} is not well-formed XML (${e.message})`);
  }
}
const attr = (node, local) => {
  for (const a of Object.values(node.attributes)) if (a.local === local && (a.uri === "" || a.uri === undefined)) return a.value;
  return undefined;
};
const attrNS = (node, uri, local) => {
  for (const a of Object.values(node.attributes)) if (a.local === local && a.uri === uri) return a.value;
  return undefined;
};

/** §5.4 ST_Xstring escapes: _xHHHH_ is the character U+HHHH, one left-to-right pass. */
export const unescapeXstring = (s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

// ------------------------------------------------------------------ numbers (§5.4)
const NUMBER = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * The text of a numeric cell value as written in <v>: exact decimal expansion, rounded to 15
 * significant digits (half away from zero), no exponent, no trailing zeros, "." as separator.
 * Returns null when <v> is not a number.
 */
export function numberText(lex) {
  const m = NUMBER.exec(lex.trim());
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const neg = m[1] === "-";
  const all = m[2] + (m[3] ?? "");
  const z = all.length - all.replace(/^0+/, "").length;
  let digits = all.slice(z);
  // the decimal point sits after `point` digits of `digits` (negative: zeros in front)
  let point = m[2].length + Number(m[4] ?? 0) - z;
  if (digits === "") return "0";
  // round to 15 significant digits
  if (digits.length > 15) {
    const up = digits[15] >= "5";
    let kept = digits.slice(0, 15).split("").map(Number);
    if (up) {
      let i = 14;
      while (i >= 0) { if (kept[i] === 9) { kept[i] = 0; i--; } else { kept[i]++; break; } }
      if (i < 0) { kept.unshift(1); kept.pop(); point++; }
    }
    digits = kept.join("");
  }
  digits = digits.replace(/0+$/, "");
  if (digits === "") return "0";
  let int, frac;
  if (point <= 0) { int = "0"; frac = "0".repeat(-point) + digits; }
  else if (point >= digits.length) { int = digits + "0".repeat(point - digits.length); frac = ""; }
  else { int = digits.slice(0, point); frac = digits.slice(point); }
  return (neg ? "-" : "") + int + (frac ? "." + frac : "");
}

// ------------------------------------------------------------------ number formats (§5.4)
const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]);
const BUILTIN_TIME_IDS = new Set([18, 19, 20, 21, 22, 32, 33, 45, 46, 47, 55, 56]);
/** First section of a format code with literals removed: quoted text, \x, _x, *x, [...] (except [h], [mm], [ss]). */
export function formatSkeleton(code) {
  let out = "";
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"') { const j = code.indexOf('"', i + 1); i = j < 0 ? code.length : j; continue; }
    if (c === "\\" || c === "_" || c === "*") { i++; continue; }
    if (c === "[") {
      const j = code.indexOf("]", i + 1);
      const inner = j < 0 ? "" : code.slice(i + 1, j);
      if (/^(h+|m+|s+)$/i.test(inner)) out += inner;
      i = j < 0 ? code.length : j;
      continue;
    }
    if (c === ";") break;
    out += c;
  }
  return out;
}
/** "date", "datetime" or null for a number format (id + code from styles.xml). */
export function dateKind(id, code) {
  if (BUILTIN_DATE_IDS.has(id)) return "date";
  if (BUILTIN_TIME_IDS.has(id)) return "datetime";
  if (code === undefined) return null;
  const sk = formatSkeleton(code);
  if (!/[dmyhs]/i.test(sk)) return null;
  return /[hs]/i.test(sk) ? "datetime" : "date";
}
/** Zero padding: a format code that is only "0"s (n >= 2) pads a non-negative integer to n digits. */
export const zeroPad = (code) => (code && /^0{2,}$/.test(code) ? code.length : 0);

const pad = (n, w = 2) => String(n).padStart(w, "0");
/** Serial number -> ISO text (§5.4). Returns null for serials the rule does not accept. */
export function serialText(lex, kind, date1904) {
  const v = Number(lex);
  if (!Number.isFinite(v)) return null;
  if (date1904 ? v < 0 : v < 61) return null;
  let days = Math.floor(v);
  let secs = Math.round((v - days) * 86400);
  if (secs >= 86400) { days++; secs -= 86400; }
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + days * 86400000);
  const ymd = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (kind === "date") return ymd;
  return `${ymd}T${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}Z`;
}
/** t="d" cells (ISO 8601 text). */
export function isoCellText(lex) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]00:00)?)?$/.exec(lex.trim());
  if (!m) return null;
  if (!m[2] || (m[2] === "00" && m[3] === "00" && (m[4] ?? "00") === "00")) return m[1];
  return `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}Z`;
}

// ------------------------------------------------------------------ the package
async function openPackage(buf) {
  // §5.6 step 1: signature
  const b = Buffer.from(buf);
  if (b.length >= 8 && b.readUInt32BE(0) === 0xd0cf11e0 && b.readUInt32BE(4) === 0xa1b11ae1)
    throw new WorkbookError("workbook_invalid", "the file is an encrypted workbook or a legacy .xls file (OLE compound file)");
  if (b.length < 4 || b.readUInt32BE(0) !== 0x504b0304) throw new WorkbookError("workbook_invalid", "the file is not an .xlsx workbook (not a zip file)");
  // step 2: readable zip
  let zip;
  try { zip = await JSZip.loadAsync(b, { checkCRC32: true }); }
  catch (e) { throw new WorkbookError("workbook_invalid", `the zip cannot be read (${e.message})`); }
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  // step 3: limits on the declared sizes
  if (entries.length > LIMITS.entries) throw new WorkbookError("workbook_too_large", `${entries.length} zip entries (limit ${LIMITS.entries})`);
  let total = 0;
  for (const f of entries) {
    const u = f._data.uncompressedSize, c = f._data.compressedSize;
    total += u;
    if (u > LIMITS.ratioFloor && u > LIMITS.ratio * Math.max(c, 1)) throw new WorkbookError("workbook_too_large", `${f.name} expands from ${c} to ${u} bytes (more than ${LIMITS.ratio} times)`);
  }
  if (total > LIMITS.totalBytes) throw new WorkbookError("workbook_too_large", `the parts expand to ${total} bytes (limit ${LIMITS.totalBytes})`);
  const byName = new Map(entries.map((f) => [f.name.toLowerCase(), f]));
  let inflated = 0;
  const read = async (name) => {
    const f = byName.get(name.replace(/^\//, "").toLowerCase());
    if (!f) return null;
    const data = await f.async("uint8array");
    inflated += data.length;
    if (data.length > f._data.uncompressedSize || inflated > LIMITS.totalBytes) throw new WorkbookError("workbook_too_large", `${f.name} expands beyond its declared size`);
    const text = new TextDecoder("utf-8").decode(data);
    return text;
  };
  return { entries, read, byName };
}

function checkUnsafeNames(entries, contentTypes) {
  // §5.6 step 4: macros, ActiveX, external links, data connections
  for (const f of entries) {
    const n = f.name.toLowerCase();
    if (n.split("/").pop() === "vbaproject.bin") throw new WorkbookError("workbook_unsafe", `the workbook contains macros (${f.name})`);
    for (const pre of ["xl/macrosheets/", "xl/activex/", "xl/externallinks/"]) if (n.startsWith(pre)) throw new WorkbookError("workbook_unsafe", `the workbook contains ${pre.slice(3, -1)} (${f.name})`);
    if (n === "xl/connections.xml") throw new WorkbookError("workbook_unsafe", "the workbook contains data connections (xl/connections.xml)");
  }
  for (const t of contentTypes) if (/macroenabled|vbaproject/i.test(t)) throw new WorkbookError("workbook_unsafe", `the workbook is macro-enabled (${t})`);
}

function parseContentTypes(text) {
  const defaults = new Map(), overrides = new Map();
  parseXML(text, "[Content_Types].xml", {
    opentag(n) {
      if (n.local === "Default") defaults.set((attr(n, "Extension") ?? "").toLowerCase(), attr(n, "ContentType") ?? "");
      if (n.local === "Override") overrides.set((attr(n, "PartName") ?? "").toLowerCase(), attr(n, "ContentType") ?? "");
    },
  });
  return { defaults, overrides, all: [...defaults.values(), ...overrides.values()], typeOf: (part) => overrides.get(part.toLowerCase()) ?? defaults.get(part.split(".").pop().toLowerCase()) };
}

function parseRels(text, part) {
  const rels = [];
  parseXML(text, part, { opentag(n) { if (n.local === "Relationship") rels.push({ id: attr(n, "Id"), type: attr(n, "Type"), target: attr(n, "Target") ?? "", external: attr(n, "TargetMode") === "External" }); } });
  return rels;
}
/** Resolves a relationship target against the source part (absolute when it starts with "/"). */
function resolve(source, target) {
  const base = target.startsWith("/") ? [] : source.split("/").slice(0, -1).filter((x) => x !== "");
  for (const seg of target.replace(/^\//, "").split("/")) {
    if (seg === "..") base.pop();
    else if (seg !== "." && seg !== "") base.push(seg);
  }
  return "/" + base.join("/");
}
const relsOf = (part) => { const s = part.split("/"); const f = s.pop(); return `${s.join("/")}/_rels/${f}.rels`; };

// ------------------------------------------------------------------ workbook parts
function parseWorkbook(text, part) {
  const sheets = [];
  let date1904 = false, ns = null;
  parseXML(text, part, {
    opentag(n) {
      if (ns === null) {
        ns = n.uri;
        if (n.local !== "workbook" || n.uri !== NS_MAIN) throw new WorkbookError("workbook_invalid", n.uri === "http://purl.oclc.org/ooxml/spreadsheetml/main" ? "the workbook is saved as Strict Open XML; save it as an Excel Workbook (.xlsx)" : `${part} is not a SpreadsheetML workbook`);
      }
      if (n.local === "workbookPr") { const v = attr(n, "date1904"); date1904 = v === "1" || v === "true"; }
      if (n.local === "sheet") sheets.push({ name: attr(n, "name") ?? "", state: attr(n, "state") ?? "visible", rid: attrNS(n, NS_REL, "id") });
    },
  });
  return { sheets, date1904 };
}

function parseStyles(text) {
  const numFmts = new Map(), xfs = [];
  let inXfs = false;
  if (text !== null) parseXML(text, "styles", {
    opentag(n) {
      if (n.local === "numFmt") numFmts.set(Number(attr(n, "numFmtId")), attr(n, "formatCode") ?? "");
      if (n.local === "cellXfs") inXfs = true;
      if (n.local === "xf" && inXfs) xfs.push(Number(attr(n, "numFmtId") ?? 0));
    },
    closetag(n) { if (n.local === "cellXfs") inXfs = false; },
  });
  return (s) => { const id = xfs[s] ?? 0; return { id, code: numFmts.get(id) }; };
}

/** Text of <si>/<is>: <t> directly inside, and <t> inside <r>; <rPh> (phonetic) is ignored. */
function richTextCollector() {
  let depth = 0, inPh = 0, inT = false, buf = "";
  return {
    open(n) { if (n.local === "rPh") inPh++; if (n.local === "t" && !inPh) inT = true; depth++; },
    close(n) { if (n.local === "rPh") inPh--; if (n.local === "t") inT = false; depth--; },
    text(t) { if (inT) buf += t; },
    take() { const s = buf; buf = ""; return unescapeXstring(s); },
  };
}

function parseSharedStrings(text) {
  const out = [];
  if (text === null) return out;
  const rt = richTextCollector();
  let inSi = false;
  parseXML(text, "sharedStrings", {
    opentag(n) { if (n.local === "si") inSi = true; else if (inSi) rt.open(n); },
    closetag(n) { if (n.local === "si") { inSi = false; out.push(rt.take()); } else if (inSi) rt.close(n); },
    text(t) { if (inSi) rt.text(t); },
  });
  return out;
}

/** Raw cells of a worksheet: Map row -> Map col -> {t, s, v, f, is}; merges; onlyRow1 stops early. */
function parseSheet(text, part, onlyRow1 = false) {
  const rows = new Map(), merges = [];
  let row = 0, col = 0, cell = null, field = null, rt = null;
  const stop = { stop: true };
  try {
    parseXML(text, part, {
      opentag(n) {
        if (n.local === "row") {
          const r = attr(n, "r");
          row = r ? Number(r) : row + 1;
          col = 0;
          if (onlyRow1 && row > 1) throw stop;
        } else if (n.local === "c") {
          const ref = attr(n, "r");
          const m = ref && /^([A-Z]+)(\d+)$/.exec(ref);
          col = m ? colNumber(m[1]) : col + 1;
          if (m) row = Number(m[2]);
          cell = { t: attr(n, "t") ?? "n", s: Number(attr(n, "s") ?? 0), v: null, f: null, is: null };
        } else if (cell && n.local === "v") { field = "v"; cell.v = ""; }
        else if (cell && n.local === "f") { field = "f"; cell.f = ""; }
        else if (cell && n.local === "is") { rt = richTextCollector(); }
        else if (rt) rt.open(n);
        else if (n.local === "mergeCell") merges.push(attr(n, "ref"));
      },
      closetag(n) {
        if (n.local === "c" && cell) {
          if (!rows.has(row)) rows.set(row, new Map());
          rows.get(row).set(col, cell);
          cell = null;
        } else if (n.local === "is" && rt) { cell.is = rt.take(); rt = null; }
        else if (rt) rt.close(n);
        else if (n.local === "v" || n.local === "f") field = null;
      },
      text(t) { if (rt) rt.text(t); else if (cell && field) cell[field] += t; },
    });
  } catch (e) { if (e !== stop) throw e; }
  return { rows, merges };
}

/** Converts one raw cell to {text} or {error: value} (§5.4). */
function cellValue(c, fmt, date1904, shared) {
  if (c.f !== null && c.v === null && c.t !== "inlineStr") return { error: `=${c.f}`, reason: "a formula without a saved result" };
  switch (c.t) {
    case "s": {
      if (c.v === null || c.v.trim() === "") return { text: "" };
      const i = Number(c.v);
      if (!Number.isInteger(i) || i < 0 || i >= shared.length) throw new WorkbookError("workbook_invalid", `shared string ${c.v} does not exist`);
      return { text: shared[i] };
    }
    case "inlineStr": return { text: c.is ?? "" };
    case "str": return { text: unescapeXstring(c.v ?? "") };
    case "b": return { text: c.v === "1" ? "true" : c.v === "0" ? "false" : "" };
    case "e": return { error: c.v ?? "", reason: "an error value" };
    case "d": {
      if (c.v === null || c.v === "") return { text: "" };
      const t = isoCellText(c.v);
      return t === null ? { error: c.v, reason: "a date that cannot be read" } : { text: t };
    }
    default: {
      if (c.v === null || c.v.trim() === "") return { text: "" };
      const f = fmt(c.s);
      const kind = dateKind(f.id, f.code);
      if (kind) {
        const t = serialText(c.v, kind, date1904);
        return t === null ? { error: c.v, reason: "a date before 1900-03-01" } : { text: t };
      }
      let t = numberText(c.v);
      if (t === null) throw new WorkbookError("workbook_invalid", `a number cell holds "${c.v}"`);
      const w = zeroPad(f.code);
      if (w && /^\d+$/.test(t) && t.length < w) t = t.padStart(w, "0");
      return { text: t };
    }
  }
}

// ------------------------------------------------------------------ the conversion
export async function convertWorkbook(buf, role) {
  const r = ROLES[role];
  if (!r) throw new Error(`unknown role ${role}`);
  const pkg = await openPackage(buf);
  const ctText = await pkg.read("[Content_Types].xml");
  // step 4 needs the content types; a package without them is invalid (step 5)
  const ct = ctText === null ? null : parseContentTypes(ctText);
  checkUnsafeNames(pkg.entries, ct ? ct.all : []);
  // step 5: structure
  if (!ct) throw new WorkbookError("workbook_invalid", "[Content_Types].xml is missing");
  const rootRelsText = await pkg.read("_rels/.rels");
  if (rootRelsText === null) throw new WorkbookError("workbook_invalid", "_rels/.rels is missing");
  const main = parseRels(rootRelsText, "_rels/.rels").find((x) => x.type === REL_OFFICE_DOCUMENT && !x.external);
  if (!main) throw new WorkbookError("workbook_invalid", "the package has no main document");
  const wbPart = resolve("/", main.target);
  if (!MAIN_TYPES.includes(ct.typeOf(wbPart))) throw new WorkbookError("workbook_invalid", `the main document is ${ct.typeOf(wbPart) ?? "missing"}, not an Excel workbook`);
  const wbText = await pkg.read(wbPart);
  if (wbText === null) throw new WorkbookError("workbook_invalid", `${wbPart} is missing`);
  const wb = parseWorkbook(wbText, wbPart);
  const relsText = await pkg.read(relsOf(wbPart));
  const rels = relsText === null ? [] : parseRels(relsText, relsOf(wbPart));
  // step 6: external relationships of the workbook
  const ext = rels.find((x) => x.external);
  if (ext) throw new WorkbookError("workbook_unsafe", `the workbook refers to an external resource (${ext.type.split("/").pop()})`);
  const relById = new Map(rels.map((x) => [x.id, x]));
  const stylesRel = rels.find((x) => x.type === REL_STYLES);
  const ssRel = rels.find((x) => x.type === REL_SHARED_STRINGS);
  const fmt = parseStyles(stylesRel ? await pkg.read(resolve(wbPart, stylesRel.target)) : null);
  const shared = parseSharedStrings(ssRel ? await pkg.read(resolve(wbPart, ssRel.target)) : null);

  // step 7: sheet selection
  const visible = [];
  for (const s of wb.sheets) {
    const rel = relById.get(s.rid);
    if (s.state !== "visible" || !rel || rel.type !== REL_WORKSHEET) continue;
    visible.push({ ...s, part: resolve(wbPart, rel.target) });
  }
  const readSheet = async (s, onlyRow1) => {
    const text = await pkg.read(s.part);
    if (text === null) throw new WorkbookError("workbook_invalid", `${s.part} is missing`);
    return parseSheet(text, s.part, onlyRow1);
  };
  let chosen = visible.find((s) => s.name.trim().toLowerCase() === r.sheet);
  if (!chosen) {
    for (const s of visible) {
      const { rows } = await readSheet(s, true);
      const row1 = rows.get(1) ?? new Map();
      const names = [...row1.values()].map((c) => cellValue(c, fmt, wb.date1904, shared)).map((v) => normalizeHeader(v.text ?? ""));
      if (names.some((n) => r.keys.includes(n))) { chosen = s; break; }
    }
  }
  if (!chosen) throw new WorkbookError("workbook_sheet_missing", `no visible sheet is named ${r.sheet === "products" ? "Products" : "Assets"} or has a ${r.keys[0]} column in row 1`);

  // step 8 and 9: cells
  const { rows, merges } = await readSheet(chosen, false);
  for (const ref of merges) {
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref ?? "");
    if (!m || !m[3]) continue;
    const [c1, r1, c2, r2] = [colNumber(m[1]), Number(m[2]), colNumber(m[3]), Number(m[4])];
    for (let rr = r1; rr <= r2; rr++) for (let cc = c1; cc <= c2; cc++) if (rr !== r1 || cc !== c1) rows.get(rr)?.delete(cc);
  }
  const values = new Map(); // row -> col -> {text}|{error}
  for (const [rn, cells] of [...rows].sort((a, b) => a[0] - b[0])) {
    for (const [cn, c] of [...cells].sort((a, b) => a[0] - b[0])) {
      const v = cellValue(c, fmt, wb.date1904, shared);
      if (v.text === "") continue;
      if (rn > LIMITS.maxRow) throw new WorkbookError("workbook_too_large", `the sheet has values below row ${LIMITS.maxRow} (cell ${colLetter(cn)}${rn})`);
      if (cn > LIMITS.maxCol) throw new WorkbookError("workbook_too_large", `the sheet has values right of column ${colLetter(LIMITS.maxCol)} (cell ${colLetter(cn)}${rn})`);
      if (!values.has(rn)) values.set(rn, new Map());
      values.get(rn).set(cn, v);
    }
  }
  const row1 = values.get(1) ?? new Map();
  const errors = [], warnings = [];
  const headerText = (cn) => { const v = row1.get(cn); return v && v.text !== undefined ? v.text : ""; };
  const width = Math.max(0, ...[...row1].filter(([, v]) => v.text !== undefined && v.text !== "").map(([c]) => c));
  for (const [cn, v] of [...row1].sort((a, b) => a[0] - b[0])) {
    if (v.error !== undefined && cn <= width) errors.push(locate({ row: 1, cn, column: "", obx_error: "validation_failed", value: v.error, reason: v.reason }));
  }
  const header = Array.from({ length: width }, (_, i) => headerText(i + 1));
  let last = 1;
  for (const [rn, cells] of values) if (rn > 1 && [...cells.keys()].some((c) => c <= width)) last = Math.max(last, rn);
  const out = [header];
  for (let rn = 2; rn <= last; rn++) {
    const cells = values.get(rn) ?? new Map();
    const bad = [...cells].filter(([cn, v]) => cn <= width && v.error !== undefined).sort((a, b) => a[0] - b[0]);
    if (bad.length) {
      for (const [cn, v] of bad) errors.push(locate({ row: rn, cn, column: header[cn - 1].trim(), obx_error: "validation_failed", value: v.error, reason: v.reason }));
      out.push(header.map(() => ""));
    } else out.push(header.map((_, i) => cells.get(i + 1)?.text ?? ""));
  }
  const stray = new Set();
  for (const [, cells] of values) for (const cn of cells.keys()) if (cn > width) stray.add(cn);
  for (const cn of [...stray].sort((a, b) => a - b)) warnings.push({ file: r.file, row: null, column: null, severity: "warning", obx_error: "validation_failed", detail: `column ${colLetter(cn)}: has values but no header in row 1; ignored`, value: null });
  return { sheet: chosen.name, rows: out, errors: errors.map((e) => ({ file: r.file, ...e })), warnings };
}

function locate({ row, cn, column, obx_error, value, reason }) {
  return { row, column: column || null, severity: "error", obx_error, detail: `${prefix(row, column, colLetter(cn))}the cell holds ${reason}`, value };
}
/** §5.5 locator at the start of every detail about a cell: "row 12, column ean (C): ". */
export const prefix = (row, column, letter) => `row ${row}, column ${column ? `${column} ` : ""}(${letter}): `;

/** Canonical CSV text of rows (§5.3): ",", CRLF, quotes only where needed. */
export function canonicalCSV(rows) {
  const q = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}
