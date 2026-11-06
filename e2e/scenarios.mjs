// End-to-end browser scenarios through Caddy (real backend + DB).
// Usage: npm run scenarios   (BASE_URL defaults to http://127.0.0.1:8094)
//        node scenarios.mjs b d      — run only the listed scenarios
// Requires: system Google Chrome, docker compose stack of this project running (psql checks).
import fs from 'node:fs';
import path from 'node:path';
import {
  BASE_URL, ROOT, launch, newContext, psql, uniqueEmail, apiClient, signUpApi,
  mkCategory, mkProduct, postReceipt, postWriteOff, waitToast, dialog,
} from './lib.mjs';

const CSV_DIR = path.join(ROOT, 'docs', 'evidence', 'csv');
const LOG_FILE = path.join(ROOT, 'docs', 'evidence', 'scenarios.log');
fs.mkdirSync(CSV_DIR, { recursive: true });

const logLines = [];
const log = (s) => { console.log(s); logLines.push(s); };
let stepCount = 0;

class AssertError extends Error {}
function assert(cond, msg) { if (!cond) throw new AssertError(msg); }

async function step(name, fn) {
  const t0 = Date.now();
  await fn();
  stepCount++;
  log(`  ✓ ${name} (${Date.now() - t0} ms)`);
}

/** Check for a known app bug: logged as ⚠ (doesn't fail the run unless STRICT=1). */
const knownBugs = [];
async function knownBug(name, fn) {
  try {
    await fn();
    log(`  ✓ ${name} (fixed)`);
  } catch (e) {
    knownBugs.push(`${name}: ${e.message.split('\n')[0]}`);
    log(`  ⚠ KNOWN BUG ${name} — ${e.message.split('\n')[0]}`);
    if (process.env.STRICT) throw e;
  }
}

const visible = (page, sel, opts) => page.locator(sel, opts).filter({ visible: true }).first();
const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
async function text(loc) { return (await loc.innerText()).replace(/\s+/g, ' ').trim(); }
async function mainText(page) { return text(page.locator('#main')); }
async function waitMain(page, s, timeout = 10000) {
  await page.locator('#main', { hasText: s }).first().waitFor({ timeout });
}
async function waitUrl(page, re, timeout = 10000) { await page.waitForURL(re, { timeout }); }
async function confirmDialog(page, label) {
  const dlg = dialog(page);
  await dlg.waitFor();
  await dlg.getByRole('button', { name: label, exact: true }).click();
}

async function signOutViaMenu(page) {
  // Desktop sidebar has a direct “Sign out” button; tablet rail / mobile use the account menu.
  const direct = page.locator('[data-im-signout]').filter({ visible: true });
  if (await direct.count()) await direct.first().click();
  else {
    await visible(page, 'button[data-im-account]').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
  }
  return dialog(page);
}

async function saveDownload(page, trigger, fileName) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), trigger()]);
  const target = path.join(CSV_DIR, fileName || dl.suggestedFilename());
  await dl.saveAs(target);
  const content = fs.readFileSync(target, 'utf8').replace(/^﻿/, '');
  const lines = content.split(/\r?\n/).filter(Boolean);
  return { target, content, lines, suggested: dl.suggestedFilename() };
}

async function getProduct(api, id) { return api.get(`/api/products/${id}`); }

// --------------------------------------------------------------- scenarios --

const scenarios = {};

scenarios.a = ['Auth: sign up, sign out, sign in, session', async (browser) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const email = uniqueEmail('a');
  const password = 'Correct-horse-9';
  try {
    await step('open /sign-up', async () => {
      await page.goto('/sign-up');
      await page.locator('#email').waitFor();
    });
    await step('sign up a new account → dashboard', async () => {
      await page.fill('#email', email);
      await page.fill('#password', password);
      if (await page.locator('#confirm').count()) await page.fill('#confirm', password);
      await page.click('#sign-up-btn');
      await waitUrl(page, /\/dashboard$/);
    });
    await step('dashboard is empty (new account)', async () => {
      await waitMain(page, 'Your inventory is empty');
    });
    await step('account menu → Sign out → confirm dialog', async () => {
      const dlg = await signOutViaMenu(page);
      await dlg.waitFor();
      const t = await text(dlg);
      assert(t.includes('Sign out?'), `sign-out dialog title missing: ${t}`);
      await dlg.getByRole('button', { name: 'Sign out', exact: true }).click();
      await waitUrl(page, /\/signed-out$/);
      await waitMain(page, 'You’ve been signed out');
    });
    await step('app route after sign-out redirects to /sign-in', async () => {
      await page.goto('/products');
      await waitUrl(page, /\/sign-in/);
    });
    await step('sign in with a wrong password → error alert', async () => {
      await page.fill('#email', email);
      await page.fill('#password', 'wrong-password-1');
      await page.click('#sign-in-btn');
      const alert = page.locator('#cred-alert');
      await alert.waitFor();
      const t = await text(alert);
      assert(t.includes('Email or password is incorrect'), `unexpected alert: ${t}`);
      assert(page.url().includes('/sign-in'), 'should stay on sign-in');
    });
    await step('sign in with the right password → dashboard', async () => {
      await page.fill('#password', password);
      await page.click('#sign-in-btn');
      await waitUrl(page, /\/dashboard$/);
      await waitMain(page, 'Your inventory is empty');
    });
    await step('reload keeps the session', async () => {
      await page.reload();
      await waitMain(page, 'Dashboard');
      assert(page.url().endsWith('/dashboard'), `url after reload: ${page.url()}`);
      const me = await apiClient(ctx).get('/api/auth/me');
      assert(me.email === email && !me.is_demo, 'me mismatch');
    });
  } finally { await ctx.close(); }
}];

scenarios.b = ['Categories: create, duplicate, rename, delete, delete blocked', async (browser) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    const { api } = await signUpApi(ctx);
    await step('open /categories (empty)', async () => {
      await page.goto('/categories');
      await waitMain(page, 'No categories yet');
    });
    const create = async (name) => {
      await button(page, 'New category').click();
      const dlg = dialog(page);
      await dlg.waitFor();
      await dlg.locator('#cat-name').fill(name);
      await dlg.getByRole('button', { name: 'Create category' }).click();
    };
    await step('create “Hardware”', async () => {
      await create('Hardware');
      await waitToast(page, 'Category created');
      await page.locator('#main table', { hasText: 'Hardware' }).waitFor();
    });
    await step('create “Spare”', async () => {
      await create('Spare');
      await waitToast(page, 'Category created');
      await page.locator('#main table', { hasText: 'Spare' }).waitFor();
    });
    await step('duplicate name (case-insensitive) → inline error', async () => {
      await create('hardware');
      const err = page.locator('#cat-name-error');
      await err.waitFor({ state: 'visible' });
      const t = await text(err);
      assert(/already/i.test(t), `duplicate error text: ${t}`);
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      await dialog(page).waitFor({ state: 'detached' });
    });
    await step('rename “Spare” → “Spare parts”', async () => {
      await page.getByRole('button', { name: 'Rename Spare' }).click();
      const dlg = dialog(page);
      await dlg.locator('#cat-name').fill('Spare parts');
      await dlg.getByRole('button', { name: 'Save name' }).click();
      await waitToast(page, 'Category renamed');
      await page.locator('#main table', { hasText: 'Spare parts' }).waitFor();
    });
    await step('delete unused “Spare parts” (confirm)', async () => {
      await page.getByRole('button', { name: 'Delete Spare parts', exact: true }).click();
      const dlg = dialog(page);
      await dlg.waitFor();
      assert((await text(dlg)).includes('Delete category ‘Spare parts’?'), 'delete dialog title');
      await dlg.getByRole('button', { name: 'Delete category' }).click();
      await waitToast(page, 'Category deleted');
      await page.waitForFunction(() => !document.querySelector('#main table')?.innerText.includes('Spare parts'));
      const cats = await api.get('/api/categories');
      assert(cats.length === 1 && cats[0].name === 'Hardware', 'categories after delete');
    });
    await step('delete blocked for a category used by a product', async () => {
      const cat = (await api.get('/api/categories'))[0];
      await mkProduct(api, { sku: 'B-1', name: 'Bolt', category_id: cat.id });
      await page.reload();
      await page.getByRole('button', { name: 'Delete Hardware (in use)' }).click();
      const dlg = dialog(page);
      await dlg.waitFor();
      const t = await text(dlg);
      assert(t.includes('Can’t delete ‘Hardware’'), `blocked title: ${t}`);
      await dlg.locator('[data-im-cancel]').click();
      const cats = await api.get('/api/categories');
      assert(cats.length === 1, 'category must still exist');
    });
  } finally { await ctx.close(); }
}];

scenarios.c = ['Products: validation, duplicate SKU, edit, archive/restore, list filters, CSV', async (browser) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    const { api } = await signUpApi(ctx);
    const cat = await mkCategory(api, 'Fasteners');
    const other = await mkCategory(api, 'Paint');
    const existing = await mkProduct(api, { sku: 'NAIL-01', name: 'Nails 50 mm', category_id: cat.id, unit: 'kg', min_stock: 5, purchase_price: 4 });
    await mkProduct(api, { sku: 'PNT-01', name: 'White paint', category_id: other.id, unit: 'l', purchase_price: 10 });
    let newId;
    await step('new product: submit empty → validation errors', async () => {
      await page.goto('/products/new');
      await page.locator('#f-sku').waitFor();
      await button(page, 'Save product').click();
      const summary = page.locator('.error-summary');
      await summary.waitFor();
      const t = await mainText(page);
      for (const m of ['Enter a SKU.', 'Enter a product name.']) assert(t.includes(m), `missing error “${m}”`);
      assert(page.url().endsWith('/products/new'), 'stays on form');
    });
    await step('invalid price → field error', async () => {
      await page.fill('#f-purchase', 'abc');
      await button(page, 'Save product').click();
      await page.locator('#main', { hasText: 'Enter a valid amount' }).first().waitFor();
    });
    await step('valid product → created, details page', async () => {
      await page.fill('#f-sku', 'SCR-100');
      await page.fill('#f-name', 'Wood screws 4×40');
      await page.selectOption('#f-category', String(cat.id));
      await page.selectOption('#f-unit', 'pcs');
      await page.fill('#f-purchase', '0.25');
      await page.fill('#f-sale', '0.40');
      await page.fill('#f-min', '100');
      await button(page, 'Save product').click();
      await waitToast(page, 'Product created');
      await waitUrl(page, /\/products\/\d+$/);
      newId = Number(page.url().split('/').pop());
      await waitMain(page, 'Wood screws 4×40');
    });
    await step('duplicate SKU → error naming the owner', async () => {
      await page.goto('/products/new');
      await page.fill('#f-sku', 'nail-01');
      await page.fill('#f-name', 'Another nails');
      await page.selectOption('#f-unit', 'pcs');
      await page.fill('#f-purchase', '1');
      await page.fill('#f-sale', '2');
      await button(page, 'Save product').click();
      const err = page.locator('#f-sku-error');
      await err.waitFor({ state: 'visible' });
      const t = await text(err);
      assert(t.includes('already used by') && t.includes('Nails 50 mm'), `dup sku text: ${t}`);
    });
    await step('edit product name → saved', async () => {
      await page.goto(`/products/${newId}/edit`);
      await page.locator('#f-name').waitFor();
      await page.waitForFunction(() => document.querySelector('#f-name').value !== '');
      await page.fill('#f-name', 'Wood screws 4×40 (box)');
      await button(page, 'Save product').click();
      await waitToast(page, 'Product saved');
      await waitMain(page, 'Wood screws 4×40 (box)');
      assert((await getProduct(api, newId)).name === 'Wood screws 4×40 (box)', 'name not saved');
    });
    await step('archive without stock → confirm (no warning) → archived', async () => {
      await page.goto(`/products/${newId}`);
      await button(page, 'Archive').click();
      const dlg = dialog(page);
      await dlg.waitFor();
      assert(!(await text(dlg)).includes('still has'), 'no stock warning expected');
      await dlg.getByRole('button', { name: 'Archive product' }).click();
      await waitToast(page, 'Product archived');
      assert((await getProduct(api, newId)).archived, 'should be archived');
    });
    await step('restore → active again', async () => {
      await visible(page, 'button', { hasText: /^\s*Restore( product)?\s*$/ }).click();
      await waitToast(page, 'Product restored');
      assert(!(await getProduct(api, newId)).archived, 'should be active');
    });
    await step('archive with stock → warning text → archive & restore', async () => {
      await postReceipt(api, [{ product_id: existing.id, qty: 3, price: 4 }]);
      await page.goto(`/products/${existing.id}`);
      await button(page, 'Archive').click();
      const dlg = dialog(page);
      await dlg.waitFor();
      const t = await text(dlg);
      assert(t.includes('This product still has 3 kg in stock') && t.includes('$12.00'), `warning: ${t}`);
      await dlg.getByRole('button', { name: 'Archive product' }).click();
      await waitToast(page, 'Product archived');
      assert((await getProduct(api, existing.id)).archived, 'archived');
      assert((await getProduct(api, existing.id)).stock === 3, 'stock unchanged by archive');
      await visible(page, 'button', { hasText: /^\s*Restore( product)?\s*$/ }).click();
      await waitToast(page, 'Product restored');
    });
    await step('list: search by SKU', async () => {
      await page.goto('/products');
      await page.locator('#main table').waitFor();
      await page.fill('#q', 'pnt');
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('#main tbody tr');
        return rows.length === 1 && rows[0].innerText.includes('White paint');
      }, null, { timeout: 5000 });
      await page.fill('#q', 'zzz-nothing');
      await waitMain(page, 'No products match');
      await page.fill('#q', '');
    });
    await step('list: category filter', async () => {
      await page.selectOption('#f-cat', String(cat.id));
      await page.waitForFunction(() => {
        const t = document.querySelector('#main tbody')?.innerText || '';
        return t.includes('Nails 50 mm') && t.includes('Wood screws') && !t.includes('White paint');
      }, null, { timeout: 5000 });
      assert(page.url().includes(`category_id=${cat.id}`), 'filter in URL');
      await page.selectOption('#f-cat', '');
    });
    await step('list: low stock only (Nails 3 ≤ 5, screws 0 ≤ 100)', async () => {
      await page.getByRole('button', { name: /Low stock only/ }).click();
      await page.waitForFunction(() => {
        const t = document.querySelector('#main tbody')?.innerText || '';
        return t.includes('Nails 50 mm') && t.includes('Wood screws') && !t.includes('White paint');
      }, null, { timeout: 5000 });
      await page.getByRole('button', { name: /Low stock only/ }).click();
    });
    await step('list: archived tab', async () => {
      await api.post(`/api/products/${newId}/archive`);
      await page.reload();
      await page.getByRole('button', { name: 'Archived', exact: true }).first().click();
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('#main tbody tr');
        return rows.length === 1 && rows[0].innerText.includes('Wood screws');
      }, null, { timeout: 5000 });
      await api.post(`/api/products/${newId}/restore`);
    });
    await step('Export CSV → file with expected header', async () => {
      await page.goto('/products');
      await page.locator('#main table').waitFor();
      const { lines, suggested } = await saveDownload(page, () => button(page, 'Export CSV').click(), 'products.csv');
      assert(/^products-\d{4}-\d{2}-\d{2}\.csv$/.test(suggested), `file name ${suggested}`);
      assert(lines[0].startsWith('SKU,Name,Category,Unit,Stock,Min stock,Avg cost,Stock value,Purchase price,Sale price,Status'), `header: ${lines[0]}`);
      assert(lines.length === 4, `expected 3 data rows, got ${lines.length - 1}`);
    });
  } finally { await ctx.close(); }
}];

/** Fill receipt line N (1-based) on the editor. */
async function fillReceiptLine(page, n, productId, qty, price) {
  if ((await page.locator(`#ln${n}-p`).count()) === 0) await page.click('#add-line');
  if (productId != null) await page.selectOption(`#ln${n}-p`, String(productId));
  if (qty != null) await page.fill(`#ln${n}-q`, String(qty));
  if (price != null) await page.fill(`#ln${n}-c`, String(price));
}

async function postFromEditor(page, noun) {
  await button(page, `Post ${noun}`).click();
  await confirmDialog(page, `Post ${noun}`);
}

scenarios.d = ['Receipts: validation, draft, post, average cost, reverse, reverse refused', async (browser) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    const { api } = await signUpApi(ctx);
    const p = await mkProduct(api, { sku: 'AVG-1', name: 'Average widget', unit: 'pcs', purchase_price: 2 });
    const q = await mkProduct(api, { sku: 'CON-1', name: 'Consumed widget', unit: 'pcs', purchase_price: 5 });
    let draftId, rc2Id;
    await step('new receipt: Post disabled until a product is chosen', async () => {
      await page.goto('/receipts/new');
      await page.locator('#ln1-p').waitFor();
      assert(await button(page, 'Post receipt').isDisabled(), 'Post should be disabled with no product');
    });
    await step('qty 0 on line 1 + line 2 without product → validation errors', async () => {
      await fillReceiptLine(page, 1, p.id, 0, null);
      await page.click('#add-line');
      await page.fill('#ln2-q', '1');
      await button(page, 'Post receipt').click();
      const s = page.locator('#error-summary');
      await s.waitFor();
      const t = await text(s);
      assert(/Fix 2 problems to post this receipt/.test(t), `summary: ${t}`);
      assert(t.includes('Line 2 — choose a product') && t.includes('Line 1 — enter a quantity greater than 0'), `errors: ${t}`);
      assert(await page.locator('#ln1-q[aria-invalid=true]').count() === 1, 'line 1 qty marked invalid');
      assert(!(await dialog(page).count()), 'no confirm dialog when invalid');
      await page.getByRole('button', { name: 'Remove line 2' }).click();
    });
    await step('save draft (10 × $2.00, supplier) → draft URL', async () => {
      await page.fill('#f-supplier', 'Builders Depot');
      await fillReceiptLine(page, 1, p.id, 10, '2.00');
      await button(page, 'Save draft').click();
      await waitToast(page, 'Draft saved');
      await waitUrl(page, /\/receipts\/\d+$/);
      draftId = Number(page.url().split('/').pop());
      const doc = await api.get(`/api/receipts/${draftId}`);
      assert(doc.status === 'draft' && doc.total === 20, `draft: ${doc.status} ${doc.total}`);
      assert((await getProduct(api, p.id)).stock === 0, 'draft must not change stock');
    });
    await step('post the draft (confirm dialog) → posted, stock 10', async () => {
      await page.reload();
      await page.locator('#ln1-q').waitFor();
      await button(page, 'Post receipt').click();
      const dlg = dialog(page);
      await dlg.waitFor();
      const t = await text(dlg);
      assert(t.includes('Post receipt RC-') && t.includes('Builders Depot') && t.includes('$20.00'), `post dialog: ${t}`);
      await dlg.getByRole('button', { name: 'Post receipt' }).click();
      await waitToast(page, 'posted');
      await waitMain(page, 'Posted');
      assert((await getProduct(api, p.id)).stock === 10, 'stock should be 10');
    });
    await step('second receipt 30 × $3.00 posted via UI', async () => {
      await page.goto('/receipts/new');
      await page.locator('#ln1-p').waitFor();
      await fillReceiptLine(page, 1, p.id, 30, '3.00');
      await postFromEditor(page, 'receipt');
      await waitToast(page, 'posted');
      await waitUrl(page, /\/receipts\/\d+$/);
      rc2Id = Number(page.url().split('/').pop());
    });
    await step('product page: stock 40, average cost (10×2 + 30×3)/40 = $2.75', async () => {
      await page.goto(`/products/${p.id}`);
      await waitMain(page, 'Average cost');
      const t = await mainText(page);
      assert(t.includes('$2.75'), 'avg cost $2.75 not shown');
      assert(t.includes('$110.00'), 'stock value $110.00 not shown');
      const prod = await getProduct(api, p.id);
      assert(prod.stock === 40 && prod.avg_cost === 2.75, `api: ${prod.stock} ${prod.avg_cost}`);
    });
    let rvUrl;
    await step('reverse the second receipt (confirm) → reversal document page', async () => {
      await page.goto(`/receipts/${rc2Id}`);
      await button(page, 'Reverse').click();
      const dlg = dialog(page);
      await dlg.waitFor();
      const t = await text(dlg);
      assert(t.includes('Reverse receipt RC-') && t.includes('40 pcs → 10 pcs'), `reverse dialog: ${t}`);
      await dlg.getByRole('button', { name: 'Reverse receipt' }).click();
      await waitToast(page, 'reversed');
      await waitUrl(page, /\/reversals\/\d+$/);
      rvUrl = page.url();
      await waitMain(page, 'Reversal document');
      assert((await mainText(page)).includes('RV-'), 'reversal number');
      assert((await getProduct(api, p.id)).stock === 10, 'stock back to 10');
    });
    await step('original receipt shows “Reversed” with link to the reversal', async () => {
      await page.goto(`/receipts/${rc2Id}`);
      await waitMain(page, 'was reversed');
      const t = await mainText(page);
      assert(t.includes('Reversed'), 'Reversed badge');
      assert(!(await page.getByRole('button', { name: 'Reverse', exact: true }).filter({ visible: true }).count()), 'no Reverse button');
      const link = page.locator('#main a[href^="/reversals/"]').first();
      assert(new URL(rvUrl).pathname === await link.getAttribute('href'), 'link to reversal');
    });
    await step('reverse refused when stock was consumed → shortage dialog', async () => {
      const rc = await postReceipt(api, [{ product_id: q.id, qty: 10, price: 5 }]);
      await postWriteOff(api, [{ product_id: q.id, qty: 6 }]);
      await page.goto(`/receipts/${rc.id}`);
      await button(page, 'Reverse').click();
      const dlg = dialog(page);
      await dlg.waitFor();
      await dlg.locator('text=Stock would go below zero').waitFor();
      const t = await text(dlg);
      assert(t.includes(`Can’t reverse ${rc.number}`) && t.includes('Consumed widget'), `refused: ${t}`);
      assert(/Shortfall/i.test(t) && t.includes('6 pcs'), `shortfall figures: ${t}`);
      await dlg.getByRole('button', { name: 'OK' }).click();
      const doc = await api.get(`/api/receipts/${rc.id}`);
      assert(doc.status === 'posted', 'still posted');
      assert((await getProduct(api, q.id)).stock === 4, 'stock unchanged (4)');
    });
  } finally { await ctx.close(); }
}];

scenarios.e = ['Write-offs: insufficient stock, post, reverse', async (browser) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    const { api } = await signUpApi(ctx);
    const a = await mkProduct(api, { sku: 'WA-1', name: 'Alpha tape', unit: 'pcs', purchase_price: 3 });
    const b = await mkProduct(api, { sku: 'WB-1', name: 'Beta glue', unit: 'kg', purchase_price: 8 });
    await postReceipt(api, [{ product_id: a.id, qty: 5, price: 3 }, { product_id: b.id, qty: 2.5, price: 8 }]);
    let woId;
    await step('new write-off exceeding stock on 2 lines → refusal with shortage list', async () => {
      await page.goto('/write-offs/new');
      await page.locator('#ln1-p').waitFor();
      await page.selectOption('#f-reason', 'Damaged');
      await page.selectOption('#ln1-p', String(a.id));
      await page.fill('#ln1-q', '8');
      await page.click('#add-line');
      await page.selectOption('#ln2-p', String(b.id));
      await page.fill('#ln2-q', '3');
      await button(page, 'Post write-off').click();
      const s = page.locator('#error-summary');
      await s.waitFor();
      const t = await text(s);
      assert(t.includes('Can’t post: not enough stock for 2 items'), `summary: ${t}`);
      assert(t.includes('Alpha tape') && t.includes('5 pcs') && t.includes('Beta glue') && t.includes('2.5 kg'), `shortages: ${t}`);
      assert((await getProduct(api, a.id)).stock === 5, 'stock unchanged');
    });
    await step('server-side refusal too (stock changed after page load)', async () => {
      // Fix quantities in UI, then consume stock behind the page's back; the server must refuse.
      await page.fill('#ln1-q', '4');
      await page.fill('#ln2-q', '1');
      const extra = await postWriteOff(api, [{ product_id: a.id, qty: 3 }]);
      await button(page, 'Post write-off').click();
      await dialog(page).waitFor();
      await dialog(page).getByRole('button', { name: 'Post write-off' }).click();
      await page.locator('#error-summary', { hasText: 'not enough stock' }).waitFor();
      const t = await text(page.locator('#error-summary'));
      assert(t.includes('Alpha tape') && t.includes('2 pcs'), `server shortages: ${t}`);
      await api.post(`/api/write-offs/${extra.id}/reverse`, {});
    });
    await step('valid post (confirm) → stock decreased', async () => {
      await page.reload();
      await page.locator('#ln1-q').waitFor();
      await page.fill('#ln1-q', '4');
      await page.fill('#ln2-q', '1');
      await button(page, 'Post write-off').click();
      const dlg = dialog(page);
      await dlg.waitFor();
      assert((await text(dlg)).includes('Damaged'), 'reason in dialog');
      await dlg.getByRole('button', { name: 'Post write-off' }).click();
      await waitToast(page, 'posted');
      await waitUrl(page, /\/write-offs\/\d+$/);
      woId = Number(page.url().split('/').pop());
      await waitMain(page, 'Posted');
      assert((await getProduct(api, a.id)).stock === 1, 'Alpha 1');
      assert((await getProduct(api, b.id)).stock === 1.5, 'Beta 1.5');
      const doc = await api.get(`/api/write-offs/${woId}`);
      assert(doc.total === 20, `value at avg cost 4×3 + 1×8 = 20, got ${doc.total}`);
    });
    await step('reverse (confirm) → reversal document, stock restored', async () => {
      await button(page, 'Reverse').click();
      const dlg = dialog(page);
      await dlg.waitFor();
      assert((await text(dlg)).includes('returns these quantities to stock'), 'reverse WO text');
      await dlg.getByRole('button', { name: 'Reverse write-off' }).click();
      await waitToast(page, 'reversed');
      await waitUrl(page, /\/reversals\/\d+$/);
      await waitMain(page, 'Reversal document');
      assert((await getProduct(api, a.id)).stock === 5, 'Alpha back to 5');
      assert((await getProduct(api, b.id)).stock === 2.5, 'Beta back to 2.5');
      assert((await api.get(`/api/write-offs/${woId}`)).status === 'reversed', 'original reversed');
    });
  } finally { await ctx.close(); }
}];

scenarios.f = ['Stock count: category scope, surplus/shortage/not counted, post', async (browser) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    const { api } = await signUpApi(ctx);
    const cat = await mkCategory(api, 'Aisle 1');
    await mkCategory(api, 'Aisle 2');
    const s = await mkProduct(api, { sku: 'SC-S', name: 'Surplus item', category_id: cat.id, purchase_price: 2 });
    const h = await mkProduct(api, { sku: 'SC-H', name: 'Shortage item', category_id: cat.id, purchase_price: 4 });
    const n = await mkProduct(api, { sku: 'SC-N', name: 'Not counted item', category_id: cat.id, purchase_price: 1 });
    await postReceipt(api, [{ product_id: s.id, qty: 10, price: 2 }, { product_id: h.id, qty: 10, price: 4 }, { product_id: n.id, qty: 5, price: 1 }]);
    let scId;
    await step('new stock count for category “Aisle 1”', async () => {
      await page.goto('/stock-counts/new');
      await page.locator('#sc-create').waitFor();
      await page.locator('input[name=scope][value=category]').check();
      await page.selectOption('#sc-cat', String(cat.id));
      await page.fill('#sc-note', 'E2E count');
      await page.click('#sc-create');
      await waitUrl(page, /\/stock-counts\/\d+$/);
      scId = Number(page.url().split('/').pop());
      await waitMain(page, 'Stock count SC-');
      const rows = await page.locator('#sc-body tr').count();
      assert(rows === 3, `3 lines expected, got ${rows}`);
    });
    const doc0 = await api.get(`/api/stock-counts/${scId}`);
    const lineOf = (pid) => doc0.lines.find((l) => l.product.id === pid).id;
    await step('enter actual quantities: surplus 12, shortage 7, one not counted', async () => {
      await page.fill(`#act-${lineOf(s.id)}`, '12');
      await page.fill(`#act-${lineOf(h.id)}`, '7');
      await page.locator(`#act-${lineOf(h.id)}`).blur();
      await waitMain(page, '+2 pcs');
      const t = await mainText(page);
      assert(t.includes('−3 pcs'), 'shortage −3 pcs shown');
    });
    await step('save draft', async () => {
      await button(page, 'Save draft').click();
      await waitToast(page, 'Draft saved');
      const d = await api.get(`/api/stock-counts/${scId}`);
      const counted = d.lines.filter((l) => l.actual_qty != null).length;
      assert(counted === 2, `2 counted lines saved, got ${counted}`);
    });
    await step('post adjustments → confirm summary → posted', async () => {
      await button(page, 'Post adjustments').click();
      const dlg = dialog(page);
      await dlg.waitFor();
      const t = await text(dlg);
      assert(t.includes('Post stock count SC-'), `confirm: ${t}`);
      assert(/not counted/i.test(t), `confirm should mention not counted: ${t}`);
      await dlg.getByRole('button', { name: 'Post adjustments' }).click();
      await waitToast(page, 'posted');
      await waitMain(page, 'Posted');
      assert((await api.get(`/api/stock-counts/${scId}`)).status === 'posted', 'status posted');
    });
    await step('stock set to actual for counted lines; not counted unchanged', async () => {
      assert((await getProduct(api, s.id)).stock === 12, 'surplus → 12');
      assert((await getProduct(api, h.id)).stock === 7, 'shortage → 7');
      assert((await getProduct(api, n.id)).stock === 5, 'not counted stays 5');
    });
    await step('history shows the stock count adjustments', async () => {
      await page.goto('/history?type=stock_count');
      await page.locator('#main tbody tr').first().waitFor();
      const t = await text(page.locator('#main tbody'));
      assert(t.includes('Surplus item') && t.includes('+2') && t.includes('Shortage item') && t.includes('−3'), `history: ${t}`);
      assert(!t.includes('Not counted item'), 'no movement for not-counted item');
    });
  } finally { await ctx.close(); }
}];

scenarios.g = ['History: type and product filters, link to document', async (browser) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    const { api } = await signUpApi(ctx);
    const a = await mkProduct(api, { sku: 'H-A', name: 'History apple' });
    const b = await mkProduct(api, { sku: 'H-B', name: 'History banana' });
    const rc = await postReceipt(api, [{ product_id: a.id, qty: 10, price: 1 }, { product_id: b.id, qty: 4, price: 1 }]);
    const wo = await postWriteOff(api, [{ product_id: a.id, qty: 2 }]);
    await step('history lists all 3 movements', async () => {
      await page.goto('/history');
      await page.locator('#main tbody tr').first().waitFor();
      await page.waitForFunction(() => document.querySelectorAll('#main tbody tr').length === 3);
    });
    await step('filter by type = Write-off', async () => {
      await page.selectOption('#h-type', 'write_off');
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('#main tbody tr');
        return rows.length === 1 && rows[0].innerText.includes('Write-off');
      });
      const t = await text(page.locator('#main tbody'));
      assert(t.includes(wo.number) && t.includes('History apple'), `wo row: ${t}`);
      assert(page.url().includes('type=write_off'), 'type in URL');
    });
    await step('filter by product (type reset)', async () => {
      await page.selectOption('#h-type', '');
      await page.waitForFunction(() => document.querySelectorAll('#main tbody tr').length === 3);
      await page.selectOption('#h-product', String(b.id));
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('#main tbody tr');
        return rows.length === 1 && rows[0].innerText.includes('History banana');
      });
      assert(page.url().includes(`product=${b.id}`), 'product in URL');
      const t = await text(page.locator('#main tbody'));
      assert(t.includes('History banana') && t.includes(rc.number), `product row: ${t}`);
    });
    await step('document link opens the receipt', async () => {
      await page.locator('#main tbody a', { hasText: rc.number }).first().click();
      await waitUrl(page, new RegExp(`/receipts/${rc.id}$`));
      await waitMain(page, `Receipt ${rc.number}`);
    });
    await step('product page “View full history” opens History filtered by that product', async () => {
      await page.goto(`/products/${b.id}`);
      await page.locator('#main a', { hasText: 'View full history' }).click();
      await waitUrl(page, /\/history/);
      await page.locator('#main tbody tr').first().waitFor();
      await page.waitForTimeout(500);
      const sel = await page.$eval('#h-product', (e) => e.value);
      const rows = await page.locator('#main tbody tr').count();
      assert(sel === String(b.id) && rows === 1, `url ${page.url()} → product filter “${sel}”, ${rows} rows (expected 1 row of History banana)`);
    });
  } finally { await ctx.close(); }
}];

const REPORTS = [
  ['stock-on-date', 'Stock on', async (page) => {
    await page.fill('#rp-date', '2026-11-01');
  }],
  ['movement', 'Stock movement', async (page) => {
    await page.fill('#rp-from', '2026-10-01');
    await page.fill('#rp-to', '2026-11-05');
  }],
  ['low-stock', 'Low stock', async (page) => {
    await page.selectOption('#rp-cat', { label: 'Fasteners' });
  }],
  ['write-offs-by-reason', 'Write-offs by reason', async (page) => {
    await page.fill('#rp-from', '2026-09-01');
  }],
  ['stock-value', 'Stock value', async (page) => {
    await page.selectOption('#rp-cat', { label: 'Plumbing' });
  }],
];

scenarios.h = ['Reports: all 5 with demo data, parameters, CSV export', async (browser) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    const api = apiClient(ctx);
    await api.post('/api/auth/demo');
    for (const [id, title, change] of REPORTS) {
      await step(`${id}: renders with data`, async () => {
        await page.goto(`/reports/${id}`);
        await page.locator('#rp-title', { hasText: title }).waitFor();
        await page.locator('#rp-result tbody tr').first().waitFor();
        const rows = await page.locator('#rp-result tbody tr').count();
        assert(rows > 0, 'rows');
      });
      await step(`${id}: change parameters → re-rendered`, async () => {
        const before = await text(page.locator('#rp-title'));
        const beforeRows = await text(page.locator('#rp-result'));
        await change(page);
        if (await page.getByRole('button', { name: 'Apply' }).filter({ visible: true }).count())
          await page.getByRole('button', { name: 'Apply' }).filter({ visible: true }).click();
        await page.waitForFunction(([b, br]) => {
          const t = document.querySelector('#rp-title')?.innerText;
          const r = document.querySelector('#rp-result')?.innerText;
          return (t && t !== b) || (r && r !== br);
        }, [before, beforeRows], { timeout: 8000 });
        await page.locator('#rp-result tbody tr').first().waitFor();
        assert(new URL(page.url()).search.length > 1, `params in URL: ${page.url()}`);
      });
      await step(`${id}: export CSV`, async () => {
        const { lines, suggested } = await saveDownload(page, () => page.click('#rp-export'), `report-${id}.csv`);
        assert(lines.length >= 2, `CSV ${suggested} has ${lines.length} lines`);
        assert(/[A-Za-z]/.test(lines[0]) && lines[0].includes(','), `header: ${lines[0]}`);
        log(`      ${suggested} → docs/evidence/csv/report-${id}.csv (${lines.length - 1} rows) header: ${lines[0]}`);
      });
    }
    await api.post('/api/auth/sign-out');
  } finally { await ctx.close(); }
}];

scenarios.i = ['Demo lifecycle: try demo, expire, new demo, sign out & delete', async (browser) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    let email, userId;
    await step('sign-in page → Try demo → dashboard with data + demo banner', async () => {
      await page.goto('/sign-in');
      await page.click('#demo-btn');
      await waitUrl(page, /\/dashboard$/, 20000);
      await page.locator('.demo-banner').waitFor();
      // the loading skeleton also uses .kpi — wait for the real figures
      await page.locator('#main .kpi-label', { hasText: 'Total stock value' }).first().waitFor();
      const t = await mainText(page);
      assert(t.includes('Demo workspace') && t.includes('Total stock value') && !t.includes('Your inventory is empty'), 'seeded dashboard');
      const me = await apiClient(ctx).get('/api/auth/me');
      assert(me.is_demo, 'is_demo');
      email = me.email; userId = me.id;
      log(`      demo account: ${email}`);
    });
    await step('reload keeps the demo session', async () => {
      await page.reload();
      await page.locator('.demo-banner').waitFor();
      assert(page.url().endsWith('/dashboard'), 'still on dashboard');
    });
    await step('expire via SQL → reload → /demo-expired', async () => {
      const prodCount = Number(psql(`SELECT count(*) FROM products WHERE user_id = ${userId}`));
      assert(prodCount > 0, 'demo has products before expiry');
      psql(`UPDATE users SET demo_expires_at = now() - interval '1 minute' WHERE email = '${email}'`);
      await page.reload();
      await waitUrl(page, /\/demo-expired$/, 15000);
      await waitMain(page, 'Start a new demo');
    });
    await step('psql: expired demo user and its products are deleted', async () => {
      // Deletion happens when the expired session is used; poll briefly.
      let users = '1', products = '1';
      for (let i = 0; i < 20; i++) {
        users = psql(`SELECT count(*) FROM users WHERE email = '${email}'`);
        products = psql(`SELECT count(*) FROM products WHERE user_id = ${userId}`);
        if (users === '0' && products === '0') break;
        await page.waitForTimeout(500);
      }
      assert(users === '0', `user rows: ${users}`);
      assert(products === '0', `product rows: ${products}`);
    });
    await step('Start a new demo from the expired screen → new demo dashboard', async () => {
      await page.click('#new-demo-btn');
      await waitUrl(page, /\/dashboard$/, 20000);
      await page.locator('.demo-banner').waitFor();
      const me = await apiClient(ctx).get('/api/auth/me');
      assert(me.is_demo && me.email !== email, 'a different demo');
      email = me.email; userId = me.id;
      log(`      new demo account: ${email}`);
    });
    await step('sign out of demo → “Sign out and delete demo” → signed-out (demo variant)', async () => {
      const dlg = await signOutViaMenu(page);
      await dlg.waitFor();
      const t = await text(dlg);
      assert(t.includes('Sign out of the demo?'), `demo dialog: ${t}`);
      await dlg.getByRole('button', { name: 'Sign out and delete demo' }).click();
      await waitUrl(page, /\/signed-out\?demo=1$/);
      await waitMain(page, 'You left the demo');
    });
    await step('psql: demo account and its data are gone', async () => {
      assert(psql(`SELECT count(*) FROM users WHERE email = '${email}'`) === '0', 'user deleted');
      assert(psql(`SELECT count(*) FROM products WHERE user_id = ${userId}`) === '0', 'products deleted');
      assert(psql(`SELECT count(*) FROM documents WHERE user_id = ${userId}`) === '0', 'documents deleted');
    });
  } finally { await ctx.close(); }
}];

// ------------------------------------------------------------------ runner --

const only = process.argv.slice(2);
const ids = Object.keys(scenarios).filter((k) => !only.length || only.includes(k));
const browser = await launch();
const results = [];
log(`Inventory Manager — e2e scenarios against ${BASE_URL} (${new Date().toISOString()})`);
for (const id of ids) {
  const [title, fn] = scenarios[id];
  log(`\n${id}) ${title}`);
  const before = stepCount;
  const t0 = Date.now();
  try {
    await fn(browser);
    results.push({ id, title, ok: true, steps: stepCount - before });
    log(`  PASS ${id} — ${stepCount - before} steps, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    results.push({ id, title, ok: false, steps: stepCount - before, error: e.message });
    log(`  ✗ FAIL ${id} after ${stepCount - before} steps: ${e.message.split('\n')[0]}`);
    if (!(e instanceof AssertError)) console.error(e.stack);
  }
}
await browser.close();
const failed = results.filter((r) => !r.ok);
log(`\nSummary: ${results.length - failed.length}/${results.length} scenarios passed, ${stepCount} steps ✓`);
for (const r of results) log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}) ${r.title} — ${r.steps} steps${r.ok ? '' : ` — ${r.error.split('\n')[0]}`}`);
if (knownBugs.length) { log(`Known app bugs (not counted as failures; STRICT=1 to fail):`); knownBugs.forEach((b) => log(`  ⚠ ${b}`)); }
if (!only.length) fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n');
process.exit(failed.length ? 1 : 0);
