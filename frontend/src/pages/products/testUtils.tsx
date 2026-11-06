/** Test helpers for the product / category pages: routed fetch stub + router wrapper. */
import { vi } from "vitest";
import { render } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory, useLocation } from "@solidjs/router";
import type { Component } from "solid-js";
import type { Product } from "./types";

export type Handler = (url: string, init: RequestInit) => { status?: number; body?: unknown } | undefined;

export function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stub global fetch; handlers are tried in order, first defined result wins. Returns the mock. */
export function stubFetch(...handlers: Handler[]) {
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    for (const h of handlers) {
      const r = h(url, init);
      if (r) return json(r.status ?? 200, r.body);
    }
    return json(404, { error: { code: "not_found", message: "Not found." } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

export function calls(mock: ReturnType<typeof stubFetch>, method: string, re: RegExp) {
  return mock.mock.calls.filter(([u, i]) => ((i as RequestInit)?.method ?? "GET") === method && re.test(String(u)));
}

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

export function renderAt(path: string, pattern: string, Page: Component) {
  const history = createMemoryHistory();
  history.set({ value: path });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path={pattern} component={() => (<><Page /><Where /></>)} />
      <Route path="*" component={Where} />
    </MemoryRouter>
  ));
}

export function product(over: Partial<Product> = {}): Product {
  return {
    id: 12,
    sku: "FST-0012",
    name: "Galvanized nails 50 mm",
    category_id: 3,
    category_name: "Fasteners",
    unit: "kg",
    description: "",
    purchase_price: 3.2,
    sale_price: 5.4,
    min_stock: 20,
    stock: 42.5,
    avg_cost: 3.15,
    stock_value: 133.88,
    is_low_stock: false,
    archived: false,
    archived_at: null,
    created_at: "2026-08-12T09:00:00Z",
    updated_at: "2026-11-04T09:00:00Z",
    has_movements: true,
    last_receipt_at: null,
    ...over,
  };
}

export { toasts, clearToasts } from "../../components/Toast";
import { toasts as _toasts } from "../../components/Toast";
/** Titles of the toasts currently queued. */
export const toastTitles = () => _toasts().map((t) => t.title);
