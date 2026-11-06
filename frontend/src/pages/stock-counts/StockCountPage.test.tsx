import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router";
import StockCountPage from "./StockCountPage";
import StockCountList from "./StockCountList";
import { setMe } from "../../lib/auth";
import { clearToasts } from "../../components/Toast";
import type { StockCount } from "./stockCount";

const product = (id: number, unit: string, stock: number, cost: number) => ({
  id, sku: `SKU-${id}`, name: `Product ${id}`, unit, archived: false, stock, avg_cost: cost, purchase_price: cost,
});
function draft(): StockCount {
  return {
    id: 7, kind: "stock_count", number: "SC-000007", status: "draft", created_at: "2026-11-05T08:00:00Z",
    posted_at: null, note: "", line_count: 2, scope: "all", scope_label: "All active products", category: null,
    counted: 0, surplus_count: 0, shortage_count: 0, surplus_value: 0, shortage_value: 0, net_value: 0,
    lines: [
      { id: 101, product: product(1, "pcs", 10, 2), book_qty: 10, actual_qty: null, difference: null, unit_cost: 2, value: null },
      { id: 102, product: product(2, "kg", 5, 4), book_qty: 5, actual_qty: null, difference: null, unit_cost: 4, value: null },
    ],
  };
}

type Handler = (method: string, url: string, body: unknown) => [number, unknown] | undefined;
let calls: { method: string; url: string; body: unknown }[];
function mockApi(h: Handler) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const r = h(method, url, body) ?? [404, { error: { code: "not_found", message: "Not found." } }];
    return new Response(r[0] === 204 ? null : JSON.stringify(r[1]), { status: r[0], headers: { "Content-Type": "application/json" } });
  }));
}
function renderAt(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path="/stock-counts" component={StockCountList} />
      <Route path={["/stock-counts/new", "/stock-counts/:id"]} component={StockCountPage} />
    </MemoryRouter>
  ));
}

beforeEach(() => setMe({ id: 1, email: "a@b.co", is_demo: false, demo_expires_at: null, currency: "USD", created_at: "2026-11-01T00:00:00Z" }));
afterEach(() => {
  cleanup();
  clearToasts();
  setMe(undefined);
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Stock count draft", () => {
  it("validates input per unit, shows inline errors and live differences, autosaves valid quantities", async () => {
    const doc = draft();
    mockApi((m, url, body) => {
      if (m === "GET" && url.endsWith("/api/stock-counts/7")) return [200, doc];
      if (m === "PATCH") {
        const lines = (body as { lines: { id: number; actual_qty: number | null }[] }).lines;
        for (const l of lines) doc.lines.find((x) => x.id === l.id)!.actual_qty = l.actual_qty;
        return [200, doc];
      }
    });
    renderAt("/stock-counts/7");
    const pcs = (await screen.findByLabelText("Actual quantity of Product 1, in pcs")) as HTMLInputElement;
    fireEvent.input(pcs, { target: { value: "2.5" } });
    expect(pcs).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(pcs.getAttribute("aria-describedby")!)).toHaveTextContent("Use a whole number for pcs.");
    expect(pcs.closest("tr")).toHaveClass("is-invalid");

    fireEvent.input(pcs, { target: { value: "12" } });
    expect(pcs).not.toHaveAttribute("aria-invalid");
    const row = pcs.closest("tr")!;
    expect(row.querySelector('[data-cell="diff"]')).toHaveTextContent("Surplus+2 pcs");
    expect(row.querySelector('[data-cell="val"]')).toHaveTextContent("+$4.00");
    expect(screen.getByText("1 of 2")).toBeInTheDocument();

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true), { timeout: 2000 });
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toEqual({ lines: [{ id: 101, actual_qty: 12 }] });
  });

  it("maps server field errors (lines.N.actual_qty) to the right row", async () => {
    mockApi((m, url) => {
      if (m === "GET" && url.endsWith("/api/stock-counts/7")) return [200, draft()];
      if (m === "PATCH")
        return [422, { error: { code: "validation_error", message: "Check the highlighted fields.", details: [{ field: "lines.0.actual_qty", message: "Server says no.", type: "invalid_qty" }] } }];
    });
    renderAt("/stock-counts/7");
    const kg = (await screen.findByLabelText("Actual quantity of Product 2, in kg")) as HTMLInputElement;
    fireEvent.input(kg, { target: { value: "4.5" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await waitFor(() => expect(kg).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(kg.getAttribute("aria-describedby")!)).toHaveTextContent("Server says no.");
  });

  it("confirm summary → post; 422 nothing counted shows the error inside the dialog", async () => {
    mockApi((m, url) => {
      if (m === "GET" && url.endsWith("/api/stock-counts/7")) return [200, draft()];
      if (m === "POST" && url.endsWith("/post"))
        return [422, { error: { code: "validation_error", message: "Check the highlighted fields.", details: [{ field: "lines", message: "Enter the actual quantity for at least one product.", type: "required" }] } }];
    });
    renderAt("/stock-counts/7");
    await screen.findByText("Stock count SC-000007");
    fireEvent.click(screen.getAllByRole("button", { name: "Post adjustments" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Post stock count SC-000007?" });
    expect(within(dialog).getByText("2 items not counted")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Post adjustments" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter the actual quantity for at least one product."));
  });

  it("posting switches to the posted view", async () => {
    const posted: StockCount = {
      ...draft(), status: "posted", posted_at: "2026-11-05T09:00:00Z", counted: 1, shortage_count: 1, shortage_value: -4, net_value: -4,
      lines: [
        { ...draft().lines[0], actual_qty: 8, difference: -2, value: -4 },
        draft().lines[1],
      ],
    };
    const doc = draft();
    doc.lines[0].actual_qty = 8;
    mockApi((m, url) => {
      if (m === "GET" && url.endsWith("/api/stock-counts/7")) return [200, doc];
      if (m === "POST" && url.endsWith("/post")) return [200, posted];
    });
    renderAt("/stock-counts/7");
    await screen.findByText("Stock count SC-000007");
    fireEvent.click(screen.getAllByRole("button", { name: "Post adjustments" })[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Post adjustments" }));
    expect(await screen.findByText(/Posted on Nov 5, 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View in History" })).toHaveAttribute("href", "/history?doc=SC-000007");
    expect(screen.getByText("Showing 1 item with differences · 1 unchanged or not counted hidden")).toBeInTheDocument();
  });

  it("delete draft asks for confirmation and returns to the list", async () => {
    mockApi((m, url) => {
      if (m === "GET" && url.endsWith("/api/stock-counts/7")) return [200, draft()];
      if (m === "DELETE") return [204, null];
      if (m === "GET" && url.endsWith("/api/stock-counts")) return [200, { items: [] }];
    });
    renderAt("/stock-counts/7");
    fireEvent.click(await screen.findByRole("button", { name: "Delete draft" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete draft SC-000007?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete draft" }));
    expect(await screen.findByText("No stock counts yet")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/api/stock-counts/7"))).toBe(true);
  });
});

describe("New stock count", () => {
  it("requires a category for category scope, then creates and opens the draft", async () => {
    mockApi((m, url, body) => {
      if (url.endsWith("/api/categories")) return [200, [{ id: 3, name: "Tools", product_count: 2, active_product_count: 2 }, { id: 4, name: "Empty", product_count: 0, active_product_count: 0 }]];
      if (url.startsWith("/api/products")) return [200, { items: [], counts: { active: 27, archived: 0, all: 27, low_stock: 0 } }];
      if (m === "POST" && url.endsWith("/api/stock-counts")) {
        expect(body).toEqual({ category_id: 3, note: "Aisle 1" });
        return [201, { ...draft(), scope: "category", scope_label: "Category: Tools" }];
      }
      if (m === "GET" && url.endsWith("/api/stock-counts/7")) return [200, { ...draft(), scope: "category", scope_label: "Category: Tools" }];
    });
    renderAt("/stock-counts/new");
    expect(await screen.findByText("27 products will be added to this count")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("One category"));
    fireEvent.click(screen.getByRole("button", { name: "Create stock count" }));
    const sel = screen.getByLabelText("Category");
    expect(sel).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Choose a category to count.")).toBeInTheDocument();
    expect(within(sel).getByRole("option", { name: "Empty (0 products)" })).toBeDisabled();
    fireEvent.change(sel, { target: { value: "3" } });
    expect(screen.getByText("2 products from Tools will be added to this count")).toBeInTheDocument();
    fireEvent.input(screen.getByLabelText(/Note/), { target: { value: "Aisle 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create stock count" }));
    expect(await screen.findByText("Stock count SC-000007")).toBeInTheDocument();
  });
});
