import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8094";
const b = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await b.newContext({ baseURL: BASE, timezoneId: "Europe/Kyiv" });
const p = await ctx.newPage();
await p.goto("/sign-in");
await p.evaluate(() => fetch("/api/auth/demo", { method: "POST", headers: { "X-Timezone": "Europe/Kyiv" } }));
for (const [w, url] of [[1440, "/products"], [834, "/products"], [1440, "/dashboard"], [1200, "/dashboard"], [1200, "/products"], [834, "/dashboard"], [768, "/products"]]) {
  await p.setViewportSize({ width: w, height: 900 });
  await p.goto(url); await p.waitForLoadState("networkidle"); await p.waitForTimeout(300);
  const r = await p.evaluate(() => [...document.querySelectorAll("table.table")].map((t) => ({
    wrap: t.parentElement.clientWidth, scroll: t.parentElement.scrollWidth,
    cols: [...t.querySelectorAll("thead th")].map((th) => `${th.textContent.trim().split(",")[0]}:${Math.round(th.getBoundingClientRect().width)}`).join(" "),
    rowH: [...new Set([...t.querySelectorAll("tbody tr")].map((tr) => Math.round(tr.getBoundingClientRect().height)))].join(","),
  })));
  console.log(w, url, JSON.stringify(r));
}
await b.close();
