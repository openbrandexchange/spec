#!/usr/bin/env node
// Builds site/: the rendered HTML reference of the three APIs (Redocly), single-file
// OpenAPI bundles and the JSON Schemas at their $id paths, for the website to include.
//
//   node tools/build-site.mjs            write site/
//   node tools/build-site.mjs --check    build into a temporary folder and fail if site/ differs
//   node tools/build-site.mjs --update-redoc   download the Redoc viewer that the current
//                                        Redocly CLI expects (needs network; run after upgrading)
//
// The pages load the Redoc viewer from site/assets/ instead of Redocly's CDN, so the
// website needs no third-party script host. Its SRI hash is checked on every build.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const redocly = join(root, "node_modules", ".bin", "redocly");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const args = new Set(process.argv.slice(2));

const APIS = [
  { api: "protocol", file: "obx-protocol.yaml", page: "protocol.html", title: "OBX Protocol", what: "What retailers' software reads: discovery, access, the change feed, products, images, exports, webhooks.", status: "normative" },
  { api: "ingest", file: "obx-ingest.yaml", page: "ingest.html", title: "OBX Ingest API", what: "How a brand's own systems publish: idempotent writes, files by checksum, batches, imports, jobs.", status: "normative" },
  { api: "admin", file: "node-admin.yaml", page: "admin.html", title: "Node Admin + Portal API", what: "The API behind the shared admin and retailer portal of the reference portals.", status: "non-normative" },
];
const CDN = /https:\/\/cdn\.redocly\.com\/redoc\/(v[0-9.]+)\/bundles\/redoc\.standalone\.js/;

const sha384 = (buf) => "sha384-" + createHash("sha384").update(buf).digest("base64");
const run = (...a) => execFileSync(redocly, a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString();

function build(out) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "assets"), { recursive: true });
  mkdirSync(join(out, "openapi"), { recursive: true });
  const vendored = join(root, "tools", "vendor", "redoc.standalone.js");
  let redocVersion = null;
  for (const a of APIS) {
    const target = join(out, a.page);
    run("build-docs", a.api, "-o", target, "--disableGoogleFont", "--title", `${a.title} ${version} · Open Brand Exchange`, "--lint-config", "off");
    let html = readFileSync(target, "utf8");
    const m = CDN.exec(html);
    if (!m) throw new Error(`${a.page}: Redocly no longer loads the viewer from its CDN; check tools/build-site.mjs`);
    redocVersion = m[1];
    const integrity = /integrity="([^"]+)"/.exec(html.slice(m.index, m.index + 400))?.[1];
    if (!existsSync(vendored) || sha384(readFileSync(vendored)) !== integrity) {
      throw new Error(`tools/vendor/redoc.standalone.js is not the Redoc ${m[1]} viewer this Redocly CLI expects (${integrity}). Run: node tools/build-site.mjs --update-redoc`);
    }
    html = html.replace(m[0], "assets/redoc.standalone.js");
    writeFileSync(target, html);
    const bundle = join(out, "openapi", a.file);
    run("bundle", a.api, "-o", bundle, "--lint-config", "off");
    writeFileSync(bundle, stringifyYAML(inlineExamples(parseYAML(readFileSync(bundle, "utf8"))), { lineWidth: 0 }));
  }
  cpSync(join(root, "tools", "vendor", "redoc.standalone.js"), join(out, "assets", "redoc.standalone.js"));
  cpSync(join(root, "tools", "vendor", "redoc.standalone.js.LICENSE.txt"), join(out, "assets", "redoc.standalone.js.LICENSE.txt"));
  cpSync(join(root, "tools", "vendor", "redoc.LICENSE"), join(out, "assets", "redoc.LICENSE"));
  cpSync(join(root, "schemas"), join(out, "schemas", "v0.1"), { recursive: true });
  writeFileSync(join(out, "index.html"), indexPage(redocVersion));
  writeFileSync(join(out, "README.md"), readme());
}

// Redocly's bundler leaves example values that point at fixture files as $refs; inline
// them so the bundle really is one self-contained file.
function inlineExamples(node) {
  if (Array.isArray(node)) return node.map(inlineExamples);
  if (!node || typeof node !== "object") return node;
  for (const [k, v] of Object.entries(node)) {
    if (k === "examples" && v && typeof v === "object") {
      for (const ex of Object.values(v)) {
        const ref = ex?.value?.$ref;
        if (typeof ref === "string" && ref.startsWith("../fixtures/")) ex.value = JSON.parse(readFileSync(join(root, "openapi", ref), "utf8"));
      }
    } else node[k] = inlineExamples(v);
  }
  return node;
}

function indexPage(redocVersion) {
  const items = APIS.map((a) => `      <li>
        <a href="${a.page}">${a.title}</a> <span class="tag">${a.status}</span>
        <p>${a.what} <a href="openapi/${a.file}">OpenAPI (YAML)</a></p>
      </li>`).join("\n");
  const schemas = readdirSync(join(root, "schemas")).filter((f) => f.endsWith(".json")).sort()
    .map((f) => `<a href="schemas/v0.1/${f}">${f.replace(/\.json$/, "")}</a>`).join(", ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API reference ${version} · Open Brand Exchange</title>
  <meta name="description" content="Rendered reference of the Open Brand Exchange APIs and JSON Schemas, version ${version}.">
  <style>
    :root { color-scheme: light dark; --fg: #1d2330; --muted: #5b6475; --bg: #ffffff; --line: #d9dde5; --link: #1f5fbf; }
    @media (prefers-color-scheme: dark) { :root { --fg: #e8ebf1; --muted: #a4acbb; --bg: #11151c; --line: #2b3240; --link: #8ab4ff; } }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
    h1 { font-size: 1.75rem; margin: 0 0 .25rem; } h2 { font-size: 1.15rem; margin-top: 2.25rem; }
    p { margin: .25rem 0 0; } .lead, footer, li p { color: var(--muted); }
    ul { list-style: none; padding: 0; } li { padding: .9rem 0; border-bottom: 1px solid var(--line); }
    li > a { font-weight: 600; font-size: 1.05rem; }
    a { color: var(--link); } a:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
    .tag { font-size: .8rem; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 0 .5rem; margin-left: .35rem; }
    .schemas { overflow-wrap: anywhere; } footer { margin-top: 3rem; font-size: .9rem; }
  </style>
</head>
<body>
  <main>
    <h1>API reference</h1>
    <p class="lead">Open Brand Exchange ${version}. Generated from the <a href="https://github.com/openbrandexchange/spec">specification</a>; the prose in <code>docs/</code> is authoritative where this reference is silent.</p>
    <h2>APIs</h2>
    <ul>
${items}
    </ul>
    <h2>JSON Schemas</h2>
    <p class="schemas">${schemas}</p>
    <footer>
      <p>An initiative of Richard Lindhout · Open Brand Exchange Foundation (in formation) · <a href="mailto:hello@openbrandexchange.com">hello@openbrandexchange.com</a></p>
      <p>Specification licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC-BY-4.0</a>. Rendered with Redocly CLI and the Redoc ${redocVersion} viewer (MIT).</p>
    </footer>
  </main>
</body>
</html>
`;
}

function readme() {
  return `# site/: generated, do not edit

Built by \`npm run build:site\` (tools/build-site.mjs) from \`openapi/\` and \`schemas/\`; CI fails when it is out of date.

| Path | What |
|---|---|
| \`index.html\` | overview page |
| \`protocol.html\`, \`ingest.html\`, \`admin.html\` | rendered API reference (Redocly), pre-rendered HTML that the Redoc viewer hydrates |
| \`openapi/*.yaml\` | single-file OpenAPI bundles (no external \`$ref\`s), for tools and code generators |
| \`schemas/v0.1/*.json\` | the JSON Schemas at the path of their \`$id\` (\`https://openbrandexchange.com/schemas/v0.1/…\`) |
| \`assets/redoc.standalone.js\` | the Redoc viewer (MIT, \`assets/redoc.LICENSE\`; bundled libraries in \`redoc.standalone.js.LICENSE.txt\`), served locally instead of from a CDN |

For the website: copy this folder as it is, for example to \`/reference/\`, and serve \`schemas/\` at \`/schemas/\` so the schema \`$id\`s resolve. The pages work without JavaScript (the content is pre-rendered); with JavaScript the viewer adds search and navigation. Each page ends with one inline script that starts the viewer; a Content-Security-Policy for these pages needs \`script-src 'self' 'unsafe-inline'\` or a hash of that script.
`;
}

function listFiles(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...listFiles(p).map((x) => join(f, x)));
    else out.push(f);
  }
  return out.sort();
}

if (args.has("--update-redoc")) {
  const tmp = mkdtempSync(join(tmpdir(), "obx-site-"));
  run("build-docs", "protocol", "-o", join(tmp, "p.html"), "--disableGoogleFont", "--lint-config", "off");
  const html = readFileSync(join(tmp, "p.html"), "utf8");
  const m = CDN.exec(html);
  const integrity = /integrity="([^"]+)"/.exec(html.slice(m.index, m.index + 400))[1];
  mkdirSync(join(root, "tools", "vendor"), { recursive: true });
  for (const suffix of ["", ".LICENSE.txt"]) {
    const res = await fetch(m[0] + suffix);
    if (!res.ok) throw new Error(`${m[0]}${suffix}: HTTP ${res.status}`);
    writeFileSync(join(root, "tools", "vendor", "redoc.standalone.js" + suffix), Buffer.from(await res.arrayBuffer()));
  }
  if (sha384(readFileSync(join(root, "tools", "vendor", "redoc.standalone.js"))) !== integrity) throw new Error("downloaded viewer does not match the SRI hash");
  rmSync(tmp, { recursive: true, force: true });
  console.log(`✓ vendored Redoc ${m[1]} (${integrity})`);
} else if (args.has("--check")) {
  const tmp = mkdtempSync(join(tmpdir(), "obx-site-"));
  build(tmp);
  const site = join(root, "site");
  const a = existsSync(site) ? listFiles(site) : [], b = listFiles(tmp);
  const differ = [...new Set([...a, ...b])].filter((f) => !a.includes(f) || !b.includes(f) || !readFileSync(join(site, f)).equals(readFileSync(join(tmp, f))));
  rmSync(tmp, { recursive: true, force: true });
  if (differ.length) {
    console.error(`✗ site/ is out of date (${differ.length} file(s): ${differ.slice(0, 8).join(", ")}${differ.length > 8 ? ", …" : ""}). Run: npm run build:site`);
    process.exit(1);
  }
  console.log(`✓ site/ matches the sources (${b.length} files).`);
} else {
  build(join(root, "site"));
  console.log(`✓ built ${relative(process.cwd(), join(root, "site")) || "site"}/ for ${version}.`);
}
