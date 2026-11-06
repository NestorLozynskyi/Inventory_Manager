import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory, useLocation } from "@solidjs/router";
import ReceiptList from "./ReceiptList";
import ReceiptPage from "./ReceiptPage";
import WriteOffPage from "./WriteOffPage";
import ReversalPage from "./ReversalPage";
import { setMe } from "../../lib/auth";
import { ToastRegion, clearToasts } from "../../components/Toast";
import type { Doc } from "./docs";

const product = (id: number, unit: string, stock: number, price = 2) => ({
  id, sku: `SKU-${id}`, name: `Product ${id}`, unit, archived: false, stock, avg_cost: price, purchase_price: price,
  category_id: 1, category_name: "Tools",
});
const PRODUCTS = { items: [product(1, "pcs", 10, 1.85), product(2, "kg", 4.5, 3)] };

function doc(over: Partial<Doc>): Doc {
  return {
    id: 7, kind: "receipt", number: "RC-000007", status: "draft", created_at: "2026-11-05T08:00:00Z", posted_at: null,
    note: "", line_count: 1, total: 18.5, supplier: "ACME", reason: null, reversal: null, reverses: null,
    lines: [{ id: 1, product: product(1, "pcs", 10, 1.85), qty: 10, price: 1.85, total: 18.5 }],
    ...over,
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
    const r = h(method, url, body) ??
      (method === "GET" && url.startsWith("/api/products") ? [200, PRODUCTS] : undefined) ??
      (method === "GET" && url.startsWith("/api/receipts") && !/\d/.test(url) ? [200, { items: [] }] : undefined) ??
      [404, { error: { code: "not_found", message: "Not found." } }];
    return new Response(r[0] === 204 ? null : JSON.stringify(r[1]), { status: r[0], headers: { "Content-Type": "application/json" } });
  }));
}
const mutations = () => calls.filter((c) => c.method !== "GET");

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
function renderAt(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  return render(() => (
    <MemoryRouter history={history} root={(p) => <>{p.children}<Where /><ToastRegion /></>}>
      <Route path="/receipts" component={ReceiptList} />
      <Route path={["/receipts/new", "/receipts/:id"]} component={ReceiptPage} />
      <Route path={["/write-offs/new", "/write-offs/:id"]} component={WriteOffPage} />
      <Route path="/reversals/:id" component={ReversalPage} />
    </MemoryRouter>
  ));
}
const where = () => screen.getByTestId("where").textContent;
const confirmBtn = () => document.querySelector<HTMLButtonElement>("[data-im-confirm]")!;
const postBtn = () => document.querySelector<HTMLButtonElement>(".page-actions [data-act=post]")!;

beforeEach(() => setMe({ id: 1, email: "a@b.co", is_demo: false, demo_expires_at: null, currency: "USD", created_at: "2026-11-01T00:00:00Z" }));
afterEach(() => {
  cleanup();
  clearToasts();
  setMe(undefined);
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Receipt editor", () => {
  it("creates nothing until saved; validates before posting; prefills price; saves a draft", async () => {
    mockApi((m, url) => {
      if (m === "POST" && url === "/api/receipts") return [201, doc({ id: 9, number: "RC-000009" })];
      if (m === "GET" && url === "/api/receipts/9") return [200, doc({ id: 9, number: "RC-000009" })];
    });
    renderAt("/receipts/new");
    const sel = (await screen.findByLabelText("Product, line 1")) as HTMLSelectElement;
    expect(mutations()).toHaveLength(0);
    expect(postBtn()).toBeDisabled();

    fireEvent.change(sel, { target: { value: "1" } });
    expect(screen.getByLabelText("Unit price in dollars, line 1")).toHaveValue("1.85");
    fireEvent.click(postBtn());
    const qty = screen.getByLabelText(/^Quantity, line 1/);
    expect(qty).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(qty.getAttribute("aria-describedby")!.split(" ").pop()!)).toHaveTextContent(
      "Enter a quantity greater than 0.",
    );
    expect(document.getElementById("error-summary")).toHaveTextContent("Fix 1 problem to post this receipt");
    expect(mutations()).toHaveLength(0);

    fireEvent.input(qty, { target: { value: "10" } });
    fireEvent.click(document.querySelector<HTMLButtonElement>(".page-actions [data-act=save]")!);
    await waitFor(() => expect(where()).toBe("/receipts/9"));
    expect(mutations()[0]).toMatchObject({ method: "POST", url: "/api/receipts", body: { lines: [{ product_id: 1, qty: 10, price: 1.85 }] } });
    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
  });

  it("posts after confirmation and shows API field errors inline", async () => {
    let fail = true;
    mockApi((m, url) => {
      if (m === "GET" && url === "/api/receipts/7") return [200, doc({})];
      if (m === "PUT" && url === "/api/receipts/7") return [200, doc({})];
      if (m === "POST" && url === "/api/receipts/7/post") {
        if (fail) {
          fail = false;
          return [422, { error: { code: "validation_error", message: "Fix the errors.", details: [{ field: "lines.0.qty", message: "Enter a whole number for pcs." }] } }];
        }
        return [200, doc({ status: "posted", posted_at: "2026-11-05T09:00:00Z" })];
      }
    });
    renderAt("/receipts/7");
    await screen.findByLabelText("Product, line 1");
    fireEvent.click(postBtn());
    expect(screen.getByRole("dialog")).toHaveTextContent("Post receipt RC-000007?");
    expect(screen.getByRole("dialog")).toHaveTextContent("Stock will increase for 1 product.");
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(screen.getByLabelText(/^Quantity, line 1/)).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById("error-summary")).toHaveTextContent("Line 1 — enter a whole number for pcs.");

    fireEvent.click(postBtn());
    fireEvent.click(confirmBtn());
    expect(await screen.findByRole("button", { name: "Reverse" })).toBeInTheDocument();
    expect(screen.getByText(/Posted receipts can’t be edited\. To correct a mistake/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Product, line 1")).toBeNull();
    expect(screen.getByText("Receipt RC-000007 posted")).toBeInTheDocument();
  });

  it("deletes a draft after confirmation", async () => {
    mockApi((m, url) => {
      if (m === "GET" && url === "/api/receipts/7") return [200, doc({})];
      if (m === "DELETE" && url === "/api/receipts/7") return [204, null];
    });
    renderAt("/receipts/7");
    await screen.findByLabelText("Product, line 1");
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-act=delete]")!);
    expect(screen.getByRole("dialog")).toHaveTextContent("Delete draft RC-000007?");
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(where()).toBe("/receipts"));
    expect(mutations()).toEqual([expect.objectContaining({ method: "DELETE", url: "/api/receipts/7" })]);
  });
});

describe("Write-off editor", () => {
  it("shows the server's insufficient-stock list", async () => {
    const wo = doc({
      kind: "write_off", number: "WO-000007", supplier: undefined, reason: "Sale",
      lines: [{ id: 1, product: product(2, "kg", 4.5, 3), qty: 4, unit_cost: 3, total: 12 }],
    });
    mockApi((m, url) => {
      if (m === "GET" && url === "/api/write-offs/7") return [200, wo];
      if (m === "PUT") return [200, wo];
      if (m === "POST" && url === "/api/write-offs/7/post")
        return [409, { error: { code: "insufficient_stock", message: "Not enough stock.", shortages: [
          { product_id: 2, sku: "SKU-2", name: "Product 2", unit: "kg", required: 4, available: 1.5, line_index: 0 }] } }];
    });
    renderAt("/write-offs/7");
    await screen.findByLabelText("Product, line 1");
    fireEvent.click(postBtn());
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(document.getElementById("error-summary")).toHaveTextContent("Can’t post: not enough stock for 1 item"));
    expect(document.getElementById("error-summary")).toHaveTextContent("1.5 kg");
    const qty = screen.getByLabelText(/^Quantity, line 1/);
    expect(qty).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Only 1.5 kg available.")).toBeInTheDocument();
    expect(screen.getByText("In stock: 1.5 kg")).toBeInTheDocument();
  });
});

describe("Posted document", () => {
  const posted = doc({ status: "posted", posted_at: "2026-11-05T09:00:00Z" });

  it("reverses after confirmation and opens the reversal document", async () => {
    const rv = doc({ id: 8, kind: "receipt_reversal", number: "RV-000001", status: "posted", posted_at: "2026-11-05T10:00:00Z",
      reverses: { id: 7, number: "RC-000007", kind: "receipt", posted_at: "2026-11-05T09:00:00Z" } });
    mockApi((m, url) => {
      if (m === "GET" && url === "/api/receipts/7") return [200, posted];
      if (m === "POST" && url === "/api/receipts/7/reverse") return [201, rv];
      if (m === "GET" && url === "/api/reversals/8") return [200, rv];
    });
    renderAt("/receipts/7");
    fireEvent.click(await screen.findByRole("button", { name: "Reverse" }));
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveTextContent("Reverse receipt RC-000007?");
    expect(dlg).toHaveTextContent("In stock: 10 pcs → 0 pcs");
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(where()).toBe("/reversals/8"));
    expect(await screen.findByText("Reversal document")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "RC-000007" })[0]).toHaveAttribute("href", "/receipts/7");
    expect(screen.getAllByText("−10 pcs").length).toBeGreaterThan(0);
  });

  it("shows the refusal when the server reports a shortage", async () => {
    mockApi((m, url) => {
      if (m === "GET" && url === "/api/receipts/7") return [200, posted];
      if (m === "POST" && url === "/api/receipts/7/reverse")
        return [409, { error: { code: "insufficient_stock", message: "Not enough stock.", shortages: [
          { product_id: 1, sku: "SKU-1", name: "Product 1", unit: "pcs", required: 10, available: 4, line_index: 0 }] } }];
    });
    renderAt("/receipts/7");
    fireEvent.click(await screen.findByRole("button", { name: "Reverse" }));
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Can’t reverse RC-000007"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Stock would go below zero");
    expect(screen.getByRole("dialog")).toHaveTextContent("6 pcs");
  });

  it("refuses up front when current stock is already short", async () => {
    mockApi((m, url) => {
      if (m === "GET" && url === "/api/receipts/7")
        return [200, { ...posted, lines: [{ id: 1, product: product(1, "pcs", 3), qty: 10, price: 1.85, total: 18.5 }] }];
    });
    renderAt("/receipts/7");
    fireEvent.click(await screen.findByRole("button", { name: "Reverse" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Can’t reverse RC-000007");
    expect(mutations()).toHaveLength(0);
  });
});

describe("Receipts list", () => {
  it("lists receipts and reversals, keeps filters in the URL", async () => {
    const items = [
      doc({ id: 8, kind: "receipt_reversal", number: "RV-000001", status: "posted", posted_at: "2026-11-05T10:00:00Z",
        reverses: { id: 7, number: "RC-000007", kind: "receipt", posted_at: null } }),
      doc({ status: "reversed", posted_at: "2026-11-05T09:00:00Z", reversal: { id: 8, number: "RV-000001", kind: "receipt_reversal", posted_at: "2026-11-05T10:00:00Z" } }),
    ];
    mockApi((m, url) => {
      if (m === "GET" && url.startsWith("/api/receipts")) return [200, { items: url.includes("status=draft") ? [] : items }];
    });
    renderAt("/receipts");
    expect(await screen.findByRole("link", { name: "RV-000001" })).toHaveAttribute("href", "/reversals/8");
    expect(screen.getByText("Reverses RC-000007")).toBeInTheDocument();
    expect(screen.getByText("−$18.50")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "draft" } });
    await waitFor(() => expect(where()).toBe("/receipts?status=draft"));
    expect(await screen.findByText("No receipts match your filters")).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/receipts?status=draft")).toBe(true);
  });
});
