import { describe, expect, it } from "vitest";
import {
  RECEIPT,
  WRITE_OFF,
  docUrl,
  configForKind,
  groupProducts,
  issuesFromShortages,
  mkLine,
  periodRange,
  qtyError,
  requestBody,
  stockIssues,
  stockMessage,
  validateModel,
  validationFromFieldErrors,
  type EditModel,
  type ProductRef,
} from "./docs";

const P = (id: number, unit: string, stock: number, extra: Partial<ProductRef> = {}): ProductRef => ({
  id, sku: `S-${id}`, name: `P${id}`, unit, archived: false, stock, avg_cost: 2, purchase_price: 1.5, ...extra,
});
const products = new Map([[1, P(1, "pcs", 10)], [2, P(2, "kg", 4.5)]]);
const productOf = (id: number | null) => (id == null ? undefined : products.get(id));

describe("document helpers", () => {
  it("routes documents and reversals to the right URL / section", () => {
    expect(docUrl({ id: 5, kind: "receipt" })).toBe("/receipts/5");
    expect(docUrl({ id: 6, kind: "write_off" })).toBe("/write-offs/6");
    expect(docUrl({ id: 7, kind: "receipt_reversal" })).toBe("/reversals/7");
    expect(configForKind("write_off_reversal")).toBe(WRITE_OFF);
    expect(configForKind("receipt_reversal")).toBe(RECEIPT);
  });

  it("computes period presets from today", () => {
    const today = new Date(2026, 10, 5);
    expect(periodRange("last-30", "", "", today)).toEqual({ from: "2026-10-07", to: "2026-11-05" });
    expect(periodRange("this-month", "", "", today)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodRange("last-month", "", "", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("custom", "2026-01-01", "", today)).toEqual({ from: "2026-01-01", to: "" });
    expect(periodRange("all", "x", "y", today)).toEqual({ from: "", to: "" });
  });

  it("validates quantities per unit", () => {
    expect(qtyError("0", "pcs")).toBe("Enter a quantity greater than 0.");
    expect(qtyError("", "kg")).toBe("Enter a quantity greater than 0.");
    expect(qtyError("1.5", "pcs")).toMatch(/whole number/);
    expect(qtyError("1.2345", "kg")).toBe("Use at most 3 decimal places.");
    expect(qtyError("1,25", "kg")).toBeUndefined();
  });

  it("validates a receipt like the mockup (missing product, zero quantity)", () => {
    const m: EditModel = {
      supplier: "", reason: "", note: "",
      lines: [mkLine({ productId: 1, qty: "5", price: "1.50" }), mkLine({ qty: "24" }), mkLine({ productId: 2, qty: "0", price: "1" })],
    };
    const v = validateModel(m, RECEIPT, productOf);
    expect(v.list.map((x) => x.text)).toEqual(["Line 2 — choose a product.", "Line 3 — enter a quantity greater than 0."]);
    expect(v.lines[m.lines[1].key].product).toBe("Choose a product.");
    expect(v.list[0].id).toBe(`${m.lines[1].key}-p`);
  });

  it("requires a reason for write-offs", () => {
    const m: EditModel = { supplier: "", reason: "", note: "", lines: [mkLine({ productId: 1, qty: "1" })] };
    const v = validateModel(m, WRITE_OFF, productOf);
    expect(v.reason).toBe("Choose a reason.");
    expect(v.list[0]).toEqual({ id: "f-reason", text: "Reason — choose a reason." });
  });

  it("maps API field errors onto the lines", () => {
    const m: EditModel = { supplier: "", reason: "", note: "", lines: [mkLine(), mkLine(), mkLine()] };
    const v = validationFromFieldErrors(
      { "lines.2.qty": "Enter a whole number.", "lines.0.product_id": "This product is archived.", reason: "Choose a reason." },
      m,
    );
    expect(v.reason).toBe("Choose a reason.");
    expect(v.lines[m.lines[0].key].product).toBe("This product is archived.");
    expect(v.lines[m.lines[2].key].qty).toBe("Enter a whole number.");
    expect(v.list.map((x) => x.id)).toEqual(["f-reason", `${m.lines[0].key}-p`, `${m.lines[2].key}-q`]);
  });

  it("sums write-off quantities per product against stock", () => {
    const m: EditModel = {
      supplier: "", reason: "Sale", note: "",
      lines: [mkLine({ productId: 1, qty: "6" }), mkLine({ productId: 1, qty: "5" }), mkLine({ productId: 2, qty: "4" })],
    };
    const issues = stockIssues(m, productOf);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ productId: 1, requested: 11, available: 10 });
    expect(stockMessage(issues[0])).toBe("Only 10 pcs available. This product is on 2 lines.");
    const fromApi = issuesFromShortages(
      [{ product_id: 2, sku: "S-2", name: "P2", unit: "kg", required: 4, available: 0, line_index: 2 }],
      m,
    );
    expect(stockMessage(fromApi[0])).toBe("Out of stock — 0 kg available.");
  });

  it("builds request bodies", () => {
    const m: EditModel = { supplier: " ACME ", reason: "", note: "", lines: [mkLine({ productId: 1, qty: "1,5", price: "" })] };
    expect(requestBody(m, RECEIPT)).toEqual({ supplier: "ACME", note: "", lines: [{ product_id: 1, qty: 1.5, price: null }] });
    expect(requestBody(m, WRITE_OFF)).toEqual({ note: "", lines: [{ product_id: 1, qty: 1.5 }] });
  });

  it("groups products by category", () => {
    const g = groupProducts([
      P(3, "pcs", 1, { category_id: 9, category_name: "B" }),
      P(1, "pcs", 1, { category_id: null, category_name: null }),
      P(2, "pcs", 1, { category_id: 4, category_name: "A" }),
    ]);
    expect(g.map((x) => x.label)).toEqual(["A", "B", "No category"]);
  });
});
