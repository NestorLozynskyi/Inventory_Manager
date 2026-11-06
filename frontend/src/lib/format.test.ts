import { describe, expect, it } from "vitest";
import {
  WRITE_OFF_REASONS,
  UNITS,
  countLabel,
  fitsUnitPrecision,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtMoneyCompact,
  fmtNumber,
  fmtQty,
  fmtSignedMoney,
  fmtSignedQty,
  fmtTime,
  isFractionalUnit,
  parseDecimalInput,
  plural,
} from "./format";

// Expected values were produced by running the design system's app.js (IM.fmt*) on the same inputs.
const M = "−";

describe("number / quantity formatters (app.js parity)", () => {
  it.each([
    [[1234.5], "1,234.5"],
    [[0], "0"],
    [[-0.0001], "0"],
    [[-1234.5678], `${M}1,234.568`],
    [[1234567.891], "1,234,567.891"],
    [[2.5, 0], "3"],
    [["abc"], "—"],
    [[null], "0"],
    [[-0.4, 0], "0"],
  ] as const)("fmtNumber(%j) → %s", (args, out) => {
    expect(fmtNumber(...(args as unknown as [number, number?]))).toBe(out);
  });

  it.each([
    [120, "pcs", "120 pcs"],
    [12.5, "kg", "12.5 kg"],
    [0.75, "m²", "0.75 m²"],
    [46.875, "m²", "46.875 m²"],
    [1.23456, "kg", "1.235 kg"],
    [null, "kg", "—"],
    ["", "kg", "—"],
    [1000, undefined, "1,000"],
    [0.1 + 0.2, "l", "0.3 l"],
  ] as const)("fmtQty(%j, %j) → %s", (v, unit, out) => {
    expect(fmtQty(v, unit)).toBe(out);
  });

  it("fmtSignedQty uses + and the true minus sign", () => {
    expect(fmtSignedQty(12, "pcs")).toBe("+12 pcs");
    expect(fmtSignedQty(-4.5, "kg")).toBe(`${M}4.5 kg`);
    expect(fmtSignedQty(-4.5, "kg").charCodeAt(0)).toBe(0x2212);
    expect(fmtSignedQty(0, "pcs")).toBe("0 pcs");
    expect(fmtSignedQty(-0.0004, "kg")).toBe("0 kg");
    expect(fmtSignedQty(1234.5)).toBe("+1,234.5");
  });
});

describe("money formatters (app.js parity)", () => {
  it.each([
    [1234.5, "$1,234.50"],
    [-12, `${M}$12.00`],
    [0, "$0.00"],
    [1.005, "$1.00"],
    [2.675, "$2.68"],
    [0.125, "$0.13"],
    [-0.004, "$0.00"],
    [1e6, "$1,000,000.00"],
    ["x", "—"],
    [-1234567.891, `${M}$1,234,567.89`],
  ] as const)("fmtMoney(%j) → %s", (v, out) => {
    expect(fmtMoney(v)).toBe(out);
  });

  it("fmtSignedMoney", () => {
    expect(fmtSignedMoney(1234.5)).toBe("+$1,234.50");
    expect(fmtSignedMoney(-12)).toBe(`${M}$12.00`);
    expect(fmtSignedMoney(0)).toBe("$0.00");
    expect(fmtSignedMoney(-0.004)).toBe("$0.00");
  });

  it.each([
    [1234, "$1.2k"],
    [999, "$999"],
    [1250000, "$1.3M"],
    [-2500, `${M}$2.5k`],
    [0, "$0"],
    [1000, "$1k"],
    [999.6, "$1000"],
    [12345, "$12.3k"],
  ])("fmtMoneyCompact(%j) → %s", (v, out) => {
    expect(fmtMoneyCompact(v)).toBe(out);
  });
});

describe("date formatters", () => {
  it("formats date-only values as calendar dates (no time-zone shift)", () => {
    expect(fmtDate("2026-11-03")).toBe("Nov 3, 2026");
    expect(fmtDateTime("2026-11-03")).toBe("Nov 3, 2026");
    expect(fmtTime("2026-11-03")).toBe("");
    expect(fmtDate("")).toBe("—");
    expect(fmtDateTime(null)).toBe("—");
    expect(fmtDate("not a date")).toBe("—");
  });

  it("formats UTC timestamps in the browser's local time zone", () => {
    const iso = "2026-11-03T14:20:00Z";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const date = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect(fmtDate(iso)).toBe(date);
    expect(fmtTime(iso)).toBe(time);
    expect(fmtDateTime(iso)).toBe(`${date}, ${time}`);
  });

  it("matches app.js output for a local timestamp", () => {
    expect(fmtDateTime("2026-11-03T14:20:00")).toBe("Nov 3, 2026, 14:20");
    expect(fmtTime("2026-11-03T09:05:00")).toBe("09:05");
  });
});

describe("units, reasons, parsing, plurals", () => {
  it("knows fractional and whole units", () => {
    expect(UNITS).toEqual(["pcs", "pack", "kg", "g", "l", "m", "m²"]);
    for (const u of ["kg", "g", "l", "m", "m²"]) expect(isFractionalUnit(u)).toBe(true);
    for (const u of ["pcs", "pack", "", null, undefined]) expect(isFractionalUnit(u)).toBe(false);
    expect(fitsUnitPrecision(46.875, "m²")).toBe(true);
    expect(fitsUnitPrecision(1.2345, "kg")).toBe(false);
    expect(fitsUnitPrecision(2, "pcs")).toBe(true);
    expect(fitsUnitPrecision(2.5, "pack")).toBe(false);
  });

  it("lists write-off reasons in order", () => {
    expect(WRITE_OFF_REASONS).toEqual(["Sale", "Damaged", "Expired", "Lost / Theft", "Internal use", "Other"]);
  });

  it.each([
    ["", null],
    ["   ", null],
    ["12", 12],
    [" 12.5 ", 12.5],
    ["12,5", 12.5],
    ["0,125", 0.125],
    ["1,234", 1234],
    ["1,234.5", 1234.5],
    ["1,234,567", 1234567],
    ["1 234,5", 1234.5],
    [".5", 0.5],
    ["5.", 5],
    [`${M}4`, -4],
    ["-4.5", -4.5],
    ["abc", NaN],
    ["1.2.3", NaN],
    ["1,2,3", NaN],
    ["12kg", NaN],
  ])("parseDecimalInput(%j) → %s", (input, out) => {
    const v = parseDecimalInput(input);
    if (Number.isNaN(out as number)) expect(v).toBeNaN();
    else expect(v).toBe(out);
  });

  it("pluralises", () => {
    expect(plural(1, "product")).toBe("product");
    expect(plural(0, "product")).toBe("products");
    expect(plural(2, "category", "categories")).toBe("categories");
    expect(countLabel(1234, "line")).toBe("1,234 lines");
    expect(countLabel(1, "line")).toBe("1 line");
  });
});
