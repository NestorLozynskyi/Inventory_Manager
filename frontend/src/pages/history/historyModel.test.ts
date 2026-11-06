import { describe, expect, it } from "vitest";
import { docHref, pageList, periodLabel, periods, rangeOf } from "./historyModel";

describe("history model", () => {
  const now = new Date(2026, 10, 5, 12, 0); // Nov 5, 2026 local
  it("period presets", () => {
    const p = Object.fromEntries(periods(now).map((x) => [x.id, x]));
    expect(p["today"]).toMatchObject({ from: "2026-11-05", to: "2026-11-05" });
    expect(p["7d"]).toMatchObject({ from: "2026-10-30", to: "2026-11-05" });
    expect(p["30d"]).toMatchObject({ from: "2026-10-06", to: "2026-11-05" });
    expect(p["month"]).toMatchObject({ from: "2026-11-01" });
    expect(p["last-month"]).toMatchObject({ label: "October 2026", from: "2026-10-01", to: "2026-10-31" });
    expect(rangeOf({ period: "custom", from: "2026-10-02", to: "" }, now)).toEqual({ from: "2026-10-02", to: "" });
    expect(rangeOf({ period: "", from: "x", to: "y" }, now)).toEqual({ from: "", to: "" });
    expect(periodLabel({ period: "custom", from: "2026-10-01", to: "2026-11-05" }, now)).toBe("Oct 1, 2026 – Nov 5, 2026");
  });
  it("document links by kind", () => {
    expect(docHref({ id: 1, kind: "receipt" })).toBe("/receipts/1");
    expect(docHref({ id: 2, kind: "write_off" })).toBe("/write-offs/2");
    expect(docHref({ id: 3, kind: "receipt_reversal" })).toBe("/reversals/3");
    expect(docHref({ id: 4, kind: "write_off_reversal" })).toBe("/reversals/4");
    expect(docHref({ id: 5, kind: "stock_count" })).toBe("/stock-counts/5");
  });
  it("page list compacts with ellipses", () => {
    expect(pageList(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageList(1, 20)).toEqual([1, 2, 3, 4, null, 20]);
    expect(pageList(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageList(20, 20)).toEqual([1, null, 17, 18, 19, 20]);
  });
});
