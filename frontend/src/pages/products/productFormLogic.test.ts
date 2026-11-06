import { describe, expect, it } from "vitest";
import { EMPTY_VALUES, mapServerErrors, summaryTitle, toPayload, validateAll, validateField } from "./productFormLogic";

const ok = { ...EMPTY_VALUES, sku: " FST-1 ", name: "Nails", unit: "kg", purchase: "3.40", sale: "5,80", min: "12.5" };

describe("productFormLogic", () => {
  it("valid values produce no errors and a trimmed payload", () => {
    expect(validateAll(ok)).toEqual({});
    expect(toPayload(ok)).toEqual({
      sku: "FST-1", name: "Nails", category_id: null, unit: "kg",
      purchase_price: 3.4, sale_price: 5.8, min_stock: 12.5, description: "",
    });
  });

  it("required fields and price rules", () => {
    const e = validateAll({ ...EMPTY_VALUES, purchase: "-1", sale: "1.234" });
    expect(Object.keys(e)).toEqual(["sku", "name", "unit", "purchase", "sale"]);
    expect(e.purchase?.msg).toBe("Purchase price can’t be negative.");
    expect(e.sale?.msg).toBe("Use at most 2 decimal places.");
    expect(validateField("purchase", { ...ok, purchase: "12,5O" })?.msg).toMatch(/valid amount/);
  });

  it("minimum stock respects unit precision", () => {
    expect(validateField("min", { ...ok, unit: "pcs", min: "2.5" })?.msg).toBe("Enter a whole number — pcs can’t be fractional.");
    expect(validateField("min", { ...ok, unit: "pack", min: "3" })).toBeNull();
    expect(validateField("min", { ...ok, unit: "kg", min: "1.2345" })?.msg).toBe("Use at most 3 decimal places.");
    expect(validateField("min", { ...ok, min: "" })).toBeNull();
    expect(toPayload({ ...ok, min: "" }).min_stock).toBeNull();
  });

  it("maps server field errors to form fields", () => {
    const r = mapServerErrors({ sku: "SKU taken", min_stock: "Bad", "other": "General" });
    expect(r.fields.sku?.msg).toBe("SKU taken");
    expect(r.fields.min?.msg).toBe("Bad");
    expect(r.general).toEqual(["General"]);
    expect(summaryTitle(1)).toBe("Fix 1 problem to save the product");
    expect(summaryTitle(3)).toBe("Fix 3 problems to save the product");
  });
});
