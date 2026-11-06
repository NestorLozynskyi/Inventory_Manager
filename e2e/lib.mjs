// Shared helpers for the e2e scripts (scenarios.mjs, screenshots.mjs).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8094').replace(/\/$/, '');
export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(E2E_DIR, '..');
export const TZ = 'UTC';

export async function launch() {
  return chromium.launch({ channel: 'chrome', headless: process.env.HEADED ? false : true });
}

export async function newContext(browser, opts = {}) {
  return browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    timezoneId: TZ,
    locale: 'en-US',
    ...opts,
  });
}

/** Run SQL against this project's postgres container; returns trimmed stdout (tuples only). */
export function psql(sql) {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'inventory', 'inventory', '-tAc', sql],
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
}

export function uniqueEmail(tag = 'e2e') {
  return `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.com`;
}

/** Thin JSON client over the context's request (shares the session cookie with pages). */
export function apiClient(ctx) {
  const call = async (method, url, data) => {
    const r = await ctx.request.fetch(url, {
      method,
      data: data === undefined ? undefined : data,
      headers: { 'X-Timezone': TZ, Accept: 'application/json' },
    });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (r.status() >= 400) {
      const e = new Error(`${method} ${url} → ${r.status()} ${text.slice(0, 300)}`);
      e.status = r.status(); e.body = body; throw e;
    }
    return body;
  };
  return {
    get: (u) => call('GET', u),
    post: (u, d = {}) => call('POST', u, d),
    put: (u, d) => call('PUT', u, d),
    patch: (u, d) => call('PATCH', u, d),
    del: (u) => call('DELETE', u),
  };
}

export async function signUpApi(ctx, email = uniqueEmail(), password = 'Secret-pass-123') {
  const api = apiClient(ctx);
  const me = await api.post('/api/auth/sign-up', { email, password });
  return { api, me, email, password };
}

/** Seed helpers (API) — used for preconditions; the behaviour under test is driven through the UI. */
export async function mkCategory(api, name) { return api.post('/api/categories', { name }); }
export async function mkProduct(api, p) {
  return api.post('/api/products', {
    sku: p.sku, name: p.name, category_id: p.category_id ?? null, unit: p.unit || 'pcs',
    purchase_price: p.purchase_price ?? 1, sale_price: p.sale_price ?? 2,
    min_stock: p.min_stock ?? null, description: p.description || '',
  });
}
export async function postReceipt(api, lines, supplier = 'Seed supplier') {
  const d = await api.post('/api/receipts', { supplier, lines });
  return api.post(`/api/receipts/${d.id}/post`);
}
export async function postWriteOff(api, lines, reason = 'Sale') {
  const d = await api.post('/api/write-offs', { reason, lines });
  return api.post(`/api/write-offs/${d.id}/post`);
}

/** Wait for a toast with the given title (substring). */
export async function waitToast(page, text, timeout = 10000) {
  await page.locator('.toast .toast-title', { hasText: text }).first().waitFor({ timeout });
}

export function dialog(page) {
  return page.locator('[role=dialog]').last();
}
