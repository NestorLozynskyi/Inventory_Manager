/**
 * Receipts / write-offs / reversals — shared types, per-type configuration and pure helpers
 * (page-local to pages/documents; contract: docs/api.md "Documents").
 */
import { fmtQty, parseDecimalInput, maxDecimals, fitsUnitPrecision, decimalsOf, toIsoDate } from "../../lib/format";

export type DocType = "receipt" | "write_off";
export type DocKind = DocType | "receipt_reversal" | "write_off_reversal";
export type DocStatus = "draft" | "posted" | "reversed";

export interface DocRef {
  id: number;
  number: string;
  kind: DocKind;
  posted_at: string | null;
}

export interface ProductRef {
  id: number;
  sku: string;
  name: string;
  unit: string;
  archived: boolean;
  stock: number;
  avg_cost: number;
  purchase_price: number;
  category_id?: number | null;
  category_name?: string | null;
}

export interface DocLine {
  id: number;
  product: ProductRef | null;
  qty: number | null;
  price?: number | null;
  unit_cost?: number | null;
  total: number;
}

export interface Doc {
  id: number;
  kind: DocKind;
  number: string;
  status: DocStatus;
  created_at: string;
  posted_at: string | null;
  date?: string | null;
  note: string;
  line_count: number;
  total: number;
  supplier?: string | null;
  reason?: string | null;
  reversal: DocRef | null;
  reverses: DocRef | null;
  lines?: DocLine[];
}

export interface DocList {
  items: Doc[];
}

export interface Product extends ProductRef {
  category_id: number | null;
  category_name: string | null;
}

export interface ProductList {
  items: Product[];
}

export interface Shortage {
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  required: number;
  available: number;
  line_index: number | null;
}

export interface DocConfig {
  type: DocType;
  api: string;
  listPath: string;
  nav: "receipts" | "write-offs";
  /** "Receipts" — section / topbar title. */
  section: string;
  /** "receipt" / "write-off" (lower case, in sentences). */
  noun: string;
  /** "Receipt" / "Write-off". */
  Noun: string;
  /** "receipts" / "write-offs". */
  nouns: string;
}

export const RECEIPT: DocConfig = {
  type: "receipt",
  api: "/api/receipts",
  listPath: "/receipts",
  nav: "receipts",
  section: "Receipts",
  noun: "receipt",
  Noun: "Receipt",
  nouns: "receipts",
};

export const WRITE_OFF: DocConfig = {
  type: "write_off",
  api: "/api/write-offs",
  listPath: "/write-offs",
  nav: "write-offs",
  section: "Write-offs",
  noun: "write-off",
  Noun: "Write-off",
  nouns: "write-offs",
};

export function isReversal(kind: string | null | undefined): boolean {
  return kind === "receipt_reversal" || kind === "write_off_reversal";
}

/** Config of the section a document belongs to (reversals → the section of the original). */
export function configForKind(kind: string | null | undefined): DocConfig {
  return kind === "write_off" || kind === "write_off_reversal" ? WRITE_OFF : RECEIPT;
}

/** App URL of a document (reversal kinds → /reversals/:id). */
export function docUrl(ref: { id: number; kind: string }): string {
  if (isReversal(ref.kind)) return `/reversals/${ref.id}`;
  return `${configForKind(ref.kind).listPath}/${ref.id}`;
}

/** Document date: posted_at for posted docs, created_at for drafts. */
export function docDate(d: Pick<Doc, "posted_at" | "created_at">): string {
  return d.posted_at || d.created_at;
}

export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** "3 lines", "1 product". */
export function pl(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Enter a quantity greater than 0." → "enter a quantity greater than 0." (error summary items). */
export function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/* ------------------------------------------------------------- periods -- */

export type PeriodKey = "all" | "last-30" | "this-month" | "last-month" | "custom";
export const PERIOD_OPTIONS: [PeriodKey, string][] = [
  ["all", "All time"],
  ["last-30", "Last 30 days"],
  ["this-month", "This month"],
  ["last-month", "Last month"],
  ["custom", "Custom range…"],
];
export const PERIOD_LABEL: Record<string, string> = {
  "last-30": "Last 30 days",
  "this-month": "This month",
  "last-month": "Last month",
  custom: "Custom",
};

/** Date range (local calendar days, "YYYY-MM-DD") of a period preset relative to `today`. */
export function periodRange(period: string, from: string, to: string, today: Date = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (period === "last-30") {
    const d = new Date(y, m, today.getDate() - 29);
    return { from: toIsoDate(d), to: toIsoDate(today) };
  }
  if (period === "this-month") return { from: toIsoDate(new Date(y, m, 1)), to: toIsoDate(new Date(y, m + 1, 0)) };
  if (period === "last-month") return { from: toIsoDate(new Date(y, m - 1, 1)), to: toIsoDate(new Date(y, m, 0)) };
  if (period === "custom") return { from, to };
  return { from: "", to: "" };
}

export const STATUS_OPTIONS: [string, string][] = [
  ["all", "All statuses"],
  ["draft", "Draft"],
  ["posted", "Posted"],
  ["reversed", "Reversed"],
  ["reversal", "Reversal"],
];
export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  posted: "Posted",
  reversed: "Reversed",
  reversal: "Reversal",
};

/* ------------------------------------------------------- editor model -- */

export interface LineModel {
  key: string;
  productId: number | null;
  qty: string;
  price: string;
}

export interface EditModel {
  supplier: string;
  reason: string;
  note: string;
  lines: LineModel[];
}

export interface LineErrors {
  product?: string;
  qty?: string;
  price?: string;
}

export interface SummaryItem {
  /** DOM id of the field to focus. */
  id: string;
  text: string;
}

export interface Validation {
  reason?: string;
  lines: Record<string, LineErrors>;
  list: SummaryItem[];
}

let keySeq = 0;
export function mkLine(l?: Partial<Omit<LineModel, "key">>): LineModel {
  keySeq += 1;
  return { key: `ln${keySeq}`, productId: l?.productId ?? null, qty: l?.qty ?? "", price: l?.price ?? "" };
}

export function price2(v: number | null | undefined): string {
  return v == null ? "" : Number(v).toFixed(2);
}

export function qtyStr(v: number | null | undefined): string {
  return v == null ? "" : String(r3(Number(v)));
}

export function modelFromDoc(doc: Doc | null, cfg: DocConfig): EditModel {
  if (!doc) return { supplier: "", reason: "", note: "", lines: [mkLine()] };
  const lines = (doc.lines ?? []).map((l) =>
    mkLine({ productId: l.product?.id ?? null, qty: qtyStr(l.qty), price: cfg.type === "receipt" ? price2(l.price) : "" }),
  );
  return {
    supplier: doc.supplier ?? "",
    reason: doc.reason ?? "",
    note: doc.note ?? "",
    lines: lines.length ? lines : [mkLine()],
  };
}

/** Parsed number of an input value; NaN for invalid, null for empty. */
export function num(v: string): number | null {
  return parseDecimalInput(v);
}

/** Receipt line total = qty × price (0 when incomplete). */
export function receiptLineTotal(l: LineModel): number {
  const q = num(l.qty);
  const p = num(l.price);
  return q != null && p != null && Number.isFinite(q) && Number.isFinite(p) ? r2(q * p) : 0;
}

/** Write-off line value = qty × current average cost (0 when incomplete). */
export function writeOffLineValue(l: LineModel, product: ProductRef | undefined): number {
  const q = num(l.qty);
  return product && q != null && Number.isFinite(q) ? r2(q * product.avg_cost) : 0;
}

/** Request body value: number, null for empty, raw text for invalid input (server reports it). */
function bodyNum(v: string): number | string | null {
  const n = num(v);
  if (n == null) return null;
  return Number.isFinite(n) ? n : v.trim();
}

export function requestBody(m: EditModel, cfg: DocConfig): Record<string, unknown> {
  if (cfg.type === "receipt") {
    return {
      supplier: m.supplier.trim(),
      note: m.note.trim(),
      lines: m.lines.map((l) => ({ product_id: l.productId, qty: bodyNum(l.qty), price: bodyNum(l.price) })),
    };
  }
  const body: Record<string, unknown> = {
    note: m.note.trim(),
    lines: m.lines.map((l) => ({ product_id: l.productId, qty: bodyNum(l.qty) })),
  };
  // The API requires a valid reason on drafts too; an unset reason is omitted (server default).
  if (m.reason) body.reason = m.reason;
  return body;
}

/** Quantity rule mirrored from the server (> 0, whole for pcs/pack, ≤ 3 decimals otherwise). */
export function qtyError(raw: string, unit: string | undefined): string | undefined {
  const q = num(raw);
  if (q == null || !Number.isFinite(q) || !(q > 0)) return "Enter a quantity greater than 0.";
  if (unit && !fitsUnitPrecision(q, unit)) {
    return maxDecimals(unit) === 0
      ? `Enter a whole number — ${unit} can't be fractional.`
      : "Use at most 3 decimal places.";
  }
  return undefined;
}

export function priceError(raw: string): string | undefined {
  const p = num(raw);
  if (p == null || !Number.isFinite(p) || p < 0) return "Enter a price of $0.00 or more.";
  if (decimalsOf(p) > 2) return "Use at most 2 decimal places.";
  return undefined;
}

/** Client-side validation before posting (the server re-validates). */
export function validateModel(
  m: EditModel,
  cfg: DocConfig,
  productOf: (id: number | null) => ProductRef | undefined,
): Validation {
  const e: Validation = { lines: {}, list: [] };
  if (cfg.type === "write_off" && !m.reason) {
    e.reason = "Choose a reason.";
    e.list.push({ id: "f-reason", text: "Reason — choose a reason." });
  }
  m.lines.forEach((l, i) => {
    const le: LineErrors = {};
    const n = i + 1;
    const p = productOf(l.productId);
    if (!l.productId) {
      le.product = "Choose a product.";
      e.list.push({ id: `${l.key}-p`, text: `Line ${n} — choose a product.` });
    }
    const qe = qtyError(l.qty, p?.unit);
    if (qe) {
      le.qty = qe;
      e.list.push({ id: `${l.key}-q`, text: `Line ${n} — ${lowerFirst(qe)}` });
    }
    if (cfg.type === "receipt" && l.productId) {
      const pe = priceError(l.price);
      if (pe) {
        le.price = pe;
        e.list.push({ id: `${l.key}-c`, text: `Line ${n} — enter a unit price.` });
      }
    }
    if (le.product || le.qty || le.price) e.lines[l.key] = le;
  });
  return e;
}

export interface StockIssue {
  productId: number;
  sku: string;
  name: string;
  unit: string;
  requested: number;
  available: number;
  /** Line keys with this product. */
  keys: string[];
}

/** Write-off lines whose summed quantity per product exceeds stock on hand. */
export function stockIssues(m: EditModel, productOf: (id: number | null) => ProductRef | undefined): StockIssue[] {
  const need = new Map<number, number>();
  const keys = new Map<number, string[]>();
  for (const l of m.lines) {
    const q = num(l.qty);
    if (!l.productId || q == null || !(q > 0)) continue;
    need.set(l.productId, r3((need.get(l.productId) ?? 0) + q));
    keys.set(l.productId, [...(keys.get(l.productId) ?? []), l.key]);
  }
  const out: StockIssue[] = [];
  for (const [pid, requested] of need) {
    const p = productOf(pid);
    if (!p || requested <= p.stock) continue;
    out.push({ productId: pid, sku: p.sku, name: p.name, unit: p.unit, requested, available: p.stock, keys: keys.get(pid)! });
  }
  return out;
}

/** Stock issues from a 409 insufficient_stock response (lines matched by product). */
export function issuesFromShortages(shortages: Shortage[], m: EditModel): StockIssue[] {
  return shortages.map((s) => ({
    productId: s.product_id,
    sku: s.sku,
    name: s.name,
    unit: s.unit,
    requested: s.required,
    available: s.available,
    keys: m.lines.filter((l) => l.productId === s.product_id).map((l) => l.key),
  }));
}

/** Inline message next to the quantity of a line that exceeds stock (mockup wording). */
export function stockMessage(x: StockIssue): string {
  let msg = x.available > 0 ? `Only ${fmtQty(x.available, x.unit)} available.` : `Out of stock — 0 ${x.unit} available.`;
  if (x.keys.length > 1) msg += ` This product is on ${x.keys.length} lines.`;
  return msg;
}

/** Map API field errors ("lines.2.qty", "reason") onto line keys of the current model. */
export function validationFromFieldErrors(
  fields: Record<string, string>,
  m: EditModel,
  general: string[] = [],
): Validation {
  const e: Validation = { lines: {}, list: [] };
  const entries = Object.entries(fields);
  for (const [field, msg] of entries) {
    if (field === "reason") {
      e.reason = msg;
      e.list.push({ id: "f-reason", text: `Reason — ${lowerFirst(msg)}` });
      continue;
    }
    if (field === "supplier") {
      e.list.push({ id: "f-supplier", text: `Supplier — ${lowerFirst(msg)}` });
      continue;
    }
    if (field === "note") {
      e.list.push({ id: "f-note", text: `Note — ${lowerFirst(msg)}` });
      continue;
    }
    const mm = /^lines\.(\d+)\.(product_id|qty|price)$/.exec(field);
    if (mm) {
      const i = Number(mm[1]);
      const l = m.lines[i];
      if (!l) continue;
      const le = (e.lines[l.key] ??= {});
      const which = mm[2] === "product_id" ? "product" : (mm[2] as "qty" | "price");
      le[which] = msg;
      const suffix = which === "product" ? "p" : which === "qty" ? "q" : "c";
      e.list.push({ id: `${l.key}-${suffix}`, text: `Line ${i + 1} — ${lowerFirst(msg)}` });
      continue;
    }
    if (field === "lines") e.list.push({ id: "add-line", text: msg });
    else e.list.push({ id: "", text: msg });
  }
  for (const g of general) e.list.push({ id: "", text: g });
  // Keep the summary in line order.
  const order = (id: string) => {
    if (id === "f-reason") return -1;
    const k = id.replace(/-[pqc]$/, "");
    const i = m.lines.findIndex((l) => l.key === k);
    return i < 0 ? 1e6 : i * 3 + (id.endsWith("-p") ? 0 : id.endsWith("-q") ? 1 : 2);
  };
  e.list.sort((a, b) => order(a.id) - order(b.id));
  return e;
}

/** Group products by category for the line <select> (category creation order, "No category" last). */
export function groupProducts(products: ProductRef[]): { label: string; items: ProductRef[] }[] {
  const groups = new Map<string, { label: string; order: number; items: ProductRef[] }>();
  for (const p of products) {
    const key = p.category_id != null ? String(p.category_id) : "none";
    let g = groups.get(key);
    if (!g) {
      g = { label: p.category_name || "No category", order: p.category_id ?? Number.MAX_SAFE_INTEGER, items: [] };
      groups.set(key, g);
    }
    g.items.push(p);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({ label: g.label, items: [...g.items].sort((a, b) => a.id - b.id) }));
}

export function productLabel(p: ProductRef): string {
  return `${p.sku} — ${p.name}, ${p.unit}${p.archived ? " (archived)" : ""}`;
}
