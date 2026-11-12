#!/usr/bin/env node
// Excel templates for brands, generated from the specification so they cannot drift:
//   templates/products.xlsx  the columns of fixtures/kestrel/products.csv, in that order
//   templates/assets.xlsx    the assets.csv columns of docs/import-format.md 2.3, in that order
// Every dropdown is derived from schemas/ (enums) or, for the open vocabularies that the
// schemas only constrain by pattern, from the RECOMMENDED keys in docs/ - never typed by hand.
// The example rows are the Kestrel fixtures, value for value.
//
//   node tools/templates.mjs           # (re)write templates/*.xlsx
//   node tools/templates.mjs --check   # fail when templates/ is stale, the example rows are not
//                                      # the fixtures or a dropdown is not its schema enum
// Output is deterministic (fixed dates in the workbook and in the zip), so a regenerated file is
// byte-identical; the check still compares the unzipped parts so a zlib difference cannot fail it.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ExcelJS from "exceljs";

const require = createRequire(import.meta.url);
// jszip is the zip library inside exceljs (same pinned copy); used to fix the entry dates.
const JSZip = createRequire(require.resolve("exceljs"))("jszip");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");
/** Data validations cover rows 2..LAST_ROW. */
const LAST_ROW = 10000;
const EXAMPLE_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" } };
const TEXT = "@";

// ------------------------------------------------------------------ sources
const read = (p) => readFileSync(join(root, p), "utf8");
const schema = (name) => JSON.parse(read(`schemas/${name}.json`));

/** RFC 4180 CSV (quotes, "" inside quotes, CRLF or LF). */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}

const backticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
/** Markdown cell to plain text: links, bold and code marks removed. */
const plain = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").replace(/`/g, "").replace(/\\\|/g, "|").trim();
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
/** Rows (as cell arrays) of every markdown table whose header line starts with `head`. */
function tables(md, head) {
  const out = [];
  const lines = md.split("\n");
  lines.forEach((line, i) => {
    if (!line.startsWith(head)) return;
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].startsWith("|"); j++) rows.push(cells(lines[j]));
    out.push(rows);
  });
  if (!out.length) throw new Error(`no table "${head}" in the docs`);
  return out;
}
const after = (md, marker) => {
  const i = md.indexOf(marker);
  if (i < 0) throw new Error(`"${marker}" not found in the docs`);
  return md.slice(i + marker.length);
};
const paragraph = (md, marker) => after(md, marker).split("\n\n")[0];

/** Everything the templates take from the spec. */
export function specModel() {
  const imp = read("docs/import-format.md");
  const protocol = read("docs/protocol.md");
  const version = JSON.parse(read("package.json")).version;
  const common = schema("Common").$defs;
  const features = schema("Features").properties;
  const footwear = schema("FootwearMaterials").properties;
  const asset = schema("AssetInput").properties;

  // Column docs: | Column | Required | Maps to | Notes | (products), | Column | Notes | (assets.csv 2.2).
  const columnDoc = {};
  for (const rows of tables(imp, "| Column | Required | Maps to | Notes |")) {
    for (const [col, required, , notes] of rows) for (const name of backticks(col)) columnDoc[name] = { required: plain(required), notes: plain(notes), raw: notes };
  }
  const assetDoc = {};
  for (const [col, notes] of tables(imp, "| Column | Notes |")[0]) for (const name of backticks(col).filter((c) => /^[a-z][a-z0-9_]*(:<lang>)?$/.test(c))) assetDoc[name] = { notes: plain(notes) };

  const recommended = (marker) => backticks(paragraph(protocol, marker).split("RECOMMENDED keys:")[1]);
  const subtypes = [];
  for (const [, keys] of tables(protocol, "| `item_type` | `item_subtype` |")[0]) for (const k of backticks(keys)) if (!subtypes.includes(k)) subtypes.push(k);
  const careGroups = tables(imp, "| Group | Codes |")[0].map(([group, codes]) => ({ group, codes: backticks(codes) }));
  const vocab = (kind) => JSON.parse(read(`vocabularies/${kind}.json`)).entries.map((e) => e.code);
  const fibreKeys = vocab("materials");
  const partKeys = vocab("parts");
  const qualifierKeys = vocab("qualifiers");
  const schemes = schema("Certifications").items.properties.scheme.description.split("recommended:")[1].replace(/\.$/, "").split(",").map((s) => s.trim());
  const pattern = after(imp, "### 2.1 Filename pattern\n```\n").split("\n```")[0].trim();
  const extensions = backticks(after(imp, "- `ext`:").split("\n")[0]);
  // assets.csv column order of 2.3 ("Columns, in this order: ...").
  const order23 = backticks(after(imp, "Columns, in this order:").split("The values are")[0]).filter((c) => /^[a-z][a-z0-9_]*(:<lang>)?$/.test(c));
  const enumOf = (s) => s.enum ?? s.anyOf?.find((a) => a.enum)?.enum ?? s.items?.enum ?? null;
  const footwearParts = Object.keys(footwear);
  const footwearValues = enumOf(footwear[footwearParts[0]]);
  for (const p of footwearParts) if (JSON.stringify(enumOf(footwear[p])) !== JSON.stringify(footwearValues)) throw new Error(`FootwearMaterials.${p} has other values than ${footwearParts[0]}`);

  return {
    version,
    columnDoc,
    assetDoc,
    pattern,
    extensions,
    order23,
    careGroups,
    fibreKeys,
    partKeys,
    qualifierKeys,
    schemes,
    roles: common.Role.enum,
    views: common.View.enum,
    channels: common.Channel.enum,
    lists: {
      item_type: { values: recommended('<a id="item-types"></a>'), open: true, source: "docs/protocol.md#item-types (RECOMMENDED keys)" },
      item_subtype: { values: subtypes, open: true, source: "docs/protocol.md#item-subtypes (RECOMMENDED keys)" },
      target_group: { values: recommended("**`target_group`**"), open: true, source: "docs/protocol.md (target_group RECOMMENDED keys)" },
      size_system: { values: backticks(columnDoc.size_system.raw), open: true, source: "docs/import-format.md 1.2 (size_system)" },
      color_family: { values: enumOf(schema("Color").properties.family), source: "schemas/Color.json family" },
      yes_no: { values: ["yes", "no"], source: "boolean (docs/import-format.md 2.2)" },
      true_false: { values: ["true", "false"], source: "boolean (docs/import-format.md 2.2)" },
      role: { values: common.Role.enum, source: "schemas/Common.json Role" },
      view: { values: common.View.enum, source: "schemas/Common.json View" },
      license: { values: enumOf(asset.rights.properties.license), source: "schemas/AssetInput.json rights.license" },
      source: { values: enumOf(asset.provenance.properties.source), source: "schemas/AssetInput.json provenance.source" },
      c2pa: { values: enumOf(asset.provenance.properties.c2pa), source: "schemas/AssetInput.json provenance.c2pa" },
      ...Object.fromEntries(
        Object.entries(features)
          .filter(([, f]) => f.enum || f.type === "boolean")
          .map(([k, f]) => [`feature:${k}`, f.enum ? { values: f.enum.map(String), source: `schemas/Features.json ${k}` } : { ref: "yes_no" }]),
      ),
    },
    features,
    footwearParts,
    footwearValues,
    measurements: schema("Measurements").properties,
    countryPattern: common.CountryCode.pattern,
  };
}

// ------------------------------------------------------------------ texts per column
// The prose is written here (English and plain Dutch); allowed values, required-ness and
// examples are generated. A column without a text below fails the build, so a new column in
// the fixtures or the docs cannot slip into the template unexplained.
const LANG = { en: ["English", "Engels"], nl: ["Dutch", "Nederlands"] };
const langName = (l, i) => LANG[l]?.[i] ?? l;

const TEXTS = {
  brand: ["Your brand name. Only needed when your node publishes more than one brand; an unknown name creates a new brand.", "Je merknaam. Alleen nodig als je node meer dan één merk publiceert; een onbekende naam maakt een nieuw merk aan."],
  style_number: ["Your style or article number: the same on every row of one product. It is the start of every image file name.", "Je model- of artikelnummer: hetzelfde op elke rij van één product. Elke afbeeldingsnaam begint hiermee."],
  "name:": ["Product name in {lang}. Fill in at least one language.", "Productnaam in het {lang}. Vul minstens één taal in."],
  "description:": ["Product description in {lang}.", "Productomschrijving in het {lang}."],
  item_type: ["What kind of article this is. Suitcases are luggage, not bag.", "Wat voor artikel het is. Koffers zijn luggage, geen bag."],
  item_subtype: ["Refines item_type, e.g. cabin for a cabin suitcase or ankle_boot for shoes.", "Verfijnt item_type, bijvoorbeeld cabin voor een handbagagekoffer of ankle_boot voor schoenen."],
  target_group: ["Who the article is for.", "Voor wie het artikel is."],
  season: ["Season, free text, e.g. SS26, AW26, NOS (never out of stock).", "Seizoen, vrije tekst, bijvoorbeeld SS26, AW26, NOS (altijd leverbaar)."],
  collection: ["Collection name, free text.", "Naam van de collectie, vrije tekst."],
  materials: ["Fibre composition per part, as on the care label. Mandatory on the label and online for textile products (Reg. (EU) No 1007/2011).", "Materiaalsamenstelling per onderdeel, zoals op het waslabel. Verplicht op het label en online voor textielproducten (Verordening (EU) nr. 1007/2011)."],
  contains_animal_origin: ["Does the product contain non-textile parts of animal origin (leather, fur, down, feather)? Empty = not stated.", "Bevat het product niet-textiele delen van dierlijke oorsprong (leer, bont, dons, veren)? Leeg = niet opgegeven."],
  footwear_materials: ["Footwear only: the material of upper, lining and sock, and outer sole (Directive 94/11/EC).", "Alleen schoenen: het materiaal van bovenwerk, voering en binnenzool, en loopzool (Richtlijn 94/11/EG)."],
  care: ["Care symbols in the order of the care label (ISO 3758).", "Wasvoorschriften in de volgorde van het waslabel (ISO 3758)."],
  country_of_origin: ["Country where the product was made.", "Land waar het product gemaakt is."],
  certifications: ["Voluntary certifications with their licence number. Add (material) when only a material is certified.", "Vrijwillige certificeringen met hun licentienummer. Zet (material) erachter als alleen een materiaal gecertificeerd is."],
  variant_id: ["Your id for this variant. Empty = the GTIN, or style-colour-size when there is no GTIN.", "Jouw id voor deze variant. Leeg = de GTIN, of model-kleur-maat als er geen GTIN is."],
  gtin: ["Barcode (EAN/GTIN) of this colour and size. Strongly recommended: retailers find your products by it.", "Barcode (EAN/GTIN) van deze kleur en maat. Sterk aangeraden: winkeliers vinden je producten hiermee."],
  sku: ["Your own stock keeping unit, free text.", "Je eigen artikelcode (SKU), vrije tekst."],
  color_code: ["Your colour code, e.g. NVY or 001. Required as soon as the row is a variant. Used in image file names, so no _ in it.", "Je kleurcode, bijvoorbeeld NVY of 001. Verplicht zodra de rij een variant is. Staat in de afbeeldingsnamen, dus zonder _."],
  "color_name:": ["Colour name in {lang}.", "Kleurnaam in het {lang}."],
  color_family: ["Colour family for filters, next to your own colour name. The same on every row of one colour.", "Kleurgroep voor filters, naast je eigen kleurnaam. Hetzelfde op elke rij van één kleur."],
  supplier_color: ["The colour name in your own systems or on your labels.", "De kleurnaam in je eigen systemen of op je labels."],
  size: ["Size, e.g. M, 42, 32 or ONE SIZE. For jeans 32/34 write 32 here and 34 in size_length.", "Maat, bijvoorbeeld M, 42, 32 of ONE SIZE. Bij jeans 32/34 zet je hier 32 en 34 in size_length."],
  size_length: ["The second size (length), e.g. 34 for jeans 32/34.", "De tweede maat (lengte), bijvoorbeeld 34 bij jeans 32/34."],
  size_system: ["Size system of size.", "Maatsysteem van de maat."],
  // Optional columns that are not in the template (listed at the end of the explanation).
  product_id: ["Your product id, when it differs from style_number.", "Jouw product-id, als die afwijkt van style_number."],
  gpc_brick: ["GS1 GPC brick code of the product.", "GS1 GPC-brickcode van het product."],
  dpp_url: ["Link to the Digital Product Passport.", "Link naar het digitaal productpaspoort."],
  status: ["published or unpublished; empty keeps the current state (new products are published).", "published of unpublished; leeg houdt de huidige stand (nieuwe producten worden gepubliceerd)."],
  "attr:<key>": ["Any other product attribute of your own, one column per key.", "Elk ander eigen productkenmerk, één kolom per sleutel."],
  variant_status: ["As status, for the variant.", "Als status, voor de variant."],
  // assets.csv
  file: ["File name of the image (without folder), exactly as in the zip.", "Bestandsnaam van de afbeelding (zonder map), precies zoals in de zip."],
  "asset:style_number": ["Only when the file name does not follow the naming rule: the style number.", "Alleen als de bestandsnaam niet de naamregel volgt: het modelnummer."],
  "asset:color_code": ["Only when the file name does not follow the naming rule: the colour code. Empty = all colours.", "Alleen als de bestandsnaam niet de naamregel volgt: de kleurcode. Leeg = alle kleuren."],
  position: ["Only when the file name does not follow the naming rule: the image position, 1 = main image.", "Alleen als de bestandsnaam niet de naamregel volgt: de positie, 1 = hoofdafbeelding."],
  role: ["What the image shows. Overrides the file name; empty = from the file name.", "Wat de afbeelding toont. Gaat voor de bestandsnaam; leeg = uit de bestandsnaam."],
  view: ["Viewing angle. Overrides the file name; empty = from the file name.", "Kijkhoek. Gaat voor de bestandsnaam; leeg = uit de bestandsnaam."],
  "alt_text:": ["Alternative text (for screen readers and search engines) in {lang}.", "Alternatieve tekst (voor schermlezers en zoekmachines) in het {lang}."],
  license: ["Usage licence: retailer-use (the standard OBX licence) or custom (then fill license_text).", "Gebruikslicentie: retailer-use (de standaard OBX-licentie) of custom (vul dan license_text in)."],
  license_text: ["Your own licence text, with license custom.", "Je eigen licentietekst, bij license custom."],
  channels: ["Channels where retailers may use the image.", "Kanalen waar winkeliers de afbeelding mogen gebruiken."],
  territories: ["Countries where the image may be used. Empty = worldwide.", "Landen waar de afbeelding gebruikt mag worden. Leeg = wereldwijd."],
  embargo_until: ["Retailers may not show the image before this moment.", "Winkeliers mogen de afbeelding niet tonen vóór dit moment."],
  expires_at: ["Retailers may not use the image after this moment.", "Winkeliers mogen de afbeelding na dit moment niet meer gebruiken."],
  credit: ["Photo credit to show with the image.", "Fotovermelding die bij de afbeelding hoort."],
  model_release: ["Is there a signed model release for the people in the image?", "Is er een getekende modelovereenkomst voor de mensen op de afbeelding?"],
  ai_generated: ["Was the image made with AI?", "Is de afbeelding met AI gemaakt?"],
  ai_edited: ["Was a real photo edited with AI?", "Is een echte foto met AI bewerkt?"],
  source: ["photo, generated (made by AI) or composite.", "photo (foto), generated (door AI gemaakt) of composite (samengesteld)."],
  c2pa: ["Content Credentials (C2PA): embedded in the file, sidecar (separate file) or none.", "Content Credentials (C2PA): embedded (in het bestand), sidecar (apart bestand) of none (geen)."],
  generator: ["The AI tool and version, when AI was used.", "De AI-tool en versie, als AI gebruikt is."],
  asset_id: ["Your own id for the image, instead of style_colour_position.", "Je eigen id voor de afbeelding, in plaats van model_kleur_positie."],
  "asset:status": ["published or unpublished.", "published of unpublished."],
  c2pa_manifest_url: ["Link to the C2PA manifest, with c2pa sidecar.", "Link naar het C2PA-manifest, bij c2pa sidecar."],
  "asset:product_id": ["As style_number, when your product id differs.", "Als style_number, als je product-id afwijkt."],
};

// Dutch for the measurement and feature descriptions (the English comes from the schemas).
const NL_SCHEMA = {
  height_cm: "Hoogte, het artikel staand zoals in gebruik. Koffers: buitenmaat inclusief wielen, handvatten en pootjes. Tassen: de tas zelf, zonder hengsels en band.",
  width_cm: "Breedte van links naar rechts, van voren gezien. Koffers: buitenmaat inclusief wielen, handvatten en pootjes. Tassen: de tas zelf.",
  depth_cm: "Diepte van voor naar achter. Koffers: buitenmaat inclusief wielen, handvatten en pootjes. Tassen: de tas zelf.",
  weight_kg: "Gewicht van het artikel zelf, zonder verpakking.",
  volume_l: "Inhoud in liters (koffers, tassen).",
  volume_expanded_l: "Inhoud in liters met de uitbreidingsrits open.",
  handle_drop_cm: "Tassen: van de bovenkant van het hengsel (rechtop) tot de bovenkant van de tas.",
  strap_length_cm: "Tassen: lengte van de schouderband, kortste en langste stand (gelijk als hij niet verstelbaar is).",
  laptop_max_inch: "Grootste laptop (schermdiagonaal in inch) die in het laptopvak past.",
  heel_height_cm: "Schoenen: hoogte van de hak achteraan, gemeten vanaf de vloer.",
  shaft_height_cm: "Laarzen: hoogte van de schacht, van de binnenzool bij de hiel tot de bovenkant.",
  inseam_cm: "Broeken: binnenbeenlengte, van de kruisnaad tot de zoom.",
  shell: "Koffers: constructie van de schaal.",
  wheels: "Koffers: aantal wielen.",
  lock: "Koffers, tassen: ingebouwd slot.",
  expandable: "Koffers, tassen: heeft een uitbreidingsrits (inhoud dan in volume_expanded_l).",
  closure: "Tassen, schoenen, kleding: hoofdsluiting.",
  laptop_compartment: "Tassen: heeft een gevoerd laptopvak (maat in laptop_max_inch).",
  water_resistance: "Alles: bestendigheid tegen water, zoals het merk die opgeeft.",
  detachable_parts: "Alles: onderdelen die de gebruiker kan afnemen.",
  adjustable_parts: "Alles: onderdelen die de gebruiker kan verstellen.",
  fit: "Kleding: pasvorm.",
  sleeve_length: "Kleding: mouwlengte.",
  neckline: "Kleding: halslijn.",
};

const REQUIRED_NL = {
  "when the node has more than one brand": "als de node meer dan één merk heeft",
  no: "nee",
  yes: "ja",
  "yes (at least one)": "ja (minstens één taal)",
  recommended: "aanbevolen",
  "yes, when any variant column is filled": "ja, zodra een variantkolom gevuld is",
  required: "verplicht",
};
const CARE_GROUP_NL = { Washing: "Wassen", Bleaching: "Bleken", "Tumble drying": "Trommeldrogen", "Natural drying": "Natuurlijk drogen", Ironing: "Strijken", "Professional care": "Professionele reiniging" };

function textFor(key, lang, i) {
  const t = TEXTS[key];
  if (!t) throw new Error(`no explanation for column ${key}; add it to TEXTS in tools/templates.mjs`);
  return lang ? t[i].replace("{lang}", langName(lang, i)) : t[i];
}

// ------------------------------------------------------------------ columns
/** Describes one column: its texts (EN, NL), allowed values (EN, NL) and dropdown list name. */
function describeProductColumn(name, m) {
  const [base, lang] = name.includes(":") && !name.startsWith("feature:") ? [name.split(":")[0] + ":", name.split(":")[1]] : [name, null];
  const docKey = lang ? `${base}<lang>` : name.startsWith("feature:") ? "feature:<key>" : name;
  const doc = m.columnDoc[docKey];
  if (!doc) throw new Error(`column ${name} (${docKey}) is not in the column tables of docs/import-format.md`);
  const required = doc.required;
  const reqNL = REQUIRED_NL[required];
  if (!reqNL) throw new Error(`no Dutch for required "${required}" (column ${name})`);
  const d = { name, required: [required, reqNL], list: null };
  const oneOf = (vals) => [`One of: ${vals.join(", ")}. Choose from the dropdown.`, `Een van: ${vals.join(", ")}. Kies uit de lijst.`];
  const openList = (vals) => [`Recommended: ${vals.join(", ")} (dropdown). Another key is allowed: lowercase letters, digits and _.`, `Aanbevolen: ${vals.join(", ")} (lijst). Een andere waarde mag ook: kleine letters, cijfers en _.`];
  const bool = ["yes or no (dropdown; true/false, ja/nee and 1/0 are accepted too). Empty = not stated.", "yes of no (lijst; true/false, ja/nee en 1/0 mogen ook). Leeg = niet opgegeven."];
  const number = ["A positive number, . or , as decimal separator, no unit (2.6 or 2,6; not 2.6 kg).", "Een positief getal, met . of , als decimaalteken, zonder eenheid (2.6 of 2,6; niet 2,6 kg)."];
  const free = ["Free text.", "Vrije tekst."];

  if (name.startsWith("feature:")) {
    const key = name.slice(8);
    const f = m.features[key];
    if (!f) throw new Error(`feature ${key} is not in schemas/Features.json`);
    if (!NL_SCHEMA[key]) throw new Error(`no Dutch description for feature ${key}`);
    d.text = [f.description, NL_SCHEMA[key]];
    if (f.enum) { d.allowed = oneOf(f.enum.map(String)); d.list = name; }
    else if (f.type === "boolean") { d.allowed = bool; d.list = "yes_no"; }
    else if (f.items?.enum) d.allowed = [`One or more of: ${f.items.enum.join(", ")}, separated by | (e.g. ${f.items.enum.slice(0, 2).join("|")}).`, `Eén of meer van: ${f.items.enum.join(", ")}, gescheiden door | (bijvoorbeeld ${f.items.enum.slice(0, 2).join("|")}).`];
    else throw new Error(`feature ${key} has no enum, boolean or list type`);
    return d;
  }
  if (m.measurements[name]) {
    if (!NL_SCHEMA[name]) throw new Error(`no Dutch description for measurement ${name}`);
    d.text = [m.measurements[name].description, NL_SCHEMA[name]];
    d.allowed = name === "strap_length_cm"
      ? ["min-max in cm, e.g. 80-130; one number for a strap that cannot be adjusted.", "min-max in cm, bijvoorbeeld 80-130; één getal voor een band die niet verstelbaar is."]
      : number;
    return d;
  }
  d.text = [textFor(base, lang, 0), textFor(base, lang, 1)];
  switch (name) {
    case "item_type": case "item_subtype": case "target_group":
      d.allowed = openList(m.lists[name].values); d.list = name; break;
    case "size_system":
      d.allowed = [`Recommended: ${m.lists.size_system.values.join(", ")} (dropdown). Another system is allowed, up to 16 characters.`, `Aanbevolen: ${m.lists.size_system.values.join(", ")} (lijst). Een ander maatsysteem mag ook, tot 16 tekens.`];
      d.list = name; break;
    case "color_family":
      d.allowed = [`${oneOf(m.lists.color_family.values)[0]} (gray and multicolor are read as grey and multicolour.)`, `${oneOf(m.lists.color_family.values)[1]} (gray en multicolor worden gelezen als grey en multicolour.)`];
      d.list = "color_family"; break;
    case "contains_animal_origin":
      d.allowed = bool; d.list = "yes_no"; break;
    case "materials":
      d.allowed = [
        `part: percentage fibre, … per part; parts separated by ; (e.g. outer: 65% cotton, 35% polyamide; lining: 100% polyester (recycled)). Percentages of a part add up to 100. Qualifier, at most one per fibre: ${m.qualifierKeys.map((q) => `(${q})`).join(", ")}. Parts: ${m.partKeys.join(", ")}. Fibres: ${m.fibreKeys.join(", ")}.`,
        `onderdeel: percentage vezel, … per onderdeel; onderdelen gescheiden door ; (bijvoorbeeld outer: 65% cotton, 35% polyamide; lining: 100% polyester (recycled)). De percentages van een onderdeel tellen op tot 100. Kenmerk, hoogstens één per vezel: (recycled) = gerecycled, (organic) = biologisch, (regenerative) = regeneratief. Onderdelen: ${m.partKeys.join(", ")}. Vezels: ${m.fibreKeys.join(", ")}. Gebruik de Engelse sleutels; schrijf een decimaal met een punt (98.5%), want een komma scheidt de vezels.`,
      ];
      break;
    case "footwear_materials":
      d.allowed = [
        `part: value pairs separated by ; (e.g. upper: leather; lining_and_sock: textile; outer_sole: other). Parts: ${m.footwearParts.join(", ")}. Values: ${m.footwearValues.join(", ")}.`,
        `onderdeel: waarde, gescheiden door ; (bijvoorbeeld upper: leather; lining_and_sock: textile; outer_sole: other). Onderdelen: ${m.footwearParts.join(", ")} (bovenwerk, voering en binnenzool, loopzool). Waarden: ${m.footwearValues.join(", ")}.`,
      ];
      break;
    case "care": {
      const en = m.careGroups.map((g) => `${plain(g.group)}: ${g.codes.join(", ")}`).join(". ");
      const nl = m.careGroups.map((g) => {
        const t = CARE_GROUP_NL[plain(g.group)];
        if (!t) throw new Error(`no Dutch for care group ${g.group}`);
        return `${t}: ${g.codes.join(", ")}`;
      }).join(". ");
      d.allowed = [`Codes separated by |, in label order (e.g. wash_30|do_not_bleach|iron_low). ${en}.`, `Codes gescheiden door |, in de volgorde van het label (bijvoorbeeld wash_30|do_not_bleach|iron_low). ${nl}.`];
      break;
    }
    case "country_of_origin":
      d.allowed = ["ISO 3166-1 alpha-2 country code, two capital letters (PT, IT, CN).", "ISO 3166-1 alpha-2 landcode, twee hoofdletters (PT, IT, CN)."]; break;
    case "certifications":
      d.allowed = [
        `scheme:licence number, entries separated by ; and optionally followed by (material) or (product). Recommended schemes: ${m.schemes.join(", ")}.`,
        `schema:licentienummer, gescheiden door ; en eventueel gevolgd door (material) of (product). Aanbevolen schema's: ${m.schemes.join(", ")}.`,
      ];
      break;
    case "gtin":
      d.allowed = ["8, 12, 13 or 14 digits with a valid check digit. The column is text, so Excel keeps every digit; never let Excel show 2.00010E+12.", "8, 12, 13 of 14 cijfers met een geldig controlecijfer. De kolom is tekst, zodat Excel alle cijfers houdt; laat Excel nooit 2,00010E+12 tonen."];
      break;
    case "style_number":
      d.allowed = ["Text, up to 200 characters, without /.", "Tekst, tot 200 tekens, zonder /."]; break;
    case "color_code":
      d.allowed = ["Text, up to 64 characters, without / and without _. Do not use ALL (reserved for images of every colour).", "Tekst, tot 64 tekens, zonder / en zonder _. Gebruik geen ALL (gereserveerd voor afbeeldingen van alle kleuren)."]; break;
    default:
      d.allowed = free;
  }
  return d;
}

function describeAssetColumn(name, m) {
  const [base, lang] = name.includes(":") ? [name.split(":")[0] + ":", name.split(":")[1]] : [name, null];
  const docKey = lang ? `${base}<lang>` : name;
  if (!m.assetDoc[docKey] && !["style_number", "product_id"].includes(name)) throw new Error(`assets column ${name} is not in docs/import-format.md 2.2`);
  const key = TEXTS[`asset:${name}`] ? `asset:${name}` : base;
  const required = /^required/.test(m.assetDoc[docKey]?.notes ?? "");
  const d = { name, required: required ? ["required", "verplicht"] : ["no", "nee"], list: null };
  d.text = [textFor(key, lang, 0), textFor(key, lang, 1)];
  const oneOf = (vals) => [`One of: ${vals.join(", ")}. Choose from the dropdown.`, `Een van: ${vals.join(", ")}. Kies uit de lijst.`];
  const bool = ["true or false (dropdown; yes/no, ja/nee and 1/0 are accepted too). Empty = keep.", "true of false (lijst; yes/no, ja/nee en 1/0 mogen ook). Leeg = ongewijzigd laten."];
  const date = ["Date YYYY-MM-DD (midnight UTC) or RFC 3339, e.g. 2030-01-01T00:00:00Z.", "Datum JJJJ-MM-DD (middernacht UTC) of RFC 3339, bijvoorbeeld 2030-01-01T00:00:00Z."];
  if (["role", "view", "license", "source", "c2pa"].includes(name)) { d.allowed = oneOf(m.lists[name].values); d.list = name; }
  else if (["model_release", "ai_generated", "ai_edited"].includes(name)) { d.allowed = bool; d.list = "true_false"; }
  else if (["embargo_until", "expires_at"].includes(name)) d.allowed = date;
  else if (name === "channels") d.allowed = [`One or more of: ${m.channels.join(", ")}, separated by |.`, `Eén of meer van: ${m.channels.join(", ")}, gescheiden door |.`];
  else if (name === "territories") d.allowed = ["ISO 3166-1 alpha-2 country codes separated by | (NL|BE|DE).", "ISO 3166-1 alpha-2 landcodes gescheiden door | (NL|BE|DE)."];
  else if (name === "position") d.allowed = ["1 to 999, no leading zero.", "1 tot en met 999, zonder voorloopnul."];
  else if (name === "file") d.allowed = [`${m.pattern}, extension ${m.extensions.join(", ")}.`, `${m.pattern}, extensie ${m.extensions.join(", ")}.`];
  else d.allowed = ["Free text.", "Vrije tekst."];
  return d;
}

// ------------------------------------------------------------------ read me
function readMe(kind, m, example) {
  const H = (t) => ({ t, h: true });
  const imgs = readdirSync(join(root, "fixtures", "kestrel", "images")).filter((f) => f.startsWith(`${example.style}_`)).sort();
  const colours = [...new Set(imgs.map((f) => f.split("_")[1]))].join(" and ");
  const kleuren = colours.replace(" and ", " en ");
  const quals = `role: ${m.roles.join(", ")}; view: ${m.views.join(", ")}`;
  const csvName = kind === "products" ? "products.csv" : "assets.csv";
  const sheet = kind === "products" ? "Products" : "Assets";
  const en = [
    { t: `Open Brand Exchange: ${kind === "products" ? "product" : "image (assets)"} template`, title: true },
    `Import format ${m.version.split(".").slice(0, 2).join(".")} (specification ${m.version}). Generated from the specification (docs/import-format.md and schemas/); keep the column names as they are.`,
    "",
    H("How to fill it in"),
    ...(kind === "products"
      ? [
          "1. One row per variant: every colour and size of a product gets its own row. Repeat the product data (name, description, materials, ...) on every row of that product.",
          "2. Required are style_number and a name (name:en or name:nl). Leave a cell empty when you do not know the value.",
        ]
      : [
          "1. Optional file. You only need it to add usage rights, an embargo, alt text or an AI label to images. One row per image; file is the image's file name.",
          "2. An empty cell keeps what the image already has (or the node's default for a new image).",
        ]),
    `3. The yellow rows are an example (the fictional brand Kestrel). Delete them before you add your own ${kind === "products" ? "products" : "images"}.`,
    "4. Columns with a dropdown: choose from the list. Where other values are allowed, Excel shows a note when you type your own value; click OK to keep it.",
    "5. The tab Explanation (English) or Uitleg (Dutch) says per column what to fill in, whether it is required and which values are allowed.",
    "6. Delete the columns you do not use. For a product that is already on your node an empty cell removes the stored value, a missing column keeps it.",
    "7. Every cell is formatted as text, so barcodes and codes such as 001 stay exactly as typed. Do not change the format to Number: Excel turns long barcodes into 2.00010E+12 and the import rejects them.",
    "",
    H("Saving as CSV"),
    `1. Open the tab ${sheet} (Excel saves only the open tab as CSV).`,
    `2. File > Save a Copy (or Save As) > file type "CSV UTF-8 (Comma delimited) (*.csv)". Name the file ${csvName}.`,
    '3. Do not choose "CSV (Comma delimited)", "CSV (Macintosh)" or "CSV (MS-DOS)": those are not UTF-8, and letters such as é, ü or ø get lost.',
    '4. Excel set to Dutch (or another European language) may write ";" instead of "," between the columns and a decimal comma (2,6). That is fine: the import detects ";" and reads 2,6 and 2.6 alike in the measurement columns, so you do not need to change anything. Only in materials, where commas separate the fibres, write a decimal with a dot (98.5% cotton).',
    "",
    H("Image file names"),
    `Pattern: ${m.pattern}`,
    "style = style_number, color = color_code, exactly as in products.csv (upper or lower case does not matter).",
    "position = 1 to 999, no leading zero; 1 is the main image. The same style, colour and position again replaces that image.",
    `qualifier (optional, in any order): ${quals}. Without a role the image is a packshot.`,
    `ext = ${m.extensions.join(", ")}. The colour code ALL means the image belongs to every colour of the product (e.g. a size chart).`,
    `Example (Kestrel ${example.style}, ${example.name}, colours ${colours}): ${imgs.join(", ")}. A size chart for all colours: ${example.style}_ALL_9_size_chart.png.`,
    "",
    H("Sending it"),
    "Put products.csv, the images (folders do not matter) and, if you made one, assets.csv in one zip, and upload it in the admin of your OBX node (Import), or let the node pick the files up from your SFTP or S3 folder every night.",
  ];
  const nl = [
    { t: `Open Brand Exchange: sjabloon voor ${kind === "products" ? "producten" : "afbeeldingen (assets)"}`, title: true },
    `Importformaat ${m.version.split(".").slice(0, 2).join(".")} (specificatie ${m.version}). Gemaakt uit de specificatie (docs/import-format.md en schemas/); laat de kolomnamen zoals ze zijn.`,
    "",
    H("Zo vul je het in"),
    ...(kind === "products"
      ? [
          "1. Eén rij per variant: elke kleur en maat van een product krijgt een eigen rij. Herhaal de productgegevens (naam, omschrijving, materialen, ...) op elke rij van dat product.",
          "2. Verplicht zijn style_number en een naam (name:en of name:nl). Laat een cel leeg als je de waarde niet weet.",
        ]
      : [
          "1. Dit bestand is optioneel. Je hebt het alleen nodig om gebruiksrechten, een embargo, alt-tekst of een AI-label aan afbeeldingen te geven. Eén rij per afbeelding; file is de bestandsnaam.",
          "2. Een lege cel houdt wat de afbeelding al heeft (of de standaard van de node voor een nieuwe afbeelding).",
        ]),
    `3. De gele rijen zijn een voorbeeld (het verzonnen merk Kestrel). Verwijder ze voordat je je eigen ${kind === "products" ? "producten" : "afbeeldingen"} toevoegt.`,
    "4. Kolommen met een keuzelijst: kies uit de lijst. Waar ook andere waarden mogen, toont Excel een melding als je zelf iets typt; klik OK om het te houden.",
    "5. Het tabblad Uitleg (Nederlands) of Explanation (Engels) zegt per kolom wat je invult, of het verplicht is en welke waarden mogen.",
    "6. Verwijder de kolommen die je niet gebruikt. Voor een product dat al op je node staat, wist een lege cel de opgeslagen waarde; een ontbrekende kolom laat die staan.",
    "7. Alle cellen zijn opgemaakt als tekst, zodat barcodes en codes als 001 precies blijven zoals je ze typt. Zet de opmaak niet op Getal: dan maakt Excel van een lange barcode 2,00010E+12 en weigert de import die.",
    "",
    H("Opslaan als CSV"),
    `1. Open het tabblad ${sheet} (Excel bewaart alleen het open tabblad als CSV).`,
    `2. Bestand > Kopie opslaan (of Opslaan als) > bestandstype "CSV UTF-8 (door komma's gescheiden) (*.csv)". Noem het bestand ${csvName}.`,
    '3. Kies niet "CSV (gescheiden door lijstscheidingsteken)", "CSV (Macintosh)" of "CSV (MS-DOS)": die zijn geen UTF-8, en letters als é, ü of ø gaan verloren.',
    '4. Een Nederlandse Excel zet vaak ";" in plaats van "," tussen de kolommen en schrijft getallen met een komma (2,6). Dat is goed: de import herkent ";" en leest 2,6 en 2.6 allebei in de maatkolommen, dus je hoeft niets aan te passen. Alleen in materials, waar komma\'s de vezels scheiden, schrijf je een decimaal met een punt (98.5% cotton).',
    "",
    H("Namen van afbeeldingen"),
    `Patroon: ${m.pattern}`,
    "style = style_number, color = color_code, precies zoals in products.csv (hoofdletters of kleine letters maakt niet uit).",
    "position = 1 tot en met 999, zonder voorloopnul; 1 is de hoofdafbeelding. Dezelfde style, kleur en positie nog eens vervangt die afbeelding.",
    `qualifier (optioneel, in willekeurige volgorde): ${quals}. Zonder role is de afbeelding een packshot.`,
    `ext = ${m.extensions.join(", ")}. De kleurcode ALL betekent dat de afbeelding bij alle kleuren van het product hoort (bijvoorbeeld een maattabel).`,
    `Voorbeeld (Kestrel ${example.style}, ${example.nameNl}, kleuren ${kleuren}): ${imgs.join(", ")}. Een maattabel voor alle kleuren: ${example.style}_ALL_9_size_chart.png.`,
    "",
    H("Versturen"),
    "Zet products.csv, de afbeeldingen (mappen maken niet uit) en, als je die hebt, assets.csv in één zip en upload die in de beheeromgeving van je OBX-node (Importeren), of laat de node de bestanden elke nacht uit je SFTP- of S3-map ophalen.",
  ];
  return [...en, "", "", ...nl];
}

// ------------------------------------------------------------------ workbook
const LIST_SHEET = "Lists";

/** Builds the model of one workbook: columns, example rows and the lists its dropdowns use. */
export function workbookModel(kind, m = specModel()) {
  const kestrel = join(root, "fixtures", "kestrel");
  const products = parseCSV(readFileSync(join(kestrel, "products.csv"), "utf8"));
  const p = (col) => products[1][products[0].indexOf(col)];
  const example = { style: p("style_number"), name: p("name:en"), nameNl: p("name:nl"), colorName: p("color_name:en"), colorNameNl: p("color_name:nl") };
  let header, rows, columns, extra;
  if (kind === "products") {
    [header, ...rows] = products;
    columns = header.map((c) => describeProductColumn(c, m));
    // Optional columns of the docs that the template leaves out.
    extra = Object.keys(m.columnDoc)
      .filter((c) => !header.includes(c) && !/:<lang>$/.test(c) && c !== "feature:<key>" && !["name", "description", "color_name"].includes(c))
      .map((c) => ({ name: c, required: [m.columnDoc[c].required, REQUIRED_NL[m.columnDoc[c].required] ?? m.columnDoc[c].required], text: [textFor(c, null, 0), textFor(c, null, 1)], allowed: [m.columnDoc[c].notes, ""] }));
  } else {
    const fixture = parseCSV(readFileSync(join(kestrel, "assets.csv"), "utf8"));
    const langs = fixture[0].filter((c) => c.startsWith("alt_text:")).map((c) => c.split(":")[1]);
    header = m.order23.flatMap((c) => (c === "alt_text:<lang>" ? langs.map((l) => `alt_text:${l}`) : [c]));
    const fh = fixture[0];
    const missing = fh.filter((c) => !header.includes(c));
    if (missing.length) throw new Error(`fixtures/kestrel/assets.csv has columns that docs/import-format.md 2.3 does not list: ${missing.join(", ")}`);
    rows = fixture.slice(1).map((r) => header.map((c) => (fh.includes(c) ? r[fh.indexOf(c)] ?? "" : "")));
    columns = header.map((c) => describeAssetColumn(c, m));
    extra = Object.keys(m.assetDoc)
      .filter((c) => !header.includes(c) && !/:<lang>$/.test(c) && c !== "alt_text")
      .map((c) => {
        const key = TEXTS[`asset:${c}`] ? `asset:${c}` : c;
        return { name: c, required: ["no", "nee"], text: [textFor(key, null, 0), textFor(key, null, 1)], allowed: ["", ""] };
      });
  }
  // Lists used by this workbook, in column order.
  const lists = [];
  for (const col of columns) {
    if (!col.list) continue;
    let name = col.list;
    if (m.lists[name].ref) name = col.list = m.lists[name].ref;
    if (!lists.some((l) => l.name === name)) lists.push({ name, ...m.lists[name] });
  }
  return { kind, sheet: kind === "products" ? "Products" : "Assets", header, rows, columns, extra, lists, readme: readMe(kind, m, example), version: m.version };
}

const colLetter = (n) => { let s = ""; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const listRange = (i, len) => `${LIST_SHEET}!$${colLetter(i)}$2:$${colLetter(i)}$${len + 1}`;

/** Writes one workbook and returns its bytes (deterministic). */
export async function buildWorkbook(model) {
  const wb = new ExcelJS.Workbook();
  wb.creator = wb.lastModifiedBy = "Open Brand Exchange";
  wb.created = wb.modified = FIXED_DATE;
  wb.title = `Open Brand Exchange ${model.kind} template`;
  wb.description = `Generated from the Open Brand Exchange specification ${model.version} by tools/templates.mjs.`;

  // Read me
  const rm = wb.addWorksheet("Read me", { views: [{ showGridLines: false }] });
  rm.getColumn(1).width = 120;
  model.readme.forEach((line, i) => {
    const c = rm.getCell(i + 1, 1);
    const l = typeof line === "string" ? { t: line } : line;
    if (l.t) c.value = l.t;
    c.alignment = { wrapText: true, vertical: "top" };
    if (l.title) c.font = { bold: true, size: 14 };
    else if (l.h) c.font = { bold: true, size: 12 };
  });

  // Data sheet
  const ws = wb.addWorksheet(model.sheet, { views: [{ state: "frozen", xSplit: 0, ySplit: 1, activeCell: "A2" }] });
  model.header.forEach((h, i) => {
    const longest = Math.max(h.length, ...model.rows.map((r) => (r[i] ?? "").length));
    const col = ws.getColumn(i + 1);
    col.width = Math.min(45, Math.max(10, longest + 2));
    col.numFmt = TEXT;
    const cell = ws.getCell(1, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.numFmt = TEXT;
  });
  model.rows.forEach((r, ri) => {
    model.header.forEach((_, ci) => {
      const cell = ws.getCell(ri + 2, ci + 1);
      if (r[ci] !== undefined && r[ci] !== "") cell.value = r[ci];
      cell.numFmt = TEXT;
      cell.fill = EXAMPLE_FILL;
    });
  });

  // Dropdowns (the lists are on the hidden Lists sheet, added last)
  model.columns.forEach((col, ci) => {
    if (!col.list) return;
    const li = model.lists.findIndex((l) => l.name === col.list);
    const l = model.lists[li];
    const L = colLetter(ci);
    ws.dataValidations.add(`${L}2:${L}${LAST_ROW}`, {
      type: "list",
      allowBlank: true,
      formulae: [listRange(li, l.values.length)],
      showErrorMessage: true,
      errorStyle: l.open ? "information" : "stop",
      errorTitle: col.name,
      error: l.open ? "Not one of the recommended values. Click OK to keep it anyway (see the Explanation tab)." : "Choose a value from the list (see the Explanation tab).",
    });
  });

  // Explanation (EN) and Uitleg (NL)
  for (const [title, i, heads, more] of [
    ["Explanation", 0, ["Column", "Required", "Allowed values / format", "Example", "Explanation"], "Optional columns you can add (not in this template)"],
    ["Uitleg", 1, ["Kolom", "Verplicht", "Toegestane waarden / opmaak", "Voorbeeld", "Uitleg"], "Optionele kolommen die je kunt toevoegen (niet in dit sjabloon)"],
  ]) {
    const ex = wb.addWorksheet(title, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
    [26, 22, 70, 30, 60].forEach((w, k) => (ex.getColumn(k + 1).width = w));
    ex.addRow(heads).font = { bold: true };
    ex.getRow(1).eachCell((c) => (c.fill = HEADER_FILL));
    model.columns.forEach((col, ci) => {
      const example = model.rows.map((r) => r[ci]).find((v) => v) ?? "";
      ex.addRow([col.name, col.required[i], col.allowed[i], example, col.text[i]]);
    });
    if (model.extra.length) {
      ex.addRow([]);
      ex.addRow([more]).font = { bold: true };
      for (const e of model.extra) ex.addRow([e.name, e.required[i], i === 0 ? e.allowed[0] : "", "", e.text[i]]);
    }
    ex.eachRow((row, n) => { if (n > 1) row.eachCell((c) => (c.alignment = { wrapText: true, vertical: "top" })); });
  }

  // Lists sheet (hidden): the values of the dropdowns
  const ls = wb.addWorksheet(LIST_SHEET, { state: "hidden" });
  model.lists.forEach((l, i) => {
    ls.getCell(1, i + 1).value = l.name;
    ls.getCell(1, i + 1).font = { bold: true };
    ls.getColumn(i + 1).width = Math.max(14, l.name.length + 2);
    l.values.forEach((v, j) => { const c = ls.getCell(j + 2, i + 1); c.value = String(v); c.numFmt = TEXT; });
  });
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  const raw = await wb.xlsx.writeBuffer();
  // Same entries, same order, fixed dates: byte-identical output for the same input.
  const zin = await JSZip.loadAsync(raw);
  const zout = new JSZip();
  for (const name of Object.keys(zin.files)) {
    const f = zin.files[name];
    if (f.dir) continue;
    zout.file(name, await f.async("nodebuffer"), { date: FIXED_DATE, createFolders: false });
  }
  return zout.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
}

// ------------------------------------------------------------------ check
/** Unzipped parts of an xlsx: name -> text. */
async function parts(buf) {
  const z = await JSZip.loadAsync(buf);
  const out = {};
  for (const name of Object.keys(z.files).sort()) if (!z.files[name].dir) out[name] = await z.files[name].async("string");
  return out;
}

const cellText = (cell) => {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v.richText) return v.richText.map((t) => t.text).join("");
  return String(v);
};

/** Problems with a generated workbook (empty = fine). */
export async function checkWorkbook(buf, model) {
  const problems = [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const names = wb.worksheets.map((w) => w.name);
  const want = ["Read me", model.sheet, "Explanation", "Uitleg", LIST_SHEET];
  if (JSON.stringify(names) !== JSON.stringify(want)) problems.push(`sheets are ${names.join(", ")}, expected ${want.join(", ")}`);
  const ws = wb.getWorksheet(model.sheet);
  // The data sheet, read back as CSV rows, must be the header and rows of the fixture.
  const width = model.header.length;
  const got = [];
  ws.eachRow({ includeEmpty: false }, (row) => got.push(Array.from({ length: width }, (_, i) => cellText(row.getCell(i + 1)))));
  const csv = parseCSV(readFileSync(join(root, "fixtures", "kestrel", `${model.kind}.csv`), "utf8"));
  const fh = csv[0];
  if (model.kind === "products") {
    if (JSON.stringify(got[0]) !== JSON.stringify(fh)) problems.push(`${model.sheet} header differs from fixtures/kestrel/products.csv`);
  } else {
    // assets.xlsx has every column of docs 2.3; the fixture's columns must be a subsequence of it.
    const idx = fh.map((c) => got[0].indexOf(c));
    if (idx.some((x, k) => x < 0 || (k && x <= idx[k - 1]))) problems.push(`${model.sheet} header does not contain the columns of fixtures/kestrel/assets.csv in order`);
    const empty = got[0].map((c, i) => (fh.includes(c) ? null : i)).filter((i) => i !== null);
    got.slice(1).forEach((r, ri) => empty.forEach((i) => { if (r[i] !== "") problems.push(`${model.sheet} row ${ri + 2} column ${got[0][i]} is not in the fixture but has "${r[i]}"`); }));
    for (let k = 0; k < got.length; k++) got[k] = idx.map((i) => got[k][i] ?? "");
  }
  if (got.length !== csv.length) problems.push(`${model.sheet} has ${got.length - 1} rows, fixtures/kestrel/${model.kind}.csv has ${csv.length - 1}`);
  for (let r = 1; r < Math.min(got.length, csv.length); r++) {
    for (let c = 0; c < fh.length; c++) {
      const a = got[r][c], b = csv[r][c] ?? "";
      if (a !== b) problems.push(`${model.sheet} row ${r + 1} ${fh[c]}: "${a}", fixture has "${b}"`);
    }
  }
  // Every column of the data sheet is text, so Excel does not turn GTINs into numbers.
  model.header.forEach((h, i) => { if (ws.getColumn(i + 1).numFmt !== TEXT) problems.push(`${model.sheet} column ${h} is not formatted as text`); });
  if (ws.views?.[0]?.state !== "frozen" || ws.views[0].ySplit !== 1) problems.push(`${model.sheet} header row is not frozen`);

  // Dropdowns: read the raw sheet XML, resolve each list range in the Lists sheet, compare with the spec.
  const p = await parts(buf);
  const wbXml = p["xl/workbook.xml"];
  const sheetFiles = {};
  const rels = p["xl/_rels/workbook.xml.rels"];
  for (const mm of wbXml.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = new RegExp(`Id="${mm[2]}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${mm[2]}"`).exec(rels);
    sheetFiles[mm[1]] = "xl/" + (target[1] ?? target[2]).replace(/^\/?xl\//, "");
  }
  const xml = p[sheetFiles[model.sheet]];
  const lsheet = wb.getWorksheet(LIST_SHEET);
  const listValues = (ref) => {
    const r = /^Lists!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)$/.exec(ref);
    if (!r || r[1] !== r[3]) return null;
    const out = [];
    for (let row = Number(r[2]); row <= Number(r[4]); row++) out.push(cellText(lsheet.getCell(`${r[1]}${row}`)));
    return out;
  };
  const seen = new Set();
  for (const dv of xml.matchAll(/<dataValidation ([^>]*)>([\s\S]*?)<\/dataValidation>/g)) {
    const attrs = Object.fromEntries([...dv[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const formula = /<formula1>([^<]*)<\/formula1>/.exec(dv[2])?.[1];
    const colL = /^([A-Z]+)2:\1(\d+)$/.exec(attrs.sqref);
    if (!colL || Number(colL[2]) !== LAST_ROW) { problems.push(`dropdown range ${attrs.sqref} does not cover rows 2-${LAST_ROW} of one column`); continue; }
    const ci = model.header.findIndex((_, i) => colLetter(i) === colL[1]);
    const col = model.columns[ci];
    seen.add(col?.name);
    if (!col?.list) { problems.push(`column ${model.header[ci]} has a dropdown but should not`); continue; }
    const spec = model.lists.find((l) => l.name === col.list);
    const vals = listValues(formula);
    if (JSON.stringify(vals) !== JSON.stringify(spec.values.map(String))) problems.push(`dropdown of ${col.name} is ${JSON.stringify(vals)}, the spec (${spec.source}) has ${JSON.stringify(spec.values)}`);
    const style = attrs.errorStyle ?? "stop";
    if (style !== (spec.open ? "information" : "stop")) problems.push(`dropdown of ${col.name} has errorStyle ${style}`);
  }
  for (const col of model.columns) if (col.list && !seen.has(col.name)) problems.push(`column ${col.name} has no dropdown (${col.list})`);
  // The example values of a closed list must be in it (else the fixture or the schema is wrong).
  model.columns.forEach((col, ci) => {
    const l = col.list && model.lists.find((x) => x.name === col.list);
    if (!l || l.open) return;
    for (const r of model.rows) if (r[ci] && !l.values.map(String).includes(r[ci])) problems.push(`example ${col.name} "${r[ci]}" is not in ${l.source}`);
  });
  return problems;
}

export const KINDS = ["products", "assets"];
const outPath = (kind) => join(root, "templates", `${kind}.xlsx`);

async function main() {
  const check = process.argv.includes("--check");
  const m = specModel();
  const problems = [];
  for (const kind of KINDS) {
    const model = workbookModel(kind, m);
    const buf = await buildWorkbook(model);
    problems.push(...(await checkWorkbook(buf, model)).map((p) => `templates/${kind}.xlsx: ${p}`));
    if (check) {
      if (!existsSync(outPath(kind))) { problems.push(`templates/${kind}.xlsx is missing; run npm run templates`); continue; }
      const [a, b] = [await parts(readFileSync(outPath(kind))), await parts(buf)];
      const diff = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((n) => a[n] !== b[n]);
      if (diff.length) problems.push(`templates/${kind}.xlsx is stale (${diff.join(", ")} differ); run npm run templates`);
    } else {
      mkdirSync(join(root, "templates"), { recursive: true });
      writeFileSync(outPath(kind), buf);
      console.log(`wrote templates/${kind}.xlsx (${buf.length} bytes, ${model.rows.length} example rows, ${model.columns.filter((c) => c.list).length} dropdowns)`);
    }
  }
  if (problems.length) {
    console.error(`✗ templates:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  if (check) console.log("✓ templates: products.xlsx and assets.xlsx match the spec, the Kestrel fixtures and the schema enums.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
