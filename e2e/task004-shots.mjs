// Before/after screenshots for TASK-004 (tables: low-stock mark, actions column).
// Usage: node task004-shots.mjs <before|after>   (BASE_URL default http://127.0.0.1:8094)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const phase = process.argv[2] || "after";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8094";
const OUT = fileURLToPath(new URL(`../docs/screenshots/task-004/${phase}/`, import.meta.url));
mkdirSync(OUT, { recursive: true });
const SHOTS = [
  [1440, "products-default", "/products"],
  [1440, "products-low-stock", "/products?low_stock=true"],
  [1440, "categories", "/categories"],
  [1440, "report-low-stock", "/reports/low-stock"],
  [1440, "dashboard", "/dashboard"],
  [834, "products-default", "/products"],
  [834, "products-low-stock", "/products?low_stock=true"],
  [834, "categories", "/categories"],
  [390, "products-default", "/products"],
  [390, "products-low-stock", "/products?low_stock=true"],
  [390, "categories", "/categories"],
];
const H = { 1440: 900, 834: 1112, 390: 844 };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ baseURL: BASE, timezoneId: "Europe/Kyiv" });
const page = await ctx.newPage();
await page.goto("/sign-in");
await page.evaluate(() => fetch("/api/auth/demo", { method: "POST", headers: { "X-Timezone": "Europe/Kyiv" } }));
for (const [w, name, url] of SHOTS) {
  await page.setViewportSize({ width: w, height: H[w] });
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.locator("[aria-busy=true]").first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}${w}-${name}.png`, fullPage: true });
  console.log(`✓ ${phase} ${w} ${name}`);
}
await browser.close();
