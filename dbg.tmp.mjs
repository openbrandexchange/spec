import { chromium } from "@playwright/test";
const b = await chromium.launch();
for (const f of ["zz-cdn.html","zz-plain.html","protocol.html"]) {
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
let n=0; p.on("pageerror", e=>n++);
await p.goto("http://127.0.0.1:4180/"+f); await p.waitForTimeout(5000);
const vis = await p.locator('input[placeholder="Search..."]').isVisible();
console.log(f, "errors", n, "search visible", vis);
await p.close(); }
await b.close();
