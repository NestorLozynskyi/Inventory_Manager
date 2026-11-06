import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { BarChart, HBarChart, niceScale } from "./Charts";

describe("niceScale", () => {
  it("rounds to 1/2/2.5/5/10 steps", () => {
    expect(niceScale(0, 4)).toEqual({ top: 1, step: 0.25 });
    expect(niceScale(1234, 4)).toEqual({ top: 1500, step: 500 });
    expect(niceScale(100, 4)).toEqual({ top: 100, step: 25 });
    expect(niceScale(7.3, 4)).toEqual({ top: 8, step: 2 });
  });
});

describe("BarChart", () => {
  it("renders grouped bars, axis, labels and legend like app.js", () => {
    const { container } = render(() => (
      <BarChart
        title="Receipts vs write-offs"
        categories={["Oct 5", "Oct 12"]}
        valueFormat="money"
        width={600}
        series={[
          { name: "Receipts", values: [1200, 300] },
          { name: "Write-offs", values: [100, 0] },
        ]}
      />
    ));
    const root = container.firstElementChild!;
    expect(root).toHaveClass("chart");
    const svg = root.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 600 260");
    expect(svg.getAttribute("aria-label")).toBe(
      "Receipts vs write-offs. Receipts: Oct 5 $1,200.00, Oct 12 $300.00. Write-offs: Oct 5 $100.00, Oct 12 $0.00.",
    );
    // niceScale(1200, 4) → top 1500, step 500 → 4 ticks; the first one is the axis line
    const lines = svg.querySelectorAll("line");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toHaveClass("chart-axis-line");
    expect(lines[1]).toHaveClass("chart-grid-line");
    const axis = Array.from(svg.querySelectorAll('text[text-anchor="end"]')).map((t) => t.textContent);
    expect(axis).toEqual(["$0", "$500", "$1k", "$1.5k"]);
    const rects = svg.querySelectorAll("rect");
    expect(rects).toHaveLength(4);
    expect(rects[0].style.fill).toBe("var(--chart-1)");
    expect(rects[1].style.fill).toBe("var(--chart-2)");
    expect(rects[0].getAttribute("height")).toBe("176.0"); // 1200 / 1500 × 220 px plot height
    expect(rects[3].getAttribute("height")).toBe("0.0");
    expect(rects[0].querySelector("title")).toHaveTextContent("Oct 5 · Receipts: $1,200.00");
    const legend = root.querySelectorAll(".chart-legend .chart-legend-item");
    expect(Array.from(legend).map((l) => l.textContent)).toEqual(["Receipts $1,500.00", "Write-offs $100.00"]);
  });
});

describe("HBarChart", () => {
  it("renders rows with relative widths", () => {
    const { container } = render(() => (
      <HBarChart
        title="By reason"
        valueFormat="money"
        items={[
          { label: "Damaged", value: 200 },
          { label: "Expired", value: 1 },
          { label: "Other", value: 0, color: "var(--chart-3)" },
        ]}
      />
    ));
    const hb = container.querySelector(".chart > .hbars")!;
    expect(hb).toHaveAttribute("role", "img");
    expect(hb).toHaveAttribute("aria-label", "By reason. Damaged $200.00, Expired $1.00, Other $0.00.");
    const bars = Array.from(hb.querySelectorAll<HTMLElement>(".hbars-bar")).map((b) => [b.style.width, b.style.background]);
    expect(bars).toEqual([
      ["100%", ""],
      ["1%", ""],
      ["0%", "var(--chart-3)"],
    ]);
    expect(hb.querySelector(".hbars-row")).toHaveAttribute("title", "Damaged: $200.00");
  });
});
