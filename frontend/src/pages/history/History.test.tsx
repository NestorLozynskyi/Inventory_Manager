import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router";
import History from "./History";
import { setMe } from "../../lib/auth";

const mv = (i: number, kind = "receipt", type = "receipt") => ({
  id: i, at: "2026-11-04T14:20:00Z", type, document: { id: 50 + i, kind, number: `DOC-${i}` },
  product: { id: 9, sku: "ELC-0401", name: "Copper wire", unit: "m", archived: i === 2, stock: 1, avg_cost: 1, purchase_price: 1 },
  qty_change: i === 1 ? -25.5 : 10, balance_after: 186.5, unit_cost: 1, value_change: 1,
});
let urls: string[];
let movements: { items: unknown[]; total: number };
beforeEach(() => {
  setMe({ id: 1, email: "a@b.co", is_demo: false, demo_expires_at: null, currency: "USD", created_at: "2026-11-01T00:00:00Z" });
  urls = [];
  movements = { items: [mv(1, "write_off", "write_off"), mv(2, "receipt_reversal", "reversal"), mv(3, "stock_count", "stock_count")], total: 45 };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    let body: unknown = { items: [] };
    if (url.startsWith("/api/movements")) body = url.includes("search=zzz") ? { items: [], total: 0 } : movements;
    else if (url.startsWith("/api/categories")) body = [{ id: 3, name: "Electrical" }];
    else if (url.startsWith("/api/receipts")) body = { items: [{ id: 52, reverses: { id: 40, number: "RC-000040" } }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  setMe(undefined);
  vi.unstubAllGlobals();
});
function renderAt(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  render(() => (
    <MemoryRouter history={history}>
      <Route path="/history" component={History} />
    </MemoryRouter>
  ));
  return history;
}
const lastMovementsUrl = () => [...urls].reverse().find((u) => u.startsWith("/api/movements"))!;

describe("History", () => {
  it("renders rows with document links by kind, reversal notes and pagination", async () => {
    renderAt("/history?page=2");
    expect(await screen.findByText("DOC-1")).toHaveAttribute("href", "/write-offs/51");
    expect(screen.getByText("DOC-2")).toHaveAttribute("href", "/reversals/52");
    expect(screen.getByText("DOC-3")).toHaveAttribute("href", "/stock-counts/53");
    expect(lastMovementsUrl()).toContain("limit=20");
    expect(lastMovementsUrl()).toContain("offset=20");
    expect(screen.getByText("Showing 21–40 of 45 movements")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(screen.getByText("Reverses RC-000040")).toBeInTheDocument());
    expect(screen.getAllByText(/ELC-0401 · Archived/).length).toBe(1);
  });

  it("sends filters from the URL, shows chips, and the deep link ?doc= searches by document number", async () => {
    renderAt("/history?type=write_off&doc=SC-000008&category=3");
    await screen.findByText("DOC-1");
    const u = lastMovementsUrl();
    expect(u).toContain("type=write_off");
    expect(u).toContain("search=SC-000008");
    expect(u).toContain("category_id=3");
    expect(screen.getByText("Type: Write-off")).toBeInTheDocument();
    expect(screen.getByText("Document: SC-000008")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Category: Electrical")).toBeInTheDocument());
  });

  it("shows the filtered empty state and clears filters", async () => {
    renderAt("/history?search=zzz");
    expect(await screen.findByText("No movements match your filters")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Clear filters/ })[1]);
    expect(await screen.findByText("DOC-1")).toBeInTheDocument();
    expect(lastMovementsUrl()).not.toContain("search=");
  });

  it("validates a custom range before applying it", async () => {
    renderAt("/history?period=custom&from=2026-10-01&to=2026-11-05");
    await screen.findByText("DOC-1");
    expect(lastMovementsUrl()).toContain("from=2026-10-01");
    const to = screen.getByLabelText("To") as HTMLInputElement;
    fireEvent.change(to, { target: { value: "2026-09-01" } });
    expect(to).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("“From” must be on or before “To”.")).toBeInTheDocument();
    expect(lastMovementsUrl()).toContain("to=2026-11-05");
  });
});
