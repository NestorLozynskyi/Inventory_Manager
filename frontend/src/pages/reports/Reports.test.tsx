import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory, useLocation } from "@solidjs/router";
import { ApiError } from "../../api/client";
import { toIsoDate } from "../../lib/format";
import { clearToasts, toasts } from "../../components/Toast";

const get = vi.fn();
const download = vi.fn();
vi.mock("../../api/client", async (orig) => {
  const mod = await orig<typeof import("../../api/client")>();
  return { ...mod, api: { ...mod.api, get: (...a: unknown[]) => get(...a), download: (...a: unknown[]) => download(...a) } };
});

import Reports, {
  REPORTS,
  isEmptyReport,
  paramErrorFromApi,
  reportDefaults,
  validateParams,
  type ReportParams,
} from "./Reports";

const CATS = [
  { id: 1, name: "Fasteners" },
  { id: 2, name: "Garden" },
];
const product = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  sku: `SKU-${id}`,
  name,
  unit: "pcs",
  archived: false,
  ...extra,
});
const STOCK_ON_DATE = {
  category_label: "All categories",
  rows: [
    { product: product(1, "Hex bolt"), category_name: "Fasteners", qty: 10, avg_cost: 1.5, value: 15 },
    { product: product(2, "Old primer", { archived: true, unit: "l" }), category_name: null, qty: 2.5, avg_cost: 2, value: 5 },
  ],
  total_value: 20,
  product_count: 2,
  in_stock_count: 2,
};
const EMPTY_SOD = { category_label: "All categories", rows: [], total_value: 0, product_count: 0, in_stock_count: 0 };

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderAt(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  return render(() => (
    <MemoryRouter history={history}>
      <Route
        path="/reports/:report"
        component={() => (
          <>
            <Reports />
            <Where />
          </>
        )}
      />
    </MemoryRouter>
  ));
}

/** Route GET calls: categories → CATS, reports → handler(path). */
function routeGet(report: (path: string) => unknown) {
  get.mockImplementation((path: string) => {
    if (path.startsWith("/api/categories")) return Promise.resolve(CATS);
    try {
      const r = report(path);
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    } catch (e) {
      return Promise.reject(e);
    }
  });
}
const reportCalls = () => get.mock.calls.map((c) => c[0] as string).filter((p) => p.startsWith("/api/reports"));

beforeEach(() => {
  get.mockReset();
  download.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
});
afterEach(() => {
  cleanup();
  clearToasts();
  vi.unstubAllGlobals();
});

describe("report helpers", () => {
  it("defaults: stock on date today, movement previous month, write-offs last 30 days", () => {
    expect(reportDefaults("stock-on-date", "2026-11-05").date).toBe("2026-11-05");
    const mv = reportDefaults("movement", "2026-11-05");
    expect([mv.from, mv.to]).toEqual(["2026-10-01", "2026-10-31"]);
    const mvJan = reportDefaults("movement", "2027-01-10");
    expect([mvJan.from, mvJan.to]).toEqual(["2026-12-01", "2026-12-31"]);
    const wo = reportDefaults("write-offs-by-reason", "2026-11-05");
    expect([wo.from, wo.to]).toEqual(["2026-10-06", "2026-11-05"]);
    expect(reportDefaults("low-stock", "2026-11-05").category_id).toBe("");
  });

  it("validates dates like the mockup", () => {
    const sod = REPORTS[0];
    const mv = REPORTS[1];
    const p = (o: Partial<ReportParams>): ReportParams => ({ date: "", from: "", to: "", category_id: "", ...o });
    expect(validateParams(sod, p({}), "2026-11-05")).toEqual({ field: "date", message: "Choose a date." });
    expect(validateParams(sod, p({ date: "2026-11-06" }), "2026-11-05")?.message).toBe("The date can’t be in the future.");
    expect(validateParams(sod, p({ date: "2026-11-05" }), "2026-11-05")).toBeNull();
    expect(validateParams(mv, p({ to: "2026-10-01" }), "2026-11-05")?.field).toBe("from");
    expect(validateParams(mv, p({ from: "2026-10-01" }), "2026-11-05")?.field).toBe("to");
    expect(validateParams(mv, p({ from: "2026-10-10", to: "2026-10-01" }), "2026-11-05")?.message).toBe(
      "“From” must be on or before “To”.",
    );
    expect(validateParams(mv, p({ from: "2026-10-10", to: "2026-12-01" }), "2026-11-05")?.message).toBe(
      "The period can’t end in the future.",
    );
    expect(validateParams(REPORTS[2], p({}), "2026-11-05")).toBeNull();
  });

  it("maps API validation errors onto fields", () => {
    const err = new ApiError(422, "validation_error", "Check the highlighted fields.", [
      { field: "to", message: "The end date must be on or after the start date.", type: "range" },
    ]);
    expect(paramErrorFromApi(err)).toEqual({ field: "to", message: "The end date must be on or after the start date." });
    expect(paramErrorFromApi(new ApiError(500, "server_error", "Oops"))).toBeNull();
  });

  it("detects empty reports", () => {
    expect(isEmptyReport("stock-on-date", EMPTY_SOD as never)).toBe(true);
    expect(isEmptyReport("write-offs-by-reason", { rows: [{ value: 0 }], total_value: 0 } as never)).toBe(true);
    expect(isEmptyReport("stock-value", { by: "product", rows: [] } as never)).toBe(true);
    expect(isEmptyReport("stock-value", { by: "category", rows: [{}], active_count: 0 } as never)).toBe(true);
    expect(isEmptyReport("stock-value", { by: "category", rows: [{}], active_count: 3 } as never)).toBe(false);
  });
});

describe("Reports page", () => {
  it("renders stock on date with the cost-in-effect note and archived badge", async () => {
    routeGet(() => STOCK_ON_DATE);
    renderAt("/reports/stock-on-date");
    expect(await screen.findByText("Hex bolt")).toBeInTheDocument();
    expect(screen.getByText("Old primer").closest("td")).toHaveTextContent("Archived");
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    expect(screen.getByText(/Values use the average cost in effect at the end of the selected day\./)).toBeInTheDocument();
    expect(screen.getByText(/Archived products are included/)).toBeInTheDocument();
    expect(reportCalls()[0]).toBe(`/api/reports/stock-on-date?date=${toIsoDate()}`);
    expect(document.title).toBe("Stock on date · Reports · Inventory Manager");
    expect(screen.getByRole("link", { name: "Stock on date" })).toHaveAttribute("aria-current", "page");
  });

  it("shows inline validation and does not request a future date", async () => {
    routeGet(() => STOCK_ON_DATE);
    renderAt("/reports/stock-on-date");
    await screen.findByText("Hex bolt");
    const input = screen.getByLabelText("Date") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "2999-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const err = document.getElementById("rp-err")!;
    expect(err).not.toHaveAttribute("hidden");
    expect(err).toHaveTextContent("The date can’t be in the future.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "rp-err");
    expect(reportCalls().some((c) => c.includes("2999"))).toBe(false);
  });

  it("applies parameters into the URL, refetches and shows the empty state; reset restores defaults", async () => {
    routeGet((path) => (path.includes("2026-07-31") ? EMPTY_SOD : STOCK_ON_DATE));
    renderAt("/reports/stock-on-date");
    await screen.findByText("Hex bolt");
    fireEvent.input(screen.getByLabelText("Date"), { target: { value: "2026-07-31" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("No data for the selected parameters")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/reports/stock-on-date?date=2026-07-31&category_id=1");
    expect(reportCalls()).toContain("/api/reports/stock-on-date?date=2026-07-31&category_id=1");
    expect(screen.getByText("Fasteners · quantities at end of day · values at average cost on that day")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeDisabled();
    await waitFor(() => expect(document.getElementById("rp-status")).toHaveTextContent("no data"));

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(await screen.findByText("Hex bolt")).toBeInTheDocument();
    expect(screen.getByTestId("where").textContent).toBe("/reports/stock-on-date");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(toIsoDate());
  });

  it("shows server field errors inline and in the result card", async () => {
    routeGet(
      () =>
        new ApiError(422, "validation_error", "Check the highlighted fields.", [
          { field: "to", message: "The end date must be on or after the start date.", type: "range" },
        ]),
    );
    renderAt("/reports/movement?from=2026-10-20&to=2026-10-10");
    expect(await screen.findByText("Couldn’t build the report")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("To")).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById("rp-err")).toHaveTextContent("The end date must be on or after the start date.");
  });

  it("shows a retryable error state for server failures", async () => {
    let fail = true;
    routeGet(() => (fail ? new ApiError(500, "server_error", "Boom") : STOCK_ON_DATE));
    renderAt("/reports/stock-on-date");
    expect(await screen.findByText("Couldn’t load data")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("Hex bolt")).toBeInTheDocument();
  });

  it("exports CSV with the same parameters and toasts the file name", async () => {
    routeGet(() => STOCK_ON_DATE);
    download.mockResolvedValue("stock-on-date-2026-11-05.csv");
    renderAt("/reports/stock-on-date?category_id=none");
    await screen.findByText("Hex bolt");
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(download.mock.calls[0][0]).toBe(`/api/reports/stock-on-date?date=${toIsoDate()}&category_id=none&format=csv`);
    await waitFor(() => expect(toasts().some((t) => t.title === "stock-on-date-2026-11-05.csv exported")).toBe(true));
  });

  it("renders write-offs by reason with chart and reversed numbers note", async () => {
    routeGet(() => ({
      rows: [
        { reason: "Sale", documents: 2, lines: 7, value: 264.07, share: 61.5 },
        { reason: "Other", documents: 0, lines: 0, value: 0, share: 0 },
      ],
      total_value: 264.07,
      document_count: 2,
      line_count: 7,
      reversed_numbers: ["WO-000044"],
    }));
    renderAt("/reports/write-offs-by-reason");
    expect(await screen.findByText("Write-off value by reason")).toBeInTheDocument();
    expect(document.querySelectorAll(".hbars-row")).toHaveLength(1);
    expect(screen.getByText(/Reversed write-offs \(WO-000044\) are excluded/)).toBeInTheDocument();
    expect(screen.getByText("Sale · 100.0%")).toBeInTheDocument();
  });

  it("movement totals row shows values at the cost of the time", async () => {
    routeGet(() => ({
      rows: [
        {
          product: product(1, "Hex bolt"),
          opening: 5,
          received: 10,
          written_off: -3,
          adjustments: 0,
          closing: 12,
        },
      ],
      totals: { opening_value: 5, received_value: 12, written_off_value: -3.3, adjustments_value: 0, closing_value: 13.7 },
      moved_count: 1,
    }));
    renderAt("/reports/movement");
    expect(await screen.findByText("Value at cost of the time")).toBeInTheDocument();
    expect(screen.getByText("−3 pcs")).toHaveClass("text-danger");
    expect(screen.queryByText(/current average cost/)).toBeNull();
  });
});
