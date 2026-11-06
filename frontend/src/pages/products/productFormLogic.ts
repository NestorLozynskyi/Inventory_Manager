/** Product form: client-side validation (mirrors the server rules) and API mapping. */
import { decimalsOf, isFractionalUnit, parseDecimalInput } from "../../lib/format";
import type { Product } from "./types";

export type FieldKey = "sku" | "name" | "category" | "unit" | "purchase" | "sale" | "min" | "desc";

export interface FormValues {
  sku: string;
  name: string;
  category: string; // "" = no category, else category id
  unit: string;
  purchase: string;
  sale: string;
  min: string;
  desc: string;
}

export interface FieldError {
  msg: string;
  /** Optional link shown after the message (duplicate SKU → the other product). */
  link?: { href: string; label: string };
  /** Shorter text for the error summary. */
  summary?: string;
}

export const FIELD_ORDER: FieldKey[] = ["sku", "name", "category", "unit", "purchase", "sale", "min", "desc"];

export const FIELD_META: Record<FieldKey, { input: string; label: string }> = {
  sku: { input: "f-sku", label: "SKU" },
  name: { input: "f-name", label: "Name" },
  category: { input: "f-category", label: "Category" },
  unit: { input: "f-unit", label: "Unit of measure" },
  purchase: { input: "f-purchase", label: "Purchase price" },
  sale: { input: "f-sale", label: "Sale price" },
  min: { input: "f-min", label: "Minimum stock" },
  desc: { input: "f-desc", label: "Description" },
};

/** API field name → form field. */
export const SERVER_FIELDS: Record<string, FieldKey> = {
  sku: "sku",
  name: "name",
  category_id: "category",
  unit: "unit",
  purchase_price: "purchase",
  sale_price: "sale",
  min_stock: "min",
  description: "desc",
};

export const LIMITS = { sku: 40, name: 120, desc: 1000 };

export const EMPTY_VALUES: FormValues = {
  sku: "",
  name: "",
  category: "",
  unit: "",
  purchase: "",
  sale: "",
  min: "",
  desc: "",
};

function money(n: number | null | undefined): string {
  return n == null ? "" : Number(n).toFixed(2);
}

export function valuesFromProduct(p: Product): FormValues {
  return {
    sku: p.sku,
    name: p.name,
    category: p.category_id == null ? "" : String(p.category_id),
    unit: p.unit,
    purchase: money(p.purchase_price),
    sale: money(p.sale_price),
    min: p.min_stock == null ? "" : String(p.min_stock),
    desc: p.description ?? "",
  };
}

function checkPrice(v: string, what: string): string | null {
  const s = v.trim();
  if (!s) return `Enter a ${what}.`;
  const n = parseDecimalInput(s);
  if (n == null || Number.isNaN(n)) return "Enter a valid amount, for example 12.50.";
  if (n < 0) return `${what.charAt(0).toUpperCase()}${what.slice(1)} can’t be negative.`;
  if (decimalsOf(n) > 2) return "Use at most 2 decimal places.";
  if (n >= 1e10) return "The amount is too large.";
  return null;
}

/** Client-side error of one field (null = valid). */
export function validateField(key: FieldKey, v: FormValues): FieldError | null {
  switch (key) {
    case "sku": {
      const s = v.sku.trim();
      if (!s) return { msg: "Enter a SKU." };
      if (s.length > LIMITS.sku) return { msg: `Use at most ${LIMITS.sku} characters.` };
      return null;
    }
    case "name": {
      const s = v.name.trim();
      if (!s) return { msg: "Enter a product name." };
      if (s.length > LIMITS.name) return { msg: `Use at most ${LIMITS.name} characters.` };
      return null;
    }
    case "unit":
      return v.unit ? null : { msg: "Select a unit of measure." };
    case "purchase": {
      const e = checkPrice(v.purchase, "purchase price");
      return e ? { msg: e } : null;
    }
    case "sale": {
      const e = checkPrice(v.sale, "sale price");
      return e ? { msg: e } : null;
    }
    case "min": {
      if (!v.min.trim()) return null;
      const n = parseDecimalInput(v.min);
      if (n == null || Number.isNaN(n)) return { msg: "Enter a number, for example 20 or 12.5, or leave empty." };
      if (n < 0) return { msg: "Minimum stock can’t be negative." };
      if (v.unit && !isFractionalUnit(v.unit) && !Number.isInteger(n))
        return { msg: `Enter a whole number — ${v.unit} can’t be fractional.` };
      if (isFractionalUnit(v.unit) && decimalsOf(n) > 3) return { msg: "Use at most 3 decimal places." };
      return null;
    }
    case "desc":
      return v.desc.length > LIMITS.desc ? { msg: `Use at most ${LIMITS.desc} characters.` } : null;
    default:
      return null;
  }
}

export function validateAll(v: FormValues): Partial<Record<FieldKey, FieldError>> {
  const out: Partial<Record<FieldKey, FieldError>> = {};
  for (const k of FIELD_ORDER) {
    const e = validateField(k, v);
    if (e) out[k] = e;
  }
  return out;
}

/** Request body for POST/PUT /api/products. Assumes the values passed validation. */
export function toPayload(v: FormValues) {
  const min = parseDecimalInput(v.min);
  return {
    sku: v.sku.trim(),
    name: v.name.trim(),
    category_id: v.category ? Number(v.category) : null,
    unit: v.unit,
    purchase_price: parseDecimalInput(v.purchase),
    sale_price: parseDecimalInput(v.sale),
    min_stock: min == null || Number.isNaN(min) ? null : min,
    description: v.desc.trim(),
  };
}

/** Map API field errors ({"min_stock": "…"}) to form fields; unknown fields are returned as general messages. */
export function mapServerErrors(fieldErrors: Record<string, string>): {
  fields: Partial<Record<FieldKey, FieldError>>;
  general: string[];
} {
  const fields: Partial<Record<FieldKey, FieldError>> = {};
  const general: string[] = [];
  for (const [f, msg] of Object.entries(fieldErrors)) {
    const key = SERVER_FIELDS[f];
    if (key && !fields[key]) fields[key] = { msg };
    else if (!key) general.push(msg);
  }
  return { fields, general };
}

export function summaryTitle(n: number): string {
  return n === 1 ? "Fix 1 problem to save the product" : `Fix ${n} problems to save the product`;
}
