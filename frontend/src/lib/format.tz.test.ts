// Force the process time zone (Node applies a runtime TZ change to subsequent Date calls).
process.env.TZ = "Europe/Kyiv";
import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, fmtTime } from "./format";

describe("UTC → local time zone (Europe/Kyiv)", () => {
  it("shifts timestamps to local time", () => {
    expect(fmtDateTime("2026-11-05T08:47:00Z")).toBe("Nov 5, 2026, 10:47");
    expect(fmtTime("2026-11-05T08:47:00Z")).toBe("10:47");
  });
  it("can move the calendar day", () => {
    expect(fmtDate("2026-11-05T22:30:00Z")).toBe("Nov 6, 2026");
    expect(fmtDateTime("2026-07-01T21:15:00Z")).toBe("Jul 2, 2026, 00:15"); // summer time (UTC+3)
  });
});
