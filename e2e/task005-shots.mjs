// Before/after screenshots for TASK-005 (table column widths).
// Usage: node task005-shots.mjs <before|after>   (BASE_URL default http://127.0.0.1:8094)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const phase = process.argv[2] || "after";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8094";
const OUT = fileURLToPath(new URL(`../docs/screenshots/task-005/${phase}/`, import.meta.url));
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ baseURL: BASE, timezoneId: "Europe/Kyiv" });
const page = await ctx.newPage();
await page.goto("/sign-in");
const ids = await page.evaluate(async () => {
  const h = { "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone };
  await fetch("/api/auth/demo", { method: "POST", headers: h });
  const j = (u) => fetch(u, { headers: h }).then((r) => r.json());
  const rc = (await j("/api/receipts")).items;
  const wo = (await j("/api/write-offs")).items;
  const sc = (await j("/api/stock-counts")).items;
  const cats = await j("/api/categories");
  return {
    receiptPosted: rc.find((d) => d.number === "RC-000118").id,
    receiptDraft: rc.find((d) => d.status === "draft").id,
    writeOffPosted: wo.find((d) => d.number === "WO-000047").id,
    countDraft: sc.find((d) => d.status === "draft").id,
    countPosted: sc.find((d) => d.number === "SC-000008").id,
    cat: cats.find((c) => c.name === "Paint & Coatings").id,
  };
});
const SHOTS = [
  [1440, "products-default", "/products"],
  [834, "products-default", "/products"],
  [1440, "dashboard", "/dashboard"],
  [1440, "receipts-list", "/receipts"],
  [1440, "receipt-posted", `/receipts/${ids.receiptPosted}`],
  [1440, "receipt-draft", `/receipts/${ids.receiptDraft}`],
  [1440, "write-offs-list", "/write-offs"],
  [1440, "write-off-posted", `/write-offs/${ids.writeOffPosted}`],
  [1440, "stock-counts-list", "/stock-counts"],
  [1440, "stock-count-draft", `/stock-counts/${ids.countDraft}`],
  [1440, "stock-count-posted", `/stock-counts/${ids.countPosted}`],
  [1440, "history", "/history"],
  [1440, "report-stock-on-date", "/reports/stock-on-date"],
  [1440, "report-movement", "/reports/movement"],
  [1440, "report-low-stock", "/reports/low-stock"],
  [1440, "report-write-offs-by-reason", "/reports/write-offs-by-reason"],
  [1440, "report-stock-value", "/reports/stock-value"],
  [1440, "report-stock-value-category", `/reports/stock-value?category_id=${ids.cat}`],
  [1440, "categories", "/categories"],
  [390, "products-default-viewport", "/products", false],
];
const H = { 1440: 900, 834: 1112, 390: 844 };
for (const [w, name, url, full = true] of SHOTS) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
  await page.setViewportSize({ width: w, height: H[w] });
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${w}-${name}.png`, fullPage: full });
  console.log(`✓ ${phase} ${w} ${name}`);
}
await browser.close();
