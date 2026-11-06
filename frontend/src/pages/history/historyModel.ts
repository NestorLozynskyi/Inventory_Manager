/** History (movements) — types and pure helpers (periods, pagination, document links). */
import { fmtDate, toIsoDate } from "../../lib/format";

export interface MovementProduct {
  id: number;
  sku: string;
  name: string;
  unit: string;
  archived: boolean;
  category_id?: number | null;
  category_name?: string | null;
}

export interface Movement {
  id: number;
  at: string;
  type: "receipt" | "write_off" | "stock_count" | "reversal";
  document: { id: number; kind: string; number: string };
  product: MovementProduct;
  qty_change: number;
  balance_after: number;
  unit_cost: number;
  value_change: number;
}

export const PAGE_SIZE = 20;

export const TYPES = [
  { id: "receipt", label: "Receipt", icon: "arrow-down-to-line" },
  { id: "write_off", label: "Write-off", icon: "arrow-up-from-line" },
  { id: "stock_count", label: "Stock count adjustment", icon: "clipboard-check" },
  { id: "reversal", label: "Reversal", icon: "rotate-ccw" },
] as const;

export const PERIOD_IDS = ["today", "7d", "30d", "month", "last-month", "custom"] as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function shift(d: Date, days: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + days);
  return x;
}

export interface PeriodDef {
  id: string;
  label: string;
  from?: string;
  to?: string;
}

/** Period presets relative to `now` (local calendar dates, as the API interprets them in X-Timezone). */
export function periods(now: Date = new Date()): PeriodDef[] {
  const today = toIsoDate(now);
  const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastLast = shift(firstThis, -1);
  return [
    { id: "", label: "All time" },
    { id: "today", label: "Today", from: today, to: today },
    { id: "7d", label: "Last 7 days", from: toIsoDate(shift(now, -6)), to: today },
    { id: "30d", label: "Last 30 days", from: toIsoDate(shift(now, -30)), to: today },
    { id: "month", label: "This month", from: toIsoDate(firstThis), to: today },
    {
      id: "last-month",
      label: `${MONTHS[firstLast.getMonth()]} ${firstLast.getFullYear()}`,
      from: toIsoDate(firstLast),
      to: toIsoDate(lastLast),
    },
    { id: "custom", label: "Custom range…" },
  ];
}

export function periodDef(id: string, now?: Date): PeriodDef {
  const list = periods(now);
  return list.find((p) => p.id === id) ?? list[0];
}

/** from/to sent to the API for the chosen period. */
export function rangeOf(f: { period: string; from: string; to: string }, now?: Date): { from: string; to: string } {
  if (f.period === "custom") return { from: f.from, to: f.to };
  const p = periodDef(f.period, now);
  return { from: p.from ?? "", to: p.to ?? "" };
}

export function periodLabel(f: { period: string; from: string; to: string }, now?: Date): string {
  if (f.period !== "custom") return periodDef(f.period, now).label;
  if (f.from && f.to) return `${fmtDate(f.from)} – ${fmtDate(f.to)}`;
  if (f.from) return `From ${fmtDate(f.from)}`;
  if (f.to) return `Until ${fmtDate(f.to)}`;
  return "Custom range";
}

/** Link of a movement's document by kind. */
export function docHref(doc: { id: number; kind: string }): string {
  switch (doc.kind) {
    case "receipt":
      return `/receipts/${doc.id}`;
    case "write_off":
      return `/write-offs/${doc.id}`;
    case "receipt_reversal":
    case "write_off_reversal":
      return `/reversals/${doc.id}`;
    case "stock_count":
      return `/stock-counts/${doc.id}`;
    default:
      return "#";
  }
}

/** Page buttons: all pages when ≤ 7, otherwise 1 … around current … last ("…" = null). */
export function pageList(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => set.add(n));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => set.add(n));
  const nums = [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}
