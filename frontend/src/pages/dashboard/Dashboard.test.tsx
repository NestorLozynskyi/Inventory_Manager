import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory, useLocation } from "@solidjs/router";
import { setMe, type Me } from "../../lib/auth";
import Dashboard, { documentHref, isNewAccount, longDate, type DashboardData } from "./Dashboard";

const REGULAR: Me = { id: 1, email: "a@b.com", is_demo: false, demo_expires_at: null, currency: "USD", created_at: "2026-11-01T10:00:00Z" };

const weeks = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ start: `2026-10-${String(5 + i).padStart(2, "0")}`, label: `W${i}`, receipts: 100 * i, write_offs: 10 }));

const DATA = (n = 8): DashboardData => ({
  today: "2026-11-05",
  kpis: { stock_value: 7339.49, active_products: 27, archived_products: 2, low_stock_count: 6, received_30d: 2619.5, receipts_30d: 5, written_off_30d: 429.4, write_offs_30d: 4 },
  weeks: weeks(n),
  by_reason: [{ reason: "Sale", value: 264.07 }, { reason: "Other", value: 0 }],
  period: { from: "2026-10-06", to: "2026-11-05" },
  low_stock: { items: [{ id: 34, sku: "FST-0038", name: "Concrete anchor", unit: "pcs", stock: 0, min_stock: 50 }], total: 6 },
  recent: [
    { id: 1, at: "2026-11-04T14:20:00Z", type: "write_off", document: { id: 51, kind: "write_off", number: "WO-000047" }, product: { id: 46, sku: "ELC-0401", name: "Copper wire", unit: "m" }, qty_change: -25.5 },
    { id: 2, at: "2026-11-03T10:00:00Z", type: "reversal", document: { id: 60, kind: "receipt_reversal", number: "RV-000002" }, product: { id: 47, sku: "X-1", name: "Tape", unit: "pcs" }, qty_change: -2 },
  ],
});

const EMPTY: DashboardData = {
  ...DATA(),
  kpis: { stock_value: 0, active_products: 0, archived_products: 0, low_stock_count: 0, received_30d: 0, receipts_30d: 0, written_off_30d: 0, write_offs_30d: 0 },
  weeks: weeks(8).map((w) => ({ ...w, receipts: 0, write_offs: 0 })),
  by_reason: [],
  low_stock: { items: [], total: 0 },
  recent: [],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
function renderDash(path = "/dashboard") {
  const history = createMemoryHistory();
  history.set({ value: path });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path="*" component={() => (<><Dashboard /><Where /></>)} />
    </MemoryRouter>
  ));
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => setMe(REGULAR));
afterEach(() => {
  cleanup();
  setMe(undefined);
  vi.unstubAllGlobals();
  document.documentElement.className = "";
});

describe("helpers", () => {
  it("longDate / documentHref / isNewAccount", () => {
    expect(longDate("2026-11-05")).toBe("Thursday, Nov 5, 2026");
    expect(documentHref({ id: 1, kind: "receipt" })).toBe("/receipts/1");
    expect(documentHref({ id: 2, kind: "write_off" })).toBe("/write-offs/2");
    expect(documentHref({ id: 3, kind: "write_off_reversal" })).toBe("/reversals/3");
    expect(documentHref({ id: 4, kind: "stock_count" })).toBe("/stock-counts/4");
    expect(isNewAccount(EMPTY)).toBe(true);
    expect(isNewAccount(DATA())).toBe(false);
  });
});

describe("Dashboard", () => {
  it("loading skeleton, then KPIs, lists and links", async () => {
    let resolve!: (r: Response) => void;
    fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderDash();
    expect(container.querySelectorAll(".dash-skel-kpi")).toHaveLength(5);
    expect(screen.getByText("Loading dashboard…")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/dashboard?weeks=8");
    resolve(json(200, DATA()));
    expect(await screen.findByText("$7,339.49")).toBeInTheDocument();
    expect(screen.getByText("Thursday, Nov 5, 2026")).toBeInTheDocument();
    expect(screen.getByText("2 archived products")).toBeInTheDocument();
    expect(screen.getByText("At or below minimum")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 6")).toBeInTheDocument();
    expect(screen.getByText("Low stock items").closest("a")).toHaveAttribute("href", "/products?low_stock=1");
    expect(screen.getByText("Total stock value").closest("a")).toHaveAttribute("href", "/reports/stock-value");
    expect(screen.getByText("WO-000047")).toHaveAttribute("href", "/write-offs/51");
    expect(screen.getByText("RV-000002")).toHaveAttribute("href", "/reversals/60");
    expect(screen.getByText("Concrete anchor")).toHaveAttribute("href", "/products/34");
    expect(screen.getByText("−25.5 m")).toHaveClass("text-danger");
    expect(screen.getByText("New receipt").closest("a")).toHaveAttribute("href", "/receipts/new");
  });

  it("weeks segmented control refetches with ?weeks=4 and keeps it in the URL", async () => {
    fetchMock = vi.fn(async (url: string) => json(200, DATA(String(url).includes("weeks=4") ? 4 : 8)));
    vi.stubGlobal("fetch", fetchMock);
    renderDash();
    await screen.findByText("$7,339.49");
    fireEvent.click(screen.getByRole("button", { name: "4 weeks" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)![0])).toBe("/api/dashboard?weeks=4"));
    expect(screen.getByTestId("where").textContent).toBe("/dashboard?weeks=4");
    await waitFor(() => expect(screen.getByText(/^Last 4 weeks ·/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "4 weeks" })).toHaveAttribute("aria-pressed", "true");
  });

  it("error state with retry", async () => {
    let fail = true;
    fetchMock = vi.fn(async () => {
      if (fail) throw new TypeError("Failed to fetch");
      return json(200, DATA());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDash();
    expect(await screen.findByText("Couldn’t load the dashboard")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("$7,339.49")).toBeInTheDocument();
  });

  it("empty state for a new account", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, EMPTY)));
    renderDash();
    expect(await screen.findByText("Your inventory is empty")).toBeInTheDocument();
    expect(screen.getByText("Add your first product").closest("a")).toHaveAttribute("href", "/products/new");
    expect(screen.getByText("No products yet", { selector: ".kpi-meta" })).toBeInTheDocument();
    expect(screen.getByText("No receipts or write-offs yet")).toBeInTheDocument();
    expect(screen.getByText("No operations yet")).toBeInTheDocument();
  });

  it("products but no activity: charts show empty placeholders", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { ...EMPTY, kpis: { ...EMPTY.kpis, active_products: 3 }, by_reason: [{ reason: "Sale", value: 0 }] })));
    renderDash();
    expect(await screen.findByText("No receipts or write-offs in the last 8 weeks")).toBeInTheDocument();
    expect(screen.getByText("No write-offs in the last 30 days")).toBeInTheDocument();
    expect(screen.getByText("No low stock")).toBeInTheDocument();
  });
});
