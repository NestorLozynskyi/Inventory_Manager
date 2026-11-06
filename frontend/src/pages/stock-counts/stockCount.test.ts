import { describe, expect, it } from "vitest";
import { calcLine, parseActualQty, totalsOf } from "./stockCount";

describe("parseActualQty", () => {
  it("empty means not counted", () => expect(parseActualQty("  ", "pcs")).toEqual({ value: null }));
  it("rejects negatives", () => expect(parseActualQty("-1", "kg").error).toBe("Quantity can’t be negative."));
  it("rejects non-numbers with a unit-specific example", () => {
    expect(parseActualQty("abc", "pcs").error).toBe("Enter a number, e.g. 12.");
    expect(parseActualQty("abc", "kg").error).toBe("Enter a number, e.g. 12.5.");
  });
  it("whole units", () => {
    expect(parseActualQty("2.5", "pack").error).toBe("Use a whole number for pack.");
    expect(parseActualQty("12", "pcs")).toEqual({ value: 12 });
  });
  it("fractional units up to 3 dp, comma decimal accepted", () => {
    expect(parseActualQty("1,25", "kg")).toEqual({ value: 1.25 });
    expect(parseActualQty("0.125", "m²")).toEqual({ value: 0.125 });
    expect(parseActualQty("0.1255", "l").error).toBe("Use up to 3 decimal places.");
  });
});

describe("totals", () => {
  it("counts surplus, shortage, unchanged, not counted and invalid", () => {
    const items = [
      { calc: calcLine(10, 2, 12), invalid: false }, // +2 → +4.00
      { calc: calcLine(10, 1.5, 7), invalid: false }, // −3 → −4.50
      { calc: calcLine(5, 1, 5), invalid: false },
      { calc: calcLine(5, 1, null), invalid: false },
      { calc: calcLine(5, 1, 3, true), invalid: true },
    ];
    expect(totalsOf(items)).toEqual({
      total: 5, counted: 3, notCounted: 2, unchanged: 1, surplusN: 1, surplusV: 4,
      shortageN: 1, shortageV: -4.5, net: -0.5, invalid: 1,
    });
  });
});
