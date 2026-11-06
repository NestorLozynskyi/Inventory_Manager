import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import ProductDetails from "./ProductDetails";
import { calls, clearToasts, product, renderAt, stubFetch, toastTitles } from "./testUtils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearToasts();
});

const mv = (i: number) => ({
  id: i, at: "2026-11-04T14:20:00Z", type: "write_off", document: { id: 47, kind: "write_off", number: `WO-0000${i}` },
  qty_change: -1, balance_after: 42.5, unit_cost: 3.15, value_change: -3.15,
});

function api(p: ReturnType<typeof product>, total = 2) {
  return (u: string, i: RequestInit) => {
    if (/\/api\/products\/12\/movements\?limit=20&offset=0/.test(u)) return { body: { items: Array.from({ length: Math.min(total, 20) }, (_, k) => mv(k + 1)), total } };
    if (/\/api\/products\/12\/movements\?limit=20&offset=20/.test(u)) return { body: { items: [mv(99)], total } };
    if (/\/api\/products\/12\/archive$/.test(u) && i.method === "POST") return { body: { ...p, archived: true } };
    if (/\/api\/products\/12\/restore$/.test(u) && i.method === "POST") return { body: { ...p, archived: false } };
    if (/\/api\/products\/12$/.test(u)) return { body: p };
    return undefined;
  };
}

describe("ProductDetails", () => {
  it("shows stock, value and the low-stock warning", async () => {
    stubFetch(api(product({ is_low_stock: true, stock: 18, min_stock: 20 })));
    renderAt("/products/12", "/products/:id", ProductDetails);
    await screen.findByText(/at or below the minimum/);
    expect(screen.getAllByText("Low stock").length).toBeGreaterThan(1);
    expect(screen.getByText(/at or below the minimum of 20 kg/)).toBeTruthy();
    expect(screen.getByText("$133.88")).toBeTruthy();
    await screen.findByText("WO-00001");
  });

  it("archive with stock warns before archiving, then shows the archived state", async () => {
    const f = stubFetch(api(product()));
    renderAt("/products/12", "/products/:id", ProductDetails);
    await screen.findByRole("heading", { level: 1, name: "Galvanized nails 50 mm" });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg.textContent).toContain("This product still has 42.5 kg in stock ($133.88)");
    expect(calls(f, "POST", /archive/)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Archive product" }));
    await screen.findByText("This product is archived. It isn’t offered in new documents.");
    expect(toastTitles()).toContain("Product archived");
    fireEvent.click(screen.getByRole("button", { name: "Restore product" }));
    await waitFor(() => expect(toastTitles()).toContain("Product restored"));
    await screen.findByRole("button", { name: "Archive" });
  });

  it("archive without stock has no stock warning", async () => {
    stubFetch(api(product({ stock: 0, stock_value: 0 })));
    renderAt("/products/12", "/products/:id", ProductDetails);
    await screen.findByRole("heading", { level: 1, name: "Galvanized nails 50 mm" });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg.textContent).not.toContain("still has");
  });

  it("loads more movements with Show more", async () => {
    const f = stubFetch(api(product(), 21));
    renderAt("/products/12", "/products/:id", ProductDetails);
    await screen.findByText("Showing 20 of 21 movements");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await screen.findByText("WO-000099");
    expect(screen.getByText("21 movements")).toBeTruthy();
    expect(calls(f, "GET", /offset=20/)).toHaveLength(1);
  });

  it("unknown product shows not found", async () => {
    stubFetch();
    renderAt("/products/12", "/products/:id", ProductDetails);
    await screen.findByText("This product doesn’t exist");
  });
});
