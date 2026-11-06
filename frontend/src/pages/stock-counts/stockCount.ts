/** Stock count types (docs/api.md § Stock counts) and pure helpers shared by the stock count pages. */
import { decimalsOf, isFractionalUnit, parseDecimalInput } from "../../lib/format";

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

export interface StockCountSummary {
  id: number;
  kind: "stock_count";
  number: string;
  status: "draft" | "posted";
  created_at: string;
  posted_at: string | null;
  date?: string;
  note: string;
  line_count: number;
  scope: "all" | "category";
  scope_label?: string;
  category: { id: number; name: string } | null;
  counted: number;
  surplus_count: number;
  shortage_count: number;
  surplus_value: number;
  shortage_value: number;
  net_value: number;
}

export interface StockCountLine {
  id: number;
  product: ProductRef;
  book_qty: number;
  actual_qty: number | null;
  difference: number | null;
  unit_cost: number;
  value: number | null;
}

export interface StockCount extends StockCountSummary {
  lines: StockCountLine[];
}

export function scopeLabel(sc: Pick<StockCountSummary, "scope" | "scope_label" | "category">): string {
  if (sc.scope_label) return sc.scope_label;
  return sc.scope === "category" && sc.category ? `Category: ${sc.category.name}` : "All active products";
}

/** Date shown for a document: posted → posted_at, draft → created_at. */
export function docDate(sc: Pick<StockCountSummary, "status" | "posted_at" | "created_at">): string {
  return sc.status !== "draft" && sc.posted_at ? sc.posted_at : sc.created_at;
}

export const r2 = (n: number): number => Math.round(n * 100) / 100;
export const r3 = (n: number): number => Math.round(n * 1000) / 1000;

export function signCls(v: number): string {
  return v > 0 ? "text-success" : v < 0 ? "text-danger" : "muted";
}

/** "1 item" / "3 items". */
export function pl(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export type ParsedQty = { value: number | null; error?: undefined } | { value?: undefined; error: string };

/** Validate an "Actual qty" input against the unit's precision (same messages as the mockup). */
export function parseActualQty(raw: string, unit: string): ParsedQty {
  const s = raw.trim();
  if (s === "") return { value: null };
  if (/^[-−]/.test(s)) return { error: "Quantity can’t be negative." };
  const v = parseDecimalInput(s);
  const whole = !isFractionalUnit(unit);
  if (v == null || Number.isNaN(v)) return { error: `Enter a number, e.g. ${whole ? "12" : "12.5"}.` };
  if (v < 0) return { error: "Quantity can’t be negative." };
  if (whole && v % 1 !== 0) return { error: `Use a whole number for ${unit}.` };
  if (decimalsOf(v) > 3) return { error: "Use up to 3 decimal places." };
  return { value: v };
}

/** Raw input text for a stored quantity. */
export function rawOf(v: number | null | undefined): string {
  return v == null ? "" : String(r3(v));
}

export interface LineCalc {
  counted: boolean;
  diff: number;
  val: number;
}

/** Difference vs book qty and its value at the line's unit cost (draft: live values). */
export function calcLine(book: number, unitCost: number, actual: number | null, invalid = false): LineCalc {
  if (invalid || actual == null) return { counted: false, diff: 0, val: 0 };
  const diff = r3(actual - book);
  return { counted: true, diff, val: r2(diff * unitCost) };
}

export interface CountTotals {
  total: number;
  counted: number;
  notCounted: number;
  unchanged: number;
  surplusN: number;
  surplusV: number;
  shortageN: number;
  shortageV: number;
  net: number;
  invalid: number;
}

export function totalsOf(items: { calc: LineCalc; invalid: boolean }[]): CountTotals {
  const t: CountTotals = {
    total: items.length,
    counted: 0,
    notCounted: 0,
    unchanged: 0,
    surplusN: 0,
    surplusV: 0,
    shortageN: 0,
    shortageV: 0,
    net: 0,
    invalid: 0,
  };
  for (const it of items) {
    if (it.invalid) t.invalid++;
    const c = it.calc;
    if (!c.counted) {
      t.notCounted++;
      continue;
    }
    t.counted++;
    if (c.diff > 0) {
      t.surplusN++;
      t.surplusV += c.val;
    } else if (c.diff < 0) {
      t.shortageN++;
      t.shortageV += c.val;
    } else t.unchanged++;
  }
  t.surplusV = r2(t.surplusV);
  t.shortageV = r2(t.shortageV);
  t.net = r2(t.surplusV + t.shortageV);
  return t;
}
