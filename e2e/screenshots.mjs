// App-vs-mockup screenshots for every screen/state of the design project's index.html.
// Usage: npm run screenshots            (BASE_URL default http://127.0.0.1:8094)
//        WIDTHS=1440 ONLY=products npm run screenshots   — subset (ONLY = substring of the shot id)
//        COMPOSITE=1 …                   — also write side-by-side <id>.pair.png
// Env: MOCKUP_DIR — design project folder (defaults to the Open Design project of this repo).
// Output: docs/screenshots/task-003/<width>/<NN-screen-state>.app.png / .mockup.png + INDEX.md
// Data states use a fresh demo workspace, empty states a freshly signed-up account.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  BASE_URL, ROOT, launch, newContext, apiClient, signUpApi, uniqueEmail, dialog,
} from './lib.mjs';

const MOCKUP_DIR = process.env.MOCKUP_DIR || path.join(os.homedir(),
  'Library/Application Support/Open Design/namespaces/release-stable/data/projects/a28ae0e2-1ee4-4f27-b6cd-a552043792b4');
const OUT = path.join(ROOT, 'docs', 'screenshots', 'task-003');
const VIEWPORTS = { 1440: { width: 1440, height: 900 }, 834: { width: 834, height: 1112 }, 390: { width: 390, height: 844 } };
const WIDTHS = (process.env.WIDTHS || '1440,834,390').split(',').map(Number);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const COMPOSITE = !!process.env.COMPOSITE;

// Mockup data (ids pN / cN) → names, so we can find the same records in the app's demo.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(MOCKUP_DIR, 'assets/js/data.js'), 'utf8'), sandbox);
const MOCK = sandbox.window.IM_DATA;
const mockProductName = (id) => MOCK.products.find((p) => p.id === id).name;
const mockCategoryName = (id) => MOCK.categories.find((c) => c.id === id).name;

const mockUrl = (rel) => {
  const [file, query] = rel.split('?');
  return pathToFileURL(path.join(MOCKUP_DIR, file)).href + (query ? `?${query}` : '');
};

// ------------------------------------------------------------------ helpers --

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until the SPA settled: network idle, no skeletons, fonts loaded. */
async function settle(page, extra = 350) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.skeleton, .is-loading[aria-busy=true]'), null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await sleep(extra);
}
async function go(page, url, extra) { await page.goto(url); await settle(page, extra); }
const btn = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
async function openDialog(page, trigger) { await trigger(); await dialog(page).waitFor(); await sleep(450); }

/** Hold matching API requests forever (loading state) — released at page close. */
async function hang(page, pattern) {
  await page.route(pattern, () => {}); // never continue/fulfill → stays pending
}
async function fail(page, pattern) {
  await page.route(pattern, (route) => route.fulfill({
    status: 500, contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong on our side.' } }),
  }));
}

async function openSignOut(page) {
  const direct = page.locator('[data-im-signout]').filter({ visible: true });
  if (await direct.count()) await direct.first().click();
  else {
    await page.locator('button[data-im-account]').filter({ visible: true }).first().click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
  }
  await dialog(page).waitFor();
  await sleep(450);
}

// --------------------------------------------------------- shot catalogue --
// env: guest | demo | empty.  app(page, X) navigates & sets up the state.  after(X) restores data.

const R = (report, label) => [
  { s: `Report — ${label}`, st: 'Default', mock: `screens/reports.html?report=${report}`, env: 'demo', app: (p) => go(p, `/reports/${report}`) },
  { s: `Report — ${label}`, st: 'Empty', mock: `screens/reports.html?report=${report}&state=empty`, env: 'demo', app: async (p, X) => {
    const q = {
      'stock-on-date': 'date=2026-07-31', movement: 'from=2026-07-01&to=2026-07-31', 'low-stock': `category_id=${X.cat('c9')}`,
      'write-offs-by-reason': 'from=2026-08-01&to=2026-08-31', 'stock-value': `category_id=${X.cat('c9')}`,
    }[report];
    await go(p, `/reports/${report}?${q}`);
  } },
  { s: `Report — ${label}`, st: 'Loading', mock: `screens/reports.html?report=${report}&state=loading`, env: 'demo', app: async (p) => {
    await hang(p, `**/api/reports/${report}**`); await p.goto(`/reports/${report}`); await sleep(700);
  } },
];

const SHOTS = [
  // 1. Account & demo
  { s: 'Sign in', st: 'Default', mock: 'screens/sign-in.html', env: 'guest', app: (p) => go(p, '/sign-in') },
  { s: 'Sign in', st: 'Validation', mock: 'screens/sign-in.html?state=validation', env: 'guest', app: async (p) => {
    await go(p, '/sign-in'); await p.click('#sign-in-btn'); await sleep(300);
  } },
  { s: 'Sign in', st: 'Wrong credentials', mock: 'screens/sign-in.html?state=wrong-credentials', env: 'guest', app: async (p, X) => {
    await go(p, '/sign-in'); await p.fill('#email', X.emptyEmail); await p.fill('#password', 'not-the-password');
    await p.click('#sign-in-btn'); await p.locator('#cred-alert').waitFor(); await p.fill('#password', ''); await sleep(300);
  } },
  { s: 'Sign in', st: 'Demo loading', mock: 'screens/sign-in.html?state=demo-loading', env: 'guest', app: async (p) => {
    await go(p, '/sign-in'); await hang(p, '**/api/auth/demo'); await p.click('#demo-btn'); await sleep(500);
  } },
  { s: 'Sign up', st: 'Default', mock: 'screens/sign-up.html', env: 'guest', app: (p) => go(p, '/sign-up') },
  { s: 'Sign up', st: 'Validation', mock: 'screens/sign-up.html?state=validation', env: 'guest', app: async (p) => {
    await go(p, '/sign-up'); await p.fill('#email', 'alex.morgan@northwind'); await p.fill('#password', 'stock12');
    await p.fill('#confirm', 'stock123'); await p.click('#sign-up-btn'); await sleep(300);
  } },
  { s: 'Sign up', st: 'Email taken', mock: 'screens/sign-up.html?state=email-taken', env: 'guest', app: async (p, X) => {
    await go(p, '/sign-up'); await p.fill('#email', X.emptyEmail); await p.fill('#password', 'Another-pass-1');
    await p.fill('#confirm', 'Another-pass-1'); await p.click('#sign-up-btn'); await p.locator('#taken-alert').waitFor(); await sleep(300);
  } },
  { s: 'Demo expired', st: 'Default', mock: 'screens/demo-expired.html', env: 'guest', app: (p) => go(p, '/demo-expired') },
  { s: 'Signed out', st: 'Default', mock: 'screens/signed-out.html', env: 'guest', app: (p) => go(p, '/signed-out') },
  { s: 'Signed out', st: 'Left demo', mock: 'screens/signed-out.html?state=demo', env: 'guest', app: (p) => go(p, '/signed-out?demo=1') },
  { s: 'Sign-out confirmation', st: 'Demo', mock: 'screens/dashboard.html?state=sign-out', env: 'demo', app: async (p) => {
    await go(p, '/dashboard'); await openSignOut(p);
  } },
  { s: 'Sign-out confirmation', st: 'Regular account', mock: 'screens/dashboard.html?state=sign-out', env: 'empty',
    note: 'mockup only has the demo variant', app: async (p) => { await go(p, '/dashboard'); await openSignOut(p); } },
  // 2. Dashboard
  { s: 'Dashboard', st: 'Default', mock: 'screens/dashboard.html', env: 'demo', app: (p) => go(p, '/dashboard') },
  { s: 'Dashboard', st: 'Loading', mock: 'screens/dashboard.html?state=loading', env: 'demo', app: async (p) => {
    await hang(p, '**/api/dashboard**'); await p.goto('/dashboard'); await sleep(700);
  } },
  { s: 'Dashboard', st: 'Error', mock: 'screens/dashboard.html?state=error', env: 'demo', app: async (p) => {
    await fail(p, '**/api/dashboard**'); await go(p, '/dashboard');
  } },
  { s: 'Dashboard', st: 'Empty (new account)', mock: 'screens/dashboard.html?state=empty', env: 'empty', app: (p) => go(p, '/dashboard') },
  // 3. Products
  { s: 'Product list', st: 'Default', mock: 'screens/products.html', env: 'demo', app: (p) => go(p, '/products') },
  { s: 'Product list', st: 'Low stock filter', mock: 'screens/products.html?state=low-stock', env: 'demo', app: (p) => go(p, '/products?low_stock=1') },
  { s: 'Product list', st: 'Archived', mock: 'screens/products.html?state=archived', env: 'demo', app: (p) => go(p, '/products?status=archived') },
  { s: 'Product list', st: 'No search results', mock: 'screens/products.html?state=search-empty', env: 'demo', app: (p) => go(p, '/products?search=hinge%20xyz') },
  { s: 'Product list', st: 'Empty', mock: 'screens/products.html?state=empty', env: 'empty', app: (p) => go(p, '/products') },
  { s: 'Product list', st: 'Loading', mock: 'screens/products.html?state=loading', env: 'demo', app: async (p) => {
    await hang(p, '**/api/products?**'); await hang(p, '**/api/products'); await p.goto('/products'); await sleep(700);
  } },
  { s: 'Product list', st: 'Error', mock: 'screens/products.html?state=error', env: 'demo', app: async (p) => {
    await fail(p, '**/api/products?**'); await fail(p, '**/api/products'); await go(p, '/products');
  } },
  { s: 'Product list', st: 'CSV export toast', mock: 'screens/products.html?state=export', env: 'demo', app: async (p) => {
    await go(p, '/products');
    const dl = p.waitForEvent('download').catch(() => {});
    await btn(p, 'Export CSV').click(); await dl; await p.locator('.toast').first().waitFor(); await sleep(400);
  } },
  { s: 'Product form', st: 'Create', mock: 'screens/product-form.html', env: 'demo', app: (p) => go(p, '/products/new') },
  { s: 'Product form', st: 'Edit', mock: 'screens/product-form.html?state=edit', env: 'demo', app: (p, X) => go(p, `/products/${X.prod('p1')}/edit`) },
  { s: 'Product form', st: 'Validation', mock: 'screens/product-form.html?state=validation', env: 'demo', app: async (p, X) => {
    await go(p, '/products/new');
    await p.selectOption('#f-category', String(X.cat('c6')));
    await p.fill('#f-purchase', '-4.50'); await p.fill('#f-sale', '12,5O');
    await btn(p, 'Save product').click(); await sleep(400);
  } },
  { s: 'Product form', st: 'Duplicate SKU', mock: 'screens/product-form.html?state=duplicate-sku', env: 'demo', app: async (p, X) => {
    await go(p, '/products/new');
    await p.fill('#f-sku', 'FST-0012'); await p.fill('#f-name', 'Galvanized nails 65 mm');
    await p.selectOption('#f-category', String(X.cat('c1'))); await p.selectOption('#f-unit', 'kg');
    await p.fill('#f-purchase', '3.40'); await p.fill('#f-sale', '5.80'); await p.fill('#f-min', '15');
    await p.fill('#f-desc', 'Hot-dip galvanized round-head nails, longer size.');
    await btn(p, 'Save product').click(); await p.locator('#f-sku-error').waitFor({ state: 'visible' }); await sleep(400);
  } },
  { s: 'Product form', st: 'Saved', mock: 'screens/product-form.html?state=saved', env: 'demo',
    note: 'app navigates to the product page after saving', app: async (p, X) => {
      await go(p, `/products/${X.prod('p1')}/edit`); await btn(p, 'Save product').click();
      await p.locator('.toast').first().waitFor(); await settle(p);
    } },
  { s: 'Product details', st: 'Default', mock: 'screens/product.html', env: 'demo', app: (p, X) => go(p, `/products/${X.prod('p1')}`) },
  { s: 'Product details', st: 'Low stock', mock: 'screens/product.html?state=low-stock', env: 'demo', app: (p, X) => go(p, `/products/${X.prod('p9')}`) },
  { s: 'Product details', st: 'Archive confirm', mock: 'screens/product.html?state=archive-confirm', env: 'demo', app: async (p, X) => {
    await go(p, `/products/${X.prod('p5')}`); await openDialog(p, () => btn(p, 'Archive').click());
  } },
  { s: 'Product details', st: 'Archive with stock', mock: 'screens/product.html?state=archive-confirm-stock', env: 'demo', app: async (p, X) => {
    await go(p, `/products/${X.prod('p11')}`); await openDialog(p, () => btn(p, 'Archive').click());
  } },
  { s: 'Product details', st: 'Archived', mock: 'screens/product.html?state=archived', env: 'demo', app: (p, X) => go(p, `/products/${X.prod('p29')}`) },
  { s: 'Product details', st: 'Restored', mock: 'screens/product.html?state=restored', env: 'demo', app: async (p, X) => {
    await go(p, `/products/${X.prod('p29')}`);
    await p.locator('#main button', { hasText: /^\s*Restore\s*$/ }).filter({ visible: true }).first().click();
    await p.locator('.toast').first().waitFor(); await settle(p);
  }, after: (X) => X.api.post(`/api/products/${X.prod('p29')}/archive`) },
  // 4. Categories
  { s: 'Categories', st: 'Default', mock: 'screens/categories.html', env: 'demo', app: (p) => go(p, '/categories') },
  { s: 'Categories', st: 'Create', mock: 'screens/categories.html?state=create', env: 'demo', app: async (p) => {
    await go(p, '/categories'); await openDialog(p, () => btn(p, 'New category').click());
  } },
  { s: 'Categories', st: 'Rename', mock: 'screens/categories.html?state=rename', env: 'demo', app: async (p) => {
    await go(p, '/categories'); await openDialog(p, () => p.getByRole('button', { name: `Rename ${mockCategoryName('c3')}` }).click());
  } },
  { s: 'Categories', st: 'Delete confirm', mock: 'screens/categories.html?state=delete-confirm', env: 'demo', app: async (p) => {
    await go(p, '/categories'); await openDialog(p, () => p.getByRole('button', { name: `Delete ${mockCategoryName('c9')}`, exact: true }).click());
  } },
  { s: 'Categories', st: 'Delete blocked', mock: 'screens/categories.html?state=delete-blocked', env: 'demo', app: async (p) => {
    await go(p, '/categories'); await openDialog(p, () => p.getByRole('button', { name: `Delete ${mockCategoryName('c1')} (in use)` }).click());
  } },
  { s: 'Categories', st: 'Empty', mock: 'screens/categories.html?state=empty', env: 'empty', app: (p) => go(p, '/categories') },
  { s: 'Categories', st: 'Duplicate name', mock: 'screens/categories.html?state=duplicate-name', env: 'demo', app: async (p) => {
    await go(p, '/categories'); await openDialog(p, () => btn(p, 'New category').click());
    await p.fill('#cat-name', 'Tools'); await dialog(p).getByRole('button', { name: 'Create category' }).click();
    await p.locator('#cat-name-error').waitFor({ state: 'visible' }); await sleep(300);
  } },
  // 5. Receipts & write-offs
  { s: 'Receipts list', st: 'Default', mock: 'screens/receipts.html', env: 'demo', app: (p) => go(p, '/receipts') },
  { s: 'Receipts list', st: 'Filtered', mock: 'screens/receipts.html?state=filtered', env: 'demo', app: (p) => go(p, '/receipts?status=posted&period=last-month') },
  { s: 'Receipts list', st: 'Empty', mock: 'screens/receipts.html?state=empty', env: 'empty', app: (p) => go(p, '/receipts') },
  { s: 'Receipts list', st: 'Loading', mock: 'screens/receipts.html?state=loading', env: 'demo', app: async (p) => {
    await hang(p, '**/api/receipts**'); await p.goto('/receipts'); await sleep(700);
  } },
  { s: 'Receipt', st: 'Draft', mock: 'screens/receipt.html', env: 'demo', app: (p, X) => go(p, `/receipts/${X.doc('RC-000127')}`) },
  { s: 'Receipt', st: 'New', mock: 'screens/receipt.html?state=new', env: 'demo', app: (p) => go(p, '/receipts/new') },
  { s: 'Receipt', st: 'Validation', mock: 'screens/receipt.html?state=validation', env: 'demo', app: async (p, X) => {
    await go(p, '/receipts/new');
    await p.selectOption('#ln1-p', String(X.prod('p13'))); await p.fill('#ln1-q', '100'); await p.fill('#ln1-c', '1.85');
    await p.click('#add-line'); await p.fill('#ln2-q', '24');
    await p.click('#add-line'); await p.selectOption('#ln3-p', String(X.prod('p14'))); await p.fill('#ln3-q', '0'); await p.fill('#ln3-c', '0.95');
    await btn(p, 'Post receipt').click(); await p.locator('#error-summary').waitFor(); await sleep(400);
  } },
  { s: 'Receipt', st: 'Post confirm', mock: 'screens/receipt.html?state=post-confirm', env: 'demo', app: async (p, X) => {
    await go(p, `/receipts/${X.doc('RC-000127')}`); await openDialog(p, () => btn(p, 'Post receipt').click());
  } },
  { s: 'Receipt', st: 'Posted', mock: 'screens/receipt.html?state=posted', env: 'demo', app: (p, X) => go(p, `/receipts/${X.doc('RC-000125')}`) },
  { s: 'Receipt', st: 'Reverse confirm', mock: 'screens/receipt.html?state=reverse-confirm', env: 'demo', app: async (p, X) => {
    await go(p, `/receipts/${X.doc('RC-000125')}`); await openDialog(p, () => btn(p, 'Reverse').click());
  } },
  { s: 'Receipt', st: 'Reversed', mock: 'screens/receipt.html?state=reversed', env: 'demo', app: (p, X) => go(p, `/receipts/${X.doc('RC-000121')}`) },
  { s: 'Receipt', st: 'Reversal document', mock: 'screens/receipt.html?state=reversal', env: 'demo', app: (p, X) => go(p, `/reversals/${X.doc('RV-000007')}`) },
  { s: 'Receipt', st: 'Reverse refused', mock: 'screens/receipt.html?state=reverse-refused', env: 'demo', app: async (p, X) => {
    await go(p, `/receipts/${X.doc('RC-000118')}`); await openDialog(p, () => btn(p, 'Reverse').click());
  } },
  { s: 'Receipt', st: 'Delete draft', mock: 'screens/receipt.html?state=delete-draft', env: 'demo', app: async (p, X) => {
    await go(p, `/receipts/${X.doc('RC-000127')}`); await openDialog(p, () => btn(p, 'Delete draft').click());
  } },
  { s: 'Write-offs list', st: 'Default', mock: 'screens/write-offs.html', env: 'demo', app: (p) => go(p, '/write-offs') },
  { s: 'Write-offs list', st: 'Filtered', mock: 'screens/write-offs.html?state=filtered', env: 'demo', app: (p) => go(p, '/write-offs?status=posted&period=last-30&reason=Sale') },
  { s: 'Write-offs list', st: 'Empty', mock: 'screens/write-offs.html?state=empty', env: 'empty', app: (p) => go(p, '/write-offs') },
  { s: 'Write-off', st: 'Draft', mock: 'screens/write-off.html', env: 'demo', app: (p, X) => go(p, `/write-offs/${X.doc('WO-000048')}`) },
  { s: 'Write-off', st: 'New', mock: 'screens/write-off.html?state=new', env: 'demo', app: (p) => go(p, '/write-offs/new') },
  { s: 'Write-off', st: 'Post confirm', mock: 'screens/write-off.html?state=post-confirm', env: 'demo', app: async (p, X) => {
    await go(p, `/write-offs/${X.doc('WO-000048')}`); await openDialog(p, () => btn(p, 'Post write-off').click());
  } },
  { s: 'Write-off', st: 'Insufficient stock', mock: 'screens/write-off.html?state=insufficient-stock', env: 'demo', app: async (p, X) => {
    await go(p, `/write-offs/${X.doc('WO-000048')}`);
    const n = await p.locator('[id^=ln][id$=-q]').count();
    await p.click('#add-line'); await p.selectOption(`#ln${n + 1}-p`, String(X.prod('p11'))); await p.fill(`#ln${n + 1}-q`, '15');
    await p.click('#add-line'); await p.selectOption(`#ln${n + 2}-p`, String(X.prod('p3'))); await p.fill(`#ln${n + 2}-q`, '20');
    await btn(p, 'Post write-off').click(); await p.locator('#error-summary').waitFor(); await sleep(400);
  } },
  { s: 'Write-off', st: 'Posted', mock: 'screens/write-off.html?state=posted', env: 'demo', app: (p, X) => go(p, `/write-offs/${X.doc('WO-000047')}`) },
  { s: 'Write-off', st: 'Reverse confirm', mock: 'screens/write-off.html?state=reverse-confirm', env: 'demo', app: async (p, X) => {
    await go(p, `/write-offs/${X.doc('WO-000047')}`); await openDialog(p, () => btn(p, 'Reverse').click());
  } },
  { s: 'Write-off', st: 'Reversed', mock: 'screens/write-off.html?state=reversed', env: 'demo', app: (p, X) => go(p, `/write-offs/${X.doc('WO-000044')}`) },
  { s: 'Write-off', st: 'Reversal document', mock: 'screens/write-off.html?state=reversal', env: 'demo', app: (p, X) => go(p, `/reversals/${X.doc('RV-000008')}`) },
  // 6. Stock counts
  { s: 'Stock counts list', st: 'Default', mock: 'screens/stock-counts.html', env: 'demo', app: (p) => go(p, '/stock-counts') },
  { s: 'Stock counts list', st: 'Empty', mock: 'screens/stock-counts.html?state=empty', env: 'empty', app: (p) => go(p, '/stock-counts') },
  { s: 'Stock count', st: 'New', mock: 'screens/stock-count.html?state=new', env: 'demo', app: (p) => go(p, '/stock-counts/new') },
  { s: 'Stock count', st: 'Draft (entering)', mock: 'screens/stock-count.html?state=draft', env: 'demo', app: (p, X) => go(p, `/stock-counts/${X.doc('SC-000009')}`) },
  { s: 'Stock count', st: 'Confirm summary', mock: 'screens/stock-count.html?state=confirm', env: 'demo', app: async (p, X) => {
    await go(p, `/stock-counts/${X.doc('SC-000009')}`); await openDialog(p, () => btn(p, 'Post adjustments').click());
  } },
  { s: 'Stock count', st: 'Posted', mock: 'screens/stock-count.html?state=posted', env: 'demo', app: (p, X) => go(p, `/stock-counts/${X.doc('SC-000008')}`) },
  // 7. History
  { s: 'History', st: 'Default', mock: 'screens/history.html', env: 'demo', app: (p) => go(p, '/history') },
  { s: 'History', st: 'Filtered', mock: 'screens/history.html?state=filtered', env: 'demo', app: (p) => go(p, '/history?type=write_off&period=30d') },
  { s: 'History', st: 'Empty (no results)', mock: 'screens/history.html?state=empty', env: 'demo', app: (p, X) => go(p, `/history?search=door%20hinge&category=${X.cat('c6')}`) },
  { s: 'History', st: 'Empty (new account)', mock: 'screens/history.html?state=empty', env: 'empty', note: 'mockup has only the no-results variant', app: (p) => go(p, '/history') },
  { s: 'History', st: 'Loading', mock: 'screens/history.html?state=loading', env: 'demo', app: async (p) => {
    await hang(p, '**/api/movements**'); await p.goto('/history'); await sleep(700);
  } },
  // 8. Reports
  ...R('stock-on-date', 'Stock on date'),
  ...R('movement', 'Stock movement'),
  ...R('low-stock', 'Low stock'),
  ...R('write-offs-by-reason', 'Write-offs by reason'),
  ...R('stock-value', 'Total stock value'),
  { s: 'Report — Total stock value', st: 'Empty (new account)', mock: 'screens/reports.html?report=stock-value&state=empty', env: 'empty', app: (p) => go(p, '/reports/stock-value') },
  // 9. Shared
  { s: 'Page not found', st: 'Default', mock: 'screens/404.html', env: 'demo', app: (p) => go(p, '/no-such-page') },
];

SHOTS.forEach((s, i) => {
  const slug = (t) => t.toLowerCase().replace(/—/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  s.id = `${String(i + 1).padStart(2, '0')}-${slug(s.s)}-${slug(s.st)}`;
});

// -------------------------------------------------------------------- run --

async function makeEnvs(browser) {
  const guest = await newContext(browser);
  const empty = await newContext(browser);
  const emptyAcc = await signUpApi(empty, uniqueEmail('shots-empty'));
  const demo = await newContext(browser);
  const dapi = apiClient(demo);
  const me = await dapi.post('/api/auth/demo');
  // Lookups: mock ids → app ids
  const products = (await dapi.get('/api/products?status=all')).items;
  const cats = await dapi.get('/api/categories');
  const docs = {};
  for (const u of ['/api/receipts', '/api/write-offs', '/api/stock-counts'])
    for (const d of (await dapi.get(u)).items) docs[d.number] = d.id;
  const X = {
    api: dapi, demoEmail: me.email, emptyEmail: emptyAcc.email,
    prod: (mid) => { const n = mockProductName(mid); const p = products.find((x) => x.name === n); if (!p) throw new Error(`no product ${n}`); return p.id; },
    cat: (mid) => { const n = mockCategoryName(mid); const c = cats.find((x) => x.name === n); if (!c) throw new Error(`no category ${n}`); return c.id; },
    doc: (num) => { if (!docs[num]) throw new Error(`no document ${num}`); return docs[num]; },
  };
  return { ctx: { guest, empty, demo }, X, close: async () => {
    await dapi.post('/api/auth/sign-out').catch(() => {});
    await guest.close(); await empty.close(); await demo.close();
  } };
}

async function snap(page, file) {
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' });
}

async function composite(browser, appFile, mockFile, outFile, vp) {
  const page = await browser.newPage({ viewport: { width: vp.width * 2 + 48, height: 400 } });
  await page.setContent(`<body style="margin:0;background:#888;font:14px system-ui">
    <div style="display:flex;gap:16px;padding:16px;align-items:flex-start">
    <figure style="margin:0"><figcaption>app</figcaption><img src="${pathToFileURL(appFile).href}" width="${vp.width}"></figure>
    <figure style="margin:0"><figcaption>mockup</figcaption><img src="${pathToFileURL(mockFile).href}" width="${vp.width}"></figure></div></body>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: outFile, fullPage: true });
  await page.close();
}

const browser = await launch();
const envs = await makeEnvs(browser);
const shots = SHOTS.filter((s) => !ONLY || ONLY.some((o) => s.id.includes(o)));
const results = [];
for (const w of WIDTHS) {
  const vp = VIEWPORTS[w];
  const dir = path.join(OUT, String(w));
  fs.mkdirSync(dir, { recursive: true });
  for (const shot of shots) {
    const appFile = path.join(dir, `${shot.id}.app.png`);
    const mockFile = path.join(dir, `${shot.id}.mockup.png`);
    let appErr = null;
    const page = await envs.ctx[shot.env].newPage();
    await page.setViewportSize(vp);
    try {
      await shot.app(page, envs.X);
      await snap(page, appFile);
    } catch (e) {
      appErr = e.message.split('\n')[0];
      await snap(page, appFile).catch(() => {});
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await page.close();
    if (shot.after) await shot.after(envs.X).catch((e) => console.error('after:', e.message));
    // Mockup
    const mp = await browser.newPage({ viewport: vp });
    await mp.goto(mockUrl(shot.mock));
    await mp.waitForLoadState('load');
    await mp.evaluate(() => document.fonts && document.fonts.ready);
    await sleep(900); // dialogs / toasts open on timers
    await snap(mp, mockFile);
    await mp.close();
    if (COMPOSITE) await composite(browser, appFile, mockFile, path.join(dir, `${shot.id}.pair.png`), vp);
    results.push({ w, shot, appErr });
    console.log(`${appErr ? '✗' : '✓'} ${w} ${shot.id}${appErr ? ` — ${appErr}` : ''}`);
  }
}
await envs.close();
await browser.close();

// INDEX.md (rebuilt from what's on disk so partial runs don't drop rows)
const lines = ['# TASK-003 screenshots — app vs mockup', '',
  `App: ${BASE_URL} (data states: fresh demo workspace; empty states: freshly signed-up account). `
  + 'Mockups: design project `screens/*.html?state=…` over file://. Full-page captures. Generated by `e2e/screenshots.mjs`.', ''];
for (const w of [1440, 834, 390]) {
  const dir = path.join(OUT, String(w));
  if (!fs.existsSync(dir)) continue;
  lines.push(`## ${w} px (${VIEWPORTS[w].width}×${VIEWPORTS[w].height})`, '', '| # | Screen | State | App | Mockup | Note |', '| --- | --- | --- | --- | --- | --- |');
  for (const s of SHOTS) {
    if (!fs.existsSync(path.join(dir, `${s.id}.app.png`))) continue;
    const r = results.find((x) => x.w === w && x.shot === s);
    const note = [s.note, r?.appErr ? `capture error: ${r.appErr}` : ''].filter(Boolean).join('; ');
    lines.push(`| ${s.id.slice(0, 2)} | ${s.s} | ${s.st} | [app](${w}/${s.id}.app.png) | [mockup](${w}/${s.id}.mockup.png) \`${s.mock.replace('screens/', '')}\` | ${note} |`);
  }
  lines.push('');
}
fs.writeFileSync(path.join(OUT, 'INDEX.md'), lines.join('\n'));
const errs = results.filter((r) => r.appErr);
console.log(`\n${results.length} pairs captured, ${errs.length} with app capture errors. Index: ${path.join(OUT, 'INDEX.md')}`);
process.exit(errs.length ? 1 : 0);
