// The rendered reference in site/ as a reader gets it: it loads nothing from other hosts,
// the viewer starts, the examples are there, and the overview page is accessible.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES = [
  { path: "protocol.html", title: "OBX Protocol (read side)", example: "pub_kestrel" },
  { path: "ingest.html", title: "OBX Ingest API", example: "prd_1" },
  { path: "admin.html", title: "Node Admin", example: null },
];

test("overview page links to every reference and passes axe", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/API reference 0\.2\.0/);
  for (const p of PAGES) await expect(page.locator(`a[href="${p.path}"]`)).toBeVisible();
  await expect(page.locator('a[href="schemas/v0.3/Product.json"]')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("overview page carries its own Content-Security-Policy and its styles still apply", async ({ page }) => {
  const violations = [];
  page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy/.test(m.text())) violations.push(m.text()); });
  await page.goto("/");
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", /default-src 'none'/);
  // The inline stylesheet is allowed: main is laid out at its max-width, not full width.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("main")).maxWidth)).not.toBe("none");
  expect(violations).toEqual([]);
});

test("overview page works with the keyboard", async ({ page }) => {
  await page.goto("/");
  const seen = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => document.activeElement?.getAttribute("href")));
  }
  expect(seen).toContain("protocol.html");
  await page.locator('a[href="protocol.html"]').focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/protocol\.html$/);
});

test("no horizontal scrolling on the overview page", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

for (const p of PAGES) {
  test(`${p.path}: self-contained, the viewer starts, examples shown`, async ({ page, baseURL }, testInfo) => {
    const foreign = [];
    const errors = [];
    // Requests to other hosts that actually complete (the page's CSP blocks the rest).
    page.on("requestfinished", (r) => { if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(baseURL)) foreign.push(r.url()); });
    page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy/.test(m.text()) && !/logo-mini/.test(m.text())) errors.push(m.text()); });
    // Redoc 2.5.4 reports React hydration mismatches (#418, then #423 "switching to client
    // rendering") on every page, also when loaded from Redocly's own CDN; the viewer then
    // renders on the client. Any other error is a failure.
    page.on("pageerror", (e) => { if (!/Minified React error #(418|423)/.test(e.message)) errors.push(e.message); });
    await page.goto(p.path);
    await expect(page.locator("h1").first()).toContainText(p.title);
    // The viewer starts on the pre-rendered page: the side menu with its search box (on a
    // phone it sits behind the menu button).
    await expect.poll(() => page.evaluate(() => typeof window.Redoc)).toBe("object");
    const search = page.locator('input[placeholder="Search..."]');
    if (testInfo.project.name === "phone") await expect(search).toBeAttached();
    else await expect(search).toBeVisible();
    if (p.example) await expect(page.getByText(p.example, { exact: false }).first()).toBeAttached();
    expect(foreign).toEqual([]);
    expect(errors).toEqual([]);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

test("schemas are served at their $id path, the earlier ones too", async ({ request }) => {
  for (const v of ["v0.3", "v0.2", "v0.1"]) {
    const res = await request.get(`schemas/${v}/Product.json`);
    expect(res.ok()).toBeTruthy();
    const schema = await res.json();
    expect(schema.$id).toBe(`https://openbrandexchange.com/schemas/${v}/Product.json`);
  }
});
