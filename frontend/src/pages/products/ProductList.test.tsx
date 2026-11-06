import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import ProductList, { DEFAULT_FILTERS, apiParams, visibleItems } from "./ProductList";
import { calls, clearToasts, product, renderAt, stubFetch, toastTitles } from "./testUtils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearToasts();
});

const counts = { active: 2, archived: 1, all: 3, low_stock: 1 };
const items = [product(), product({ id: 13, sku: "ELC-0411", name: "Double socket outlet", unit: "pcs", stock: 27, min_stock: 30, is_low_stock: true, purchase_price: 3.7 })];
const cats = (u: string) => (/\/api\/categories$/.test(u) ? { body: [] } : undefined);

describe("ProductList helpers", () => {
  it("maps filters to API params (defaults omitted)", () => {
    expect(apiParams(DEFAULT_FILTERS)).toEqual({ search: "", category_id: "", status: "", low_stock: "", sort: "", order: "" });
    expect(apiParams({ ...DEFAULT_FILTERS, search: " nail ", category_id: "none", status: "all", low_stock: true, sort: "stock", order: "desc" }))
      .toEqual({ search: "nail", category_id: "none", status: "all", low_stock: true, sort: "stock", order: "desc" });
    // client-only sort keys are not sent
    expect(apiParams({ ...DEFAULT_FILTERS, sort: "purchase_price", order: "desc" }).sort).toBe("");
  });
  it("sorts client-only columns and hides archived rows in low-stock mode", () => {
    const list = visibleItems(items, { ...DEFAULT_FILTERS, sort: "purchase_price", order: "desc" });
    expect(list.map((p) => p.id)).toEqual([13, 12]);
    const low = visibleItems([...items, product({ id: 9, archived: true, is_low_stock: true })], { ...DEFAULT_FILTERS, low_stock: true });
    expect(low.map((p) => p.id)).toEqual([12, 13]);
  });
});

describe("ProductList page", () => {
  it("renders rows with low-stock marks and keeps filters in the URL", async () => {
    const f = stubFetch(cats, (u) => (/\/api\/products(\?|$)/.test(u) ? { body: { items, counts } } : undefined));
    renderAt("/products?status=archived", "/products", ProductList);
    await screen.findByText("Double socket outlet");
    expect(calls(f, "GET", /\/api\/products\?status=archived$/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /low stock only/i }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/products?low_stock=1"));
    await waitFor(() => expect(calls(f, "GET", /low_stock=true/).length).toBeGreaterThan(0));
  });

  it("debounces search into the URL and shows the no-results state", async () => {
    stubFetch(cats, (u) =>
      /\/api\/products\?search=zzz/.test(u) ? { body: { items: [], counts } } : /\/api\/products/.test(u) ? { body: { items, counts } } : undefined,
    );
    renderAt("/products", "/products", ProductList);
    await screen.findByText("Double socket outlet");
    const input = screen.getByLabelText("Search by name or SKU") as HTMLInputElement;
    input.value = "zzz";
    fireEvent.input(input);
    expect(screen.getByTestId("where").textContent).toBe("/products");
    await screen.findByText("No products match “zzz”");
    expect(screen.getByTestId("where").textContent).toBe("/products?search=zzz");
    fireEvent.click(screen.getByRole("button", { name: /clear search/i }));
    await screen.findByText("Double socket outlet");
  });

  it("first run shows the empty state", async () => {
    stubFetch(cats, (u) => (/\/api\/products/.test(u) ? { body: { items: [], counts: { active: 0, archived: 0, all: 0, low_stock: 0 } } } : undefined));
    renderAt("/products", "/products", ProductList);
    await screen.findByText("No products yet");
    expect((screen.getByRole("button", { name: /export csv/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("load error offers retry", async () => {
    let fail = true;
    stubFetch(cats, (u) => (/\/api\/products/.test(u) ? (fail ? { status: 500, body: {} } : { body: { items, counts } }) : undefined));
    renderAt("/products", "/products", ProductList);
    await screen.findByText("Couldn’t load products");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("Double socket outlet");
  });

  it("exports CSV with the current filters and shows the export toast", async () => {
    const f = stubFetch(cats, (u) => (/\/api\/products\?/.test(u) || /\/api\/products$/.test(u) ? { body: { items, counts } } : undefined));
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:x");
    renderAt("/products?category_id=none", "/products", ProductList);
    await screen.findByText("Double socket outlet");
    f.mockImplementation(async () =>
      new Response("SKU\n", { status: 200, headers: { "Content-Disposition": 'attachment; filename="products-2026-11-05.csv"' } }),
    );
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => expect(toastTitles()).toContain("products-2026-11-05.csv exported · 2 rows"));
    expect(String(f.mock.calls.at(-1)![0])).toBe("/api/products/export.csv?category_id=none");
    URL.createObjectURL = origCreate;
  });
});
