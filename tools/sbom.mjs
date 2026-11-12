#!/usr/bin/env node
// Writes a CycloneDX 1.5 SBOM of the release bundle to stdout: the specification itself,
// the vendored Redoc viewer it ships in site/, and the npm build tools (scope "excluded":
// used to build and check the bundle, not part of it). Deterministic: the timestamp is the
// commit time of HEAD (or SOURCE_DATE_EPOCH).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VENDORED } from "./licenses.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const epoch = process.env.SOURCE_DATE_EPOCH ?? execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: root }).toString().trim();
const license = (expr) => (/\s(OR|AND)\s/.test(expr) ? [{ expression: expr }] : [{ license: { id: expr } }]);

const components = [
  ...VENDORED.map((v) => ({
    type: "library",
    "bom-ref": `pkg:npm/${v.name}@${v.version}`,
    name: v.name,
    version: v.version,
    scope: "required",
    purl: `pkg:npm/${v.name}@${v.version}`,
    licenses: license(v.license),
    hashes: [{ alg: "SHA-256", content: createHash("sha256").update(readFileSync(join(root, v.path))).digest("hex") }],
    properties: [{ name: "obx:path", value: v.path.replace("tools/vendor/", "site/assets/") }],
  })),
  ...Object.entries(lock.packages)
    .filter(([path]) => path)
    .map(([path, p]) => {
      const name = path.replace(/^.*node_modules\//, "");
      return { type: "library", "bom-ref": `pkg:npm/${name}@${p.version}`, name, version: p.version, scope: "excluded", purl: `pkg:npm/${name.replace("@", "%40")}@${p.version}`, licenses: license(p.license), ...(p.integrity ? { hashes: [{ alg: "SHA-512", content: Buffer.from(p.integrity.replace(/^sha512-/, ""), "base64").toString("hex") }] } : {}) };
    })
    .sort((a, b) => a.name.localeCompare(b.name)),
];

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    timestamp: new Date(Number(epoch) * 1000).toISOString().replace(/\.000Z$/, "Z"),
    tools: { components: [{ type: "application", name: "obx-spec tools/sbom.mjs", version: pkg.version }] },
    component: {
      type: "data",
      "bom-ref": `obx-spec@${pkg.version}`,
      name: "obx-spec",
      version: pkg.version,
      description: pkg.description,
      licenses: license(pkg.license),
      supplier: { name: "Open Brand Exchange Foundation (in formation)", contact: [{ email: "hello@openbrandexchange.com" }] },
      externalReferences: [{ type: "vcs", url: "https://github.com/openbrandexchange/spec" }],
    },
  },
  components,
  dependencies: [{ ref: `obx-spec@${pkg.version}`, dependsOn: components.filter((c) => c.scope === "required").map((c) => c["bom-ref"]) }],
};
process.stdout.write(JSON.stringify(bom, null, 2) + "\n");
