import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { StockQty } from "./StockQty";

describe("StockQty", () => {
  it("renders a plain quantity when stock is fine", () => {
    const { container } = render(() => <StockQty qty={38} unit="pcs" />);
    const el = container.querySelector(".stock-qty")!;
    expect(el).toHaveTextContent("38 pcs");
    expect(el).not.toHaveClass("is-low");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("marks low stock inline with an icon, colour class and accessible name", () => {
    const { container } = render(() => <StockQty qty={27} unit="pcs" low />);
    const el = container.querySelector(".stock-qty")!;
    expect(el).toHaveClass("is-low");
    expect(el).not.toHaveClass("is-out");
    expect(el).toHaveAttribute("title", "Low stock");
    expect(el.querySelector("svg.icon-alert-triangle")).not.toBeNull();
    expect(el).toHaveTextContent("Low stock: 27 pcs");
    expect(screen.getByText("Low stock:", { exact: false })).toHaveClass("visually-hidden");
    expect(container.querySelector(".badge")).toBeNull(); // no separate badge above/below the value
  });

  it("uses the out-of-stock wording and danger colour at zero", () => {
    const { container } = render(() => <StockQty qty={0} unit="pcs" low />);
    const el = container.querySelector(".stock-qty")!;
    expect(el).toHaveClass("is-out");
    expect(el).toHaveAttribute("title", "Out of stock");
    expect(el).toHaveTextContent("Out of stock: 0 pcs");
  });
});
