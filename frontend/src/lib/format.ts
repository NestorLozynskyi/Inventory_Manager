/**
 * Display formatters — ported 1:1 from the design system (assets/js/app.js, IM.fmt*).
 * en-US grouping, true minus sign (U+2212), "—" for missing values.
 *
 * Dates: the API returns timestamps as ISO-8601 UTC ("2026-11-05T08:47:00Z"); they are shown
 * in the browser's local time zone. Date-only strings ("2026-11-05") are calendar dates and are
 * formatted as-is (never shifted by the time zone).
 */

export const MINUS = "−";
export const DASH = "—";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Num = number | string | null | undefined;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** "1,234.5" (max 3 fraction digits by default). */
export function fmtNumber(v: Num, maxFrac = 3): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return DASH;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: maxFrac });
  return (n < 0 && s.replace(/[0.,]/g, "") !== "" ? MINUS : "") + s;
}

/** "120 pcs", "12.5 kg", "0.75 m²" (integers without decimals, ≤ 3 decimals, trimmed). */
export function fmtQty(v: Num, unit?: string | null): string {
  if (v == null || v === "") return DASH;
  const s = fmtNumber(round3(Number(v)), 3);
  return unit ? `${s} ${unit}` : s;
}

/** "+12 pcs", "−4.5 kg", "0 pcs". */
export function fmtSignedQty(v: Num, unit?: string | null): string {
  const n = round3(Number(v));
  const s = fmtQty(Math.abs(n), unit);
  return (n > 0 ? "+" : n < 0 ? MINUS : "") + s;
}

/** "$1,234.50", "−$12.00". */
export function fmtMoney(v: Num): string {
  let n = Number(v);
  if (!Number.isFinite(n)) return DASH;
  n = Math.round(n * 100) / 100;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? MINUS : "") + "$" + s;
}

/** "+$1,234.50" / "−$12.00" / "$0.00". */
export function fmtSignedMoney(v: Num): string {
  const n = Math.round(Number(v) * 100) / 100;
  return (n > 0 ? "+" : n < 0 ? MINUS : "") + fmtMoney(Math.abs(n));
}

function trimZero(s: string): string {
  return s.replace(/\.0$/, "");
}

/** "$1.2k", "$3.4M", "$999" — chart axes. */
export function fmtMoneyCompact(v: Num): string {
  const n = Number(v);
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : "";
  if (a >= 1e6) return `${sign}$${trimZero((a / 1e6).toFixed(1))}M`;
  if (a >= 1e3) return `${sign}$${trimZero((a / 1e3).toFixed(1))}k`;
  return `${sign}$${Math.round(a)}`;
}

interface DateParts {
  y: number;
  mo: number;
  d: number;
  h: string | null;
  mi: string | null;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Split an ISO date / datetime into local calendar parts. */
function parts(iso: string | Date | null | undefined): DateParts | null {
  if (iso == null || iso === "") return null;
  if (typeof iso === "string") {
    const m = DATE_ONLY.exec(iso.trim());
    if (m) return { y: +m[1], mo: +m[2], d: +m[3], h: null, mi: null };
  }
  const dt = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return {
    y: dt.getFullYear(),
    mo: dt.getMonth() + 1,
    d: dt.getDate(),
    h: pad2(dt.getHours()),
    mi: pad2(dt.getMinutes()),
  };
}

/** "Nov 3, 2026". */
export function fmtDate(iso: string | Date | null | undefined): string {
  const p = parts(iso);
  return p ? `${MONTHS[p.mo - 1]} ${p.d}, ${p.y}` : DASH;
}

/** "14:20" (24 h, local time); "" for date-only values. */
export function fmtTime(iso: string | Date | null | undefined): string {
  const p = parts(iso);
  return p && p.h ? `${p.h}:${p.mi}` : "";
}

/** "Nov 3, 2026, 14:20". */
export function fmtDateTime(iso: string | Date | null | undefined): string {
  const p = parts(iso);
  if (!p) return DASH;
  return `${MONTHS[p.mo - 1]} ${p.d}, ${p.y}` + (p.h ? `, ${p.h}:${p.mi}` : "");
}

/** Local calendar date as "YYYY-MM-DD" (for date inputs / API date params). */
export function toIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/* ------------------------------------------------------------------ units -- */

export const UNITS = ["pcs", "pack", "kg", "g", "l", "m", "m²"] as const;
export type Unit = (typeof UNITS)[number];

const FRACTIONAL = new Set<string>(["kg", "g", "l", "m", "m²"]);

/** kg, g, l, m, m² accept up to 3 decimals; pcs and pack are whole quantities only. */
export function isFractionalUnit(unit: string | null | undefined): boolean {
  return unit != null && FRACTIONAL.has(unit);
}

/** Maximum number of decimals allowed for a quantity in this unit (3 or 0). */
export function maxDecimals(unit: string | null | undefined): number {
  return isFractionalUnit(unit) ? 3 : 0;
}

/** Number of decimals in a number as typed (e.g. 1.250 → 2 after normalisation). */
export function decimalsOf(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const s = String(v);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** True if `v` respects the unit's precision (whole for pcs/pack, ≤ 3 decimals otherwise). */
export function fitsUnitPrecision(v: number, unit: string | null | undefined): boolean {
  return decimalsOf(v) <= maxDecimals(unit);
}

export const WRITE_OFF_REASONS = ["Sale", "Damaged", "Expired", "Lost / Theft", "Internal use", "Other"] as const;
export type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];

/**
 * Parse a user-typed decimal ("1,234.5", "12,5", " 3 ", "−4", ".5").
 * Returns `null` for an empty input and `NaN` for anything that is not a number.
 *  - spaces (incl. NBSP / thin space) are ignored;
 *  - when both "," and "." are present, "," is a thousands separator;
 *  - "1,234" (1–3 digits, comma, exactly 3 digits) is en-US grouping → 1234;
 *  - any other single "," is the decimal separator ("12,5" → 12.5, "0,125" → 0.125);
 *  - the true minus sign U+2212 is accepted.
 */
export function parseDecimalInput(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  let s = raw.replace(/[\s   ]/g, "").replace(/−/g, "-");
  if (s === "") return null;
  if (s.includes(".") && s.includes(",")) s = s.replace(/,/g, "");
  else if (/^-?[1-9]\d{0,2},\d{3}$/.test(s)) s = s.replace(",", ""); // "1,234" (en-US grouping)
  else if ((s.match(/,/g) ?? []).length === 1) s = s.replace(",", ".");
  else if (s.includes(",")) {
    // "1,234,567" — thousands only
    if (!/^-?\d{1,3}(,\d{3})+$/.test(s)) return NaN;
    s = s.replace(/,/g, "");
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

/* ---------------------------------------------------------------- plurals -- */

/** Word only: plural(1, "product") → "product"; plural(3, "product") → "products". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return Math.abs(n) === 1 ? one : many;
}

/** Number + word: countLabel(1234, "product") → "1,234 products". */
export function countLabel(n: number, one: string, many?: string): string {
  return `${fmtNumber(n)} ${plural(n, one, many)}`;
}
