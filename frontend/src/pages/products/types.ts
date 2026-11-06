/** API shapes and small helpers shared by the product / category pages (docs/api.md). */

export interface Product {
  id: number;
  sku: string;
  name: string;
  category_id: number | null;
  category_name: string | null;
  unit: string;
  description: string;
  purchase_price: number;
  sale_price: number;
  min_stock: number | null;
  stock: number;
  avg_cost: number;
  stock_value: number;
  is_low_stock: boolean;
  archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  has_movements: boolean;
  last_receipt_at: string | null;
}

export interface ProductCounts {
  active: number;
  archived: number;
  all: number;
  low_stock: number;
}

export interface ProductListResponse {
  items: Product[];
  counts: ProductCounts;
}

export interface Category {
  id: number;
  name: string;
  product_count: number;
  active_product_count: number;
}

export interface Movement {
  id: number;
  at: string;
  type: "receipt" | "write_off" | "stock_count" | "reversal" | string;
  document: { id: number; kind: string; number: string };
  qty_change: number;
  balance_after: number;
  unit_cost: number | null;
  value_change: number;
}

export interface MovementPage {
  items: Movement[];
  total: number;
}

/** Low-stock mark as shown in the UI: archived products never show it. */
export function isLow(p: Pick<Product, "archived" | "is_low_stock">): boolean {
  return !p.archived && p.is_low_stock;
}

export function categoryLabel(p: Pick<Product, "category_name">): string {
  return p.category_name ?? "No category";
}

const MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Receipt",
  write_off: "Write-off",
  stock_count: "Stock count adjustment",
  reversal: "Reversal",
};

export function movementTypeLabel(type: string): string {
  return MOVEMENT_LABELS[type] ?? type;
}

/** App URL of a document by its kind. */
export function docHref(kind: string, id: number): string {
  switch (kind) {
    case "receipt":
      return `/receipts/${id}`;
    case "write_off":
      return `/write-offs/${id}`;
    case "receipt_reversal":
    case "write_off_reversal":
      return `/reversals/${id}`;
    case "stock_count":
      return `/stock-counts/${id}`;
    default:
      return "/history";
  }
}
