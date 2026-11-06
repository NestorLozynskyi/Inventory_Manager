/**
 * Reports — screens/reports.html. Route /reports/:report (stock-on-date | movement | low-stock |
 * write-offs-by-reason | stock-value). Parameters live in the URL (date / from / to / category_id);
 * data from GET /api/reports/<id>, "Export CSV" downloads the same report with format=csv.
 */
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch, type JSX } from "solid-js";
import { Navigate, useNavigate, useParams } from "@solidjs/router";
import { AppShell } from "../../components/AppShell";
import { Badge } from "../../components/Badge";
import { HBarChart, type HBarItem } from "../../components/Charts";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { SkeletonRows } from "../../components/SkeletonRows";
import { toast } from "../../components/Toast";
import { errorText } from "../../components/LoadView";
import { api, qs, ApiError } from "../../api/client";
import { createLoader, type Loader } from "../../lib/resource";
import { useListFilters } from "../../lib/url";
import { fmtDate, fmtMoney, fmtQty, fmtSignedMoney, fmtSignedQty, plural, toIsoDate } from "../../lib/format";
import "./Reports.css";
import { StockQty } from "../../components/StockQty";

/* ------------------------------------------------------------------ types -- */

export type ReportId = "stock-on-date" | "movement" | "low-stock" | "write-offs-by-reason" | "stock-value";
type ParamKind = "date" | "from" | "to" | "asof" | "category";

export interface ReportDef {
  id: ReportId;
  label: string;
  desc: string;
  params: ParamKind[];
}

export const REPORTS: ReportDef[] = [
  {
    id: "stock-on-date",
    label: "Stock on date",
    desc: "Quantity and value of each product at the end of the selected day.",
    params: ["date", "category"],
  },
  {
    id: "movement",
    label: "Stock movement",
    desc: "Opening balance, receipts, write-offs, stock count adjustments and closing balance for a period.",
    params: ["from", "to", "category"],
  },
  {
    id: "low-stock",
    label: "Low stock",
    desc: "Active products with stock at or below their minimum stock level.",
    params: ["asof", "category"],
  },
  {
    id: "write-offs-by-reason",
    label: "Write-offs by reason",
    desc: "Posted write-offs for a period grouped by reason, at the average cost recorded on posting.",
    params: ["from", "to", "category"],
  },
  {
    id: "stock-value",
    label: "Total stock value",
    desc: "Current value of active products at average cost, by category.",
    params: ["asof", "category"],
  },
];

interface ProductRef {
  id: number;
  sku: string;
  name: string;
  unit: string;
  archived: boolean;
  category_id?: number | null;
  category_name?: string | null;
}
interface Category {
  id: number;
  name: string;
}

interface StockOnDate {
  rows: { product: ProductRef; category_name: string | null; qty: number; avg_cost: number; value: number }[];
  total_value: number;
  product_count: number;
  in_stock_count: number;
}
interface MovementRow {
  product: ProductRef;
  opening: number;
  received: number;
  written_off: number;
  adjustments: number;
  closing: number;
}
interface Movement {
  rows: MovementRow[];
  totals: {
    opening_value: number;
    received_value: number;
    written_off_value: number;
    adjustments_value: number;
    closing_value: number;
  };
  moved_count?: number;
}
interface LowStock {
  rows: {
    product: ProductRef;
    category_name: string | null;
    stock: number;
    min_stock: number;
    shortfall: number;
    last_receipt_at: string | null;
  }[];
  out_of_stock_count: number;
  restock_cost: number;
}
interface WriteOffsByReason {
  rows: { reason: string; documents: number; lines: number; value: number; share: number }[];
  total_value: number;
  document_count: number;
  line_count: number;
  reversed_numbers: string[];
}
interface StockValueByCategory {
  by: "category";
  rows: { category: Category | null; product_count: number; in_stock_count: number; value: number; share: number }[];
  total_value: number;
  active_count: number;
  in_stock_count: number;
  archived_value: number;
}
interface StockValueByProduct {
  by: "product";
  rows: { product: ProductRef & { stock?: number }; stock: number; avg_cost: number; value: number; share: number }[];
  category_value: number;
  category_count: number;
  category_in_stock: number;
  total_value: number;
  archived_value: number;
}
type StockValue = StockValueByCategory | StockValueByProduct;

type ReportData = StockOnDate | Movement | LowStock | WriteOffsByReason | StockValue;

export interface ReportParams {
  date: string;
  from: string;
  to: string;
  category_id: string;
  [k: string]: string;
}

/* ---------------------------------------------------------------- helpers -- */

const zero = (v: number) => Math.abs(v) < 0.0005;
const signCls = (v: number) => (v > 0 ? "text-success" : v < 0 ? "text-danger" : "muted");
const countOf = (n: number, one: string, many?: string) => `${n} ${plural(n, one, many)}`;
const pctText = (share: number) => `${(Math.round(share * 10) / 10).toFixed(1)}%`;
const pctOf = (v: number, total: number) => (total > 0 ? pctText((v / total) * 100) : "0.0%");
const rangeText = (a: string, b: string) => `${fmtDate(a)} – ${fmtDate(b)}`;
const UNCATEGORIZED = "Uncategorized";

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toIsoDate(new Date(y, m - 1, d + days));
}

/** Default parameters of a report relative to `today` ("YYYY-MM-DD", local). */
export function reportDefaults(id: ReportId, today: string): ReportParams {
  const [y, m] = today.split("-").map(Number);
  const base: ReportParams = { date: "", from: "", to: "", category_id: "" };
  if (id === "stock-on-date") return { ...base, date: today };
  if (id === "movement") {
    // previous full calendar month
    return { ...base, from: toIsoDate(new Date(y, m - 2, 1)), to: toIsoDate(new Date(y, m - 1, 0)) };
  }
  if (id === "write-offs-by-reason") return { ...base, from: addDays(today, -30), to: today };
  return base;
}

/** Query parameters sent to the API for a report. */
export function apiParams(def: ReportDef, p: ReportParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (def.params.includes("date")) out.date = p.date;
  if (def.params.includes("from")) out.from = p.from;
  if (def.params.includes("to")) out.to = p.to;
  if (p.category_id) out.category_id = p.category_id;
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ParamError {
  field: "date" | "from" | "to" | "category_id" | null;
  message: string;
}

/** Client-side check of the form (mirrors the mockup; the server validates too). */
export function validateParams(def: ReportDef, p: ReportParams, today: string): ParamError | null {
  if (def.params.includes("date")) {
    if (!p.date || !ISO_DATE.test(p.date)) return { field: "date", message: "Choose a date." };
    if (p.date > today) return { field: "date", message: "The date can’t be in the future." };
  }
  if (def.params.includes("from")) {
    if (!p.from || !ISO_DATE.test(p.from)) return { field: "from", message: "Choose the start of the period." };
    if (!p.to || !ISO_DATE.test(p.to)) return { field: "to", message: "Choose the end of the period." };
    if (p.from > p.to) return { field: "to", message: "“From” must be on or before “To”." };
    if (p.to > today) return { field: "to", message: "The period can’t end in the future." };
  }
  return null;
}

/** First field error of an API validation error, mapped onto the form fields. */
export function paramErrorFromApi(err: unknown): ParamError | null {
  if (!(err instanceof ApiError) || (err.status !== 422 && err.status !== 400)) return null;
  const fe = err.fieldErrors();
  for (const key of ["date", "from", "to", "category_id"] as const) {
    if (fe[key]) return { field: key, message: fe[key] };
  }
  const general = err.generalErrors?.()[0];
  return { field: null, message: general || err.message };
}

/** Is the loaded report "no data"? */
export function isEmptyReport(id: ReportId, d: ReportData): boolean {
  switch (id) {
    case "write-offs-by-reason":
      return zero((d as WriteOffsByReason).total_value);
    case "stock-value": {
      const s = d as StockValue;
      return s.by === "product" ? s.rows.length === 0 : s.active_count === 0;
    }
    default:
      return (d as { rows: unknown[] }).rows.length === 0;
  }
}

function rowCount(d: ReportData): number {
  return (d as { rows: unknown[] }).rows.length;
}

/* ------------------------------------------------------------- cells/table -- */

function ProductCell(props: { p: ProductRef; label?: string }) {
  return (
    <td class="td-primary" data-label={props.label ?? "Product"}>
      <span class="cell-title">
        <a class="cell-link" href={`/products/${props.p.id}`}>
          {props.p.name}
        </a>
      </span>
      <span class="cell-sub">
        <span class="mono">{props.p.sku}</span>
        {props.p.archived ? " · Archived" : ""}
      </span>
    </td>
  );
}

function SignedQtyCell(props: { v: number; unit: string; label: string }) {
  return (
    <td class="num" data-label={props.label}>
      <Show when={!zero(props.v)} fallback={<span class="muted">—</span>}>
        <span class={signCls(props.v)}>{fmtSignedQty(props.v, props.unit)}</span>
      </Show>
    </td>
  );
}

function SignedMoneyCell(props: { v: number; label: string }) {
  return (
    <td class="num" data-label={props.label}>
      <Show when={!zero(props.v)} fallback={<span class="muted">{fmtMoney(0)}</span>}>
        <span class={signCls(props.v)}>{fmtSignedMoney(props.v)}</span>
      </Show>
    </td>
  );
}

function Meta(props: { items: [string, JSX.Element][] }) {
  return (
    <dl class="meta-list">
      <For each={props.items}>
        {(x) => (
          <div>
            <dt>{x[0]}</dt>
            <dd class="fw-semibold">{x[1]}</dd>
          </div>
        )}
      </For>
    </dl>
  );
}

function Table(props: { caption: string; head: [string, boolean?][]; children: JSX.Element; foot?: JSX.Element }) {
  return (
    <div class="table-wrap">
      <table class="table table-cards">
        <caption class="visually-hidden">{props.caption}</caption>
        <thead>
          <tr>
            <For each={props.head}>
              {(h) => (
                <th scope="col" class={h[1] ? "num" : undefined}>
                  {h[0]}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
        <Show when={props.foot}>
          <tfoot>{props.foot}</tfoot>
        </Show>
      </table>
    </div>
  );
}

interface Built {
  summary: JSX.Element;
  chart?: { title: string; items: HBarItem[] };
  table: JSX.Element;
  note: string;
}

/* --------------------------------------------------------- report bodies -- */

function buildStockOnDate(d: StockOnDate, p: ReportParams): Built {
  const hasArchived = d.rows.some((r) => r.product.archived);
  return {
    summary: (
      <Meta
        items={[
          ["Products", d.product_count],
          ["In stock", `${d.in_stock_count} of ${d.product_count}`],
          ["Total value", fmtMoney(d.total_value)],
        ]}
      />
    ),
    table: (
      <Table
        caption={`Stock on ${fmtDate(p.date)}`}
        head={[["SKU"], ["Product"], ["Category"], ["Unit"], ["Qty on date", true], ["Value (avg cost)", true]]}
        foot={
          <tr>
            <td class="td-primary" colspan="5">
              Total · {countOf(d.rows.length, "product")}
            </td>
            <td class="num" data-label="Total value">
              {fmtMoney(d.total_value)}
            </td>
          </tr>
        }
      >
        <For each={d.rows}>
          {(r) => (
            <tr>
              <td data-label="SKU" class="mono">
                {r.product.sku}
              </td>
              <td class="td-primary" data-label="Product">
                <a class="cell-link" href={`/products/${r.product.id}`}>
                  {r.product.name}
                </a>
                <Show when={r.product.archived}>
                  {" "}
                  <Badge kind="archived" />
                </Show>
              </td>
              <td data-label="Category">{r.category_name ?? UNCATEGORIZED}</td>
              <td data-label="Unit">{r.product.unit}</td>
              <td data-label="Qty on date" class="num">
                <Show when={!zero(r.qty)} fallback={<span class="muted">{fmtQty(0, r.product.unit)}</span>}>
                  {fmtQty(r.qty, r.product.unit)}
                </Show>
              </td>
              <td data-label="Value (avg cost)" class="num">
                {fmtMoney(r.value)}
              </td>
            </tr>
          )}
        </For>
      </Table>
    ),
    note:
      "Values use the average cost in effect at the end of the selected day." +
      (hasArchived ? " Archived products are included while they still hold stock." : ""),
  };
}

function buildMovement(d: Movement, p: ReportParams): Built {
  const t = d.totals;
  const moved =
    d.moved_count ?? d.rows.filter((r) => !zero(r.received) || !zero(r.written_off) || !zero(r.adjustments)).length;
  return {
    summary: (
      <Meta
        items={[
          ["Opening value", fmtMoney(t.opening_value)],
          ["Received", <span class="text-success">{fmtSignedMoney(t.received_value)}</span>],
          ["Written off", <span class="text-danger">{fmtSignedMoney(t.written_off_value)}</span>],
          ["Adjustments", <span class={signCls(t.adjustments_value)}>{fmtSignedMoney(t.adjustments_value)}</span>],
          ["Closing value", fmtMoney(t.closing_value)],
          ["Products with movement", `${moved} of ${d.rows.length}`],
        ]}
      />
    ),
    table: (
      <Table
        caption={`Stock movement ${rangeText(p.from, p.to)}`}
        head={[
          ["Product"],
          ["Unit"],
          ["Opening", true],
          ["Received (+)", true],
          ["Written off (−)", true],
          ["Adjustments (±)", true],
          ["Closing", true],
        ]}
        foot={
          <tr>
            <td class="td-primary">Value at cost of the time</td>
            <td />
            <td class="num" data-label="Opening">
              {fmtMoney(t.opening_value)}
            </td>
            <SignedMoneyCell v={t.received_value} label="Received" />
            <SignedMoneyCell v={t.written_off_value} label="Written off" />
            <SignedMoneyCell v={t.adjustments_value} label="Adjustments" />
            <td class="num" data-label="Closing">
              {fmtMoney(t.closing_value)}
            </td>
          </tr>
        }
      >
        <For each={d.rows}>
          {(r) => (
            <tr>
              <ProductCell p={r.product} />
              <td data-label="Unit">{r.product.unit}</td>
              <td data-label="Opening" class="num">
                {fmtQty(r.opening, r.product.unit)}
              </td>
              <SignedQtyCell v={r.received} unit={r.product.unit} label="Received" />
              <SignedQtyCell v={r.written_off} unit={r.product.unit} label="Written off" />
              <SignedQtyCell v={r.adjustments} unit={r.product.unit} label="Adjustments" />
              <td data-label="Closing" class="num fw-semibold">
                {fmtQty(r.closing, r.product.unit)}
              </td>
            </tr>
          )}
        </For>
      </Table>
    ),
    note:
      "Quantities are in each product’s unit, so they aren’t totalled; the last row shows values at the average cost in effect at the time (receipts at receipt price).",
  };
}

function buildLowStock(d: LowStock): Built {
  return {
    summary: (
      <Meta
        items={[
          ["At or below minimum", countOf(d.rows.length, "product")],
          ["Out of stock", countOf(d.out_of_stock_count, "product")],
          ["Cost to restock to minimum (at purchase price)", fmtMoney(d.restock_cost)],
        ]}
      />
    ),
    table: (
      <Table
        caption="Low stock products"
        head={[
          ["Product"],
          ["Category"],
          ["Stock", true],
          ["Min stock", true],
          ["Shortfall to min", true],
          ["Last receipt"],
          ["Status"],
        ]}
      >
        <For each={d.rows}>
          {(r) => (
            <tr>
              <ProductCell p={r.product} />
              <td data-label="Category">{r.category_name ?? UNCATEGORIZED}</td>
              <td data-label="Stock" class="num">
                <StockQty qty={r.stock} unit={r.product.unit} low />
              </td>
              <td data-label="Min stock" class="num">
                {fmtQty(r.min_stock, r.product.unit)}
              </td>
              <td data-label="Shortfall to min" class="num">
                <Show when={!zero(r.shortfall)} fallback={<span class="muted">At minimum</span>}>
                  <span class="text-danger">{fmtSignedQty(-r.shortfall, r.product.unit)}</span>
                </Show>
              </td>
              <td data-label="Last receipt" class="nowrap">
                <Show when={r.last_receipt_at} fallback={<span class="muted">No receipts</span>}>
                  {fmtDate(r.last_receipt_at)}
                </Show>
              </td>
              <td data-label="Status">
                <Badge kind="low" label={r.stock <= 0 ? "Out of stock" : "Low stock"} />
              </td>
            </tr>
          )}
        </For>
      </Table>
    ),
    note:
      "Products without a minimum stock level are never listed. Archived products are excluded. Cost to restock is an estimate at each product’s reference purchase price.",
  };
}

function buildWriteOffs(d: WriteOffsByReason): Built {
  const top = d.rows.reduce((a, b) => (b.value > a.value ? b : a), d.rows[0]);
  return {
    summary: (
      <Meta
        items={[
          ["Total written off", <span class="text-danger">{fmtSignedMoney(-d.total_value)}</span>],
          ["Documents", d.document_count],
          ["Line items", d.line_count],
          ["Top reason", `${top.reason} · ${pctOf(top.value, d.total_value)}`],
        ]}
      />
    ),
    chart: {
      title: "Write-off value by reason",
      items: d.rows.filter((r) => r.value > 0).map((r) => ({ label: r.reason, value: r.value, color: "var(--chart-2)" })),
    },
    table: (
      <Table
        caption="Write-offs by reason"
        head={[["Reason"], ["Documents", true], ["Line items", true], ["Value", true], ["Share", true]]}
        foot={
          <tr>
            <td class="td-primary">Total</td>
            <td class="num" data-label="Documents">
              {d.document_count}
            </td>
            <td class="num" data-label="Line items">
              {d.line_count}
            </td>
            <td class="num" data-label="Value">
              {fmtMoney(d.total_value)}
            </td>
            <td class="num" data-label="Share">
              100.0%
            </td>
          </tr>
        }
      >
        <For each={d.rows}>
          {(r) => {
            const none = zero(r.value);
            return (
              <tr>
                <td class="td-primary" data-label="Reason">
                  {none ? <span class="muted">{r.reason}</span> : <span class="cell-title">{r.reason}</span>}
                </td>
                <td data-label="Documents" class="num">
                  {none ? <span class="muted">0</span> : r.documents}
                </td>
                <td data-label="Line items" class="num">
                  {none ? <span class="muted">0</span> : r.lines}
                </td>
                <td data-label="Value" class="num">
                  {none ? <span class="muted">{fmtMoney(0)}</span> : fmtMoney(r.value)}
                </td>
                <td data-label="Share" class="num">
                  {none ? <span class="muted">0.0%</span> : pctOf(r.value, d.total_value)}
                </td>
              </tr>
            );
          }}
        </For>
      </Table>
    ),
    note: d.reversed_numbers.length
      ? `Reversed write-offs (${d.reversed_numbers.join(", ")}) are excluded because their reversal cancels them out.`
      : "Reversed write-offs are excluded because their reversal cancels them out.",
  };
}

function buildStockValue(d: StockValue, catName: string): Built {
  const archNote =
    d.archived_value > 0
      ? `Archived products are excluded (they still hold ${fmtMoney(d.archived_value)} of stock).`
      : "Archived products are excluded.";
  if (d.by === "product") {
    const ct = d.category_value;
    return {
      summary: (
        <div class="kpi-grid">
          <div class="kpi">
            <span class="kpi-label">{catName} value</span>
            <span class="kpi-value">{fmtMoney(ct)}</span>
            <span class="kpi-meta">
              {pctOf(ct, d.total_value)} of total {fmtMoney(d.total_value)}
            </span>
          </div>
          <div class="kpi">
            <span class="kpi-label">Active products</span>
            <span class="kpi-value">{d.category_count}</span>
            <span class="kpi-meta">{d.category_in_stock} in stock</span>
          </div>
        </div>
      ),
      chart: {
        title: "Value by product",
        items: d.rows.filter((r) => r.value > 0).map((r) => ({ label: r.product.name, value: r.value })),
      },
      table: (
        <Table
          caption="Stock value by product"
          head={[["Product"], ["Stock", true], ["Avg cost", true], ["Value", true], ["Share", true]]}
          foot={
            <tr>
              <td class="td-primary" colspan="3">
                Total · {countOf(d.rows.length, "product")}
              </td>
              <td class="num" data-label="Value">
                {fmtMoney(ct)}
              </td>
              <td class="num" data-label="Share">
                100.0%
              </td>
            </tr>
          }
        >
          <For each={d.rows}>
            {(r) => (
              <tr>
                <ProductCell p={r.product} />
                <td data-label="Stock" class="num">
                  {fmtQty(r.stock, r.product.unit)}
                </td>
                <td data-label="Avg cost" class="num">
                  {fmtMoney(r.avg_cost)}
                </td>
                <td data-label="Value" class="num fw-semibold">
                  {fmtMoney(r.value)}
                </td>
                <td data-label="Share" class="num">
                  {pctOf(r.value, ct)}
                </td>
              </tr>
            )}
          </For>
        </Table>
      ),
      note: archNote,
    };
  }
  const largest = d.rows.reduce((a, b) => (b.value > a.value ? b : a), d.rows[0]);
  const name = (c: Category | null) => (c ? c.name : UNCATEGORIZED);
  return {
    summary: (
      <div class="kpi-grid">
        <div class="kpi">
          <span class="kpi-label">
            <Icon name="dollar-sign" size={16} />
            Total stock value
          </span>
          <span class="kpi-value">{fmtMoney(d.total_value)}</span>
          <span class="kpi-meta">At average cost</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">
            <Icon name="box" size={16} />
            Active products
          </span>
          <span class="kpi-value">{d.active_count}</span>
          <span class="kpi-meta">{d.in_stock_count} in stock</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">
            <Icon name="layers" size={16} />
            Largest category
          </span>
          <span class="kpi-value">{largest ? pctOf(largest.value, d.total_value) : "0.0%"}</span>
          <span class="kpi-meta">{largest ? `${name(largest.category)} · ${fmtMoney(largest.value)}` : "—"}</span>
        </div>
      </div>
    ),
    chart: {
      title: "Value by category",
      items: d.rows.filter((r) => r.value > 0).map((r) => ({ label: name(r.category), value: r.value })),
    },
    table: (
      <Table
        caption="Stock value by category"
        head={[["Category"], ["Active products", true], ["Value", true], ["Share", true]]}
        foot={
          <tr>
            <td class="td-primary">Total</td>
            <td class="num" data-label="Active products">
              {d.active_count}
            </td>
            <td class="num" data-label="Value">
              {fmtMoney(d.total_value)}
            </td>
            <td class="num" data-label="Share">
              100.0%
            </td>
          </tr>
        }
      >
        <For each={d.rows}>
          {(r) => (
            <tr>
              <td class="td-primary" data-label="Category">
                {r.product_count === 0 ? (
                  <span class="muted">{name(r.category)}</span>
                ) : (
                  <span class="cell-title">{name(r.category)}</span>
                )}
              </td>
              <td data-label="Active products" class="num">
                {r.product_count}
              </td>
              <td data-label="Value" class="num fw-semibold">
                {fmtMoney(r.value)}
              </td>
              <td data-label="Share" class="num">
                {pctOf(r.value, d.total_value)}
              </td>
            </tr>
          )}
        </For>
      </Table>
    ),
    note: `Units differ between products, so quantities aren’t totalled. ${archNote}`,
  };
}

/* --------------------------------------------------------------- report view -- */

function ReportView(props: { def: ReportDef; categories: Loader<Category[]> }) {
  const def = props.def;
  const today = toIsoDate();
  const defaults = reportDefaults(def.id, today);
  const [filters, setFilters, resetFilters] = useListFilters<ReportParams>(defaults);

  createEffect(() => {
    document.title = `${def.label} · Reports · Inventory Manager`;
  });

  /* form inputs (applied on submit) */
  const [date, setDate] = createSignal(filters().date);
  const [from, setFrom] = createSignal(filters().from);
  const [to, setTo] = createSignal(filters().to);
  const [cat, setCat] = createSignal(filters().category_id);
  const syncInputs = (p: ReportParams) => {
    setDate(p.date);
    setFrom(p.from);
    setTo(p.to);
    setCat(p.category_id);
  };
  createEffect(on(filters, (p) => syncInputs(p), { defer: true }));

  const [paramError, setParamError] = createSignal<ParamError | null>(null);
  const [status, setStatus] = createSignal("");
  const [exporting, setExporting] = createSignal(false);
  let form: HTMLFormElement | undefined;
  let announce = false;

  const report = createLoader((signal) =>
    api.get<ReportData>(`/api/reports/${def.id}${qs(apiParams(def, filters()))}`, signal),
  );

  /* server-side parameter errors → inline under the parameters */
  createEffect(() => {
    const e = paramErrorFromApi(report.error());
    if (e) setParamError(e);
  });

  const catName = (id: string): string => {
    if (!id) return "All categories";
    if (id === "none") return "No category";
    const c = props.categories.data()?.find((x) => String(x.id) === id);
    if (c) return c.name;
    const label = (report.data() as { category_label?: string } | undefined)?.category_label;
    return label ?? "Selected category";
  };

  const header = createMemo(() => {
    const p = filters();
    const c = catName(p.category_id);
    switch (def.id) {
      case "stock-on-date":
        return {
          title: `Stock on ${fmtDate(p.date)}`,
          subtitle: `${c} · quantities at end of day · values at average cost on that day`,
        };
      case "movement":
        return {
          title: `Stock movement, ${rangeText(p.from, p.to)}`,
          subtitle: `${c} · reversals are netted against receipts and write-offs`,
        };
      case "low-stock":
        return { title: `Low stock as of ${fmtDate(today)}`, subtitle: `${c} · stock at or below minimum` };
      case "write-offs-by-reason":
        return {
          title: `Write-offs by reason, ${rangeText(p.from, p.to)}`,
          subtitle: `${c} · posted write-offs at average cost`,
        };
      default:
        return { title: `Stock value as of ${fmtDate(today)}`, subtitle: `${c} · active products at average cost` };
    }
  });

  const empty = () => {
    const d = report.data();
    return d !== undefined && isEmptyReport(def.id, d);
  };

  /* announce result after an Apply / reset */
  createEffect(
    on(report.loading, (loading, prev) => {
      if (!announce || loading || !prev) return;
      announce = false;
      if (report.state() === "error") return;
      setStatus(empty() ? "Report updated: no data for the selected parameters." : `Report updated: ${header().title}.`);
    }),
  );

  const current = (): ReportParams => ({ date: date(), from: from(), to: to(), category_id: cat() });

  const fieldEl = (field: ParamError["field"]): HTMLElement | null =>
    field && form ? form.querySelector<HTMLElement>(`#rp-${field === "category_id" ? "cat" : field}`) : null;

  const apply = (next: ReportParams) => {
    setParamError(null);
    setStatus("");
    announce = true;
    const prev = filters();
    const same = (["date", "from", "to", "category_id"] as const).every((k) => prev[k] === next[k]);
    if (same) void report.reload();
    else setFilters(next);
  };

  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    const next = current();
    const err = validateParams(def, next, today);
    if (err) {
      setParamError(err);
      fieldEl(err.field)?.focus();
      return;
    }
    apply(next);
  };

  const adjust = () => {
    const first = form?.querySelector<HTMLElement>("input, select");
    first?.focus();
    form?.scrollIntoView({ block: "start" });
  };
  const resetToDefaults = () => {
    syncInputs(defaults);
    setParamError(null);
    announce = true;
    const prev = filters();
    const same = (["date", "from", "to", "category_id"] as const).every((k) => prev[k] === defaults[k]);
    if (same) void report.reload();
    else resetFilters();
  };

  const exportCsv = async () => {
    const d = report.data();
    if (!d || exporting()) return;
    const title = header().title;
    const rows = rowCount(d);
    setExporting(true);
    try {
      const name = await api.download(
        `/api/reports/${def.id}${qs({ ...apiParams(def, filters()), format: "csv" })}`,
        `${def.id}.csv`,
      );
      toast({ type: "success", title: `${name} exported`, text: `${countOf(rows, "row")} · ${title}.` });
    } catch (err) {
      toast({
        type: "error",
        title: "Couldn’t export the report",
        text: err instanceof ApiError && !err.isNetworkError ? err.message : "Check your connection and try again.",
      });
    } finally {
      setExporting(false);
    }
  };

  const invalid = (field: ParamError["field"]) => paramError()?.field === field;
  const aria = (field: NonNullable<ParamError["field"]>) => ({
    "aria-invalid": invalid(field) ? ("true" as const) : undefined,
    "aria-describedby": invalid(field) ? "rp-err" : undefined,
  });

  const Field = (fp: { kind: ParamKind }): JSX.Element => {
    switch (fp.kind) {
      case "date":
        return (
          <div class="field">
            <label for="rp-date">Date</label>
            <input
              class="input"
              type="date"
              id="rp-date"
              max={today}
              required
              value={date()}
              onInput={(e) => setDate(e.currentTarget.value)}
              {...aria("date")}
            />
          </div>
        );
      case "from":
        return (
          <div class="field">
            <label for="rp-from">From</label>
            <input
              class="input"
              type="date"
              id="rp-from"
              max={today}
              required
              value={from()}
              onInput={(e) => setFrom(e.currentTarget.value)}
              {...aria("from")}
            />
          </div>
        );
      case "to":
        return (
          <div class="field">
            <label for="rp-to">To</label>
            <input
              class="input"
              type="date"
              id="rp-to"
              max={today}
              required
              value={to()}
              onInput={(e) => setTo(e.currentTarget.value)}
              {...aria("to")}
            />
          </div>
        );
      case "asof":
        return (
          <div class="field">
            <span class="field-label">As of</span>
            <p class="rp-static">Today · {fmtDate(today)}</p>
          </div>
        );
      default:
        return (
          <div class="field">
            <label for="rp-cat">Category</label>
            <select class="select" id="rp-cat" onChange={(e) => setCat(e.currentTarget.value)} {...aria("category_id")}>
              <option value="" selected={cat() === ""}>
                All categories
              </option>
              <For each={props.categories.data() ?? []}>
                {(c) => (
                  <option value={String(c.id)} selected={cat() === String(c.id)}>
                    {c.name}
                  </option>
                )}
              </For>
              <option value="none" selected={cat() === "none"}>
                No category
              </option>
            </select>
          </div>
        );
    }
  };

  const Header = (hp: { disabled: boolean }) => (
    <div class="card-header">
      <div>
        <h2 class="card-title" id="rp-title">
          {header().title}
        </h2>
        <p class="card-subtitle">{header().subtitle}</p>
      </div>
      <div class="card-actions">
        <button
          type="button"
          class="btn btn-secondary"
          id="rp-export"
          disabled={hp.disabled || exporting()}
          aria-busy={exporting() ? "true" : undefined}
          onClick={() => void exportCsv()}
        >
          <Icon name="download" size={18} />
          <span>{exporting() ? "Exporting…" : "Export CSV"}</span>
        </button>
      </div>
    </div>
  );

  const emptyText = () => {
    if (def.params.includes("from"))
      return "There’s nothing to show for this period and category. Try a wider period or another category.";
    if (def.params.includes("date"))
      return "There was no stock on this date for the selected category. Try a later date or another category.";
    if (!filters().category_id)
      return def.id === "low-stock"
        ? "No active products are at or below their minimum stock level."
        : "There are no active products yet. Add products and receive stock to see their value.";
    return "Nothing matches this category. Try another category or include all categories.";
  };

  const built = createMemo((): Built | null => {
    const d = report.data();
    if (!d || isEmptyReport(def.id, d)) return null;
    const p = filters();
    switch (def.id) {
      case "stock-on-date":
        return buildStockOnDate(d as StockOnDate, p);
      case "movement":
        return buildMovement(d as Movement, p);
      case "low-stock":
        return buildLowStock(d as LowStock);
      case "write-offs-by-reason":
        return buildWriteOffs(d as WriteOffsByReason);
      default:
        return buildStockValue(d as StockValue, catName(p.category_id));
    }
  });

  const errorStateFor = (err: ApiError | Error) => {
    const pe = paramErrorFromApi(err);
    if (pe)
      return (
        <ErrorState
          title="Couldn’t build the report"
          text={pe.message}
          actions={
            <>
              <button type="button" class="btn btn-primary" onClick={adjust}>
                Adjust parameters
              </button>
              <button type="button" class="btn btn-secondary" onClick={resetToDefaults}>
                Reset to defaults
              </button>
            </>
          }
        />
      );
    return <ErrorState text={errorText(err)} onRetry={() => void report.reload()} />;
  };

  return (
    <div class="stack">
      <form class="card" id="rp-form" novalidate aria-labelledby="rp-params-h" ref={form} onSubmit={onSubmit}>
        <div class="card-header is-plain">
          <div>
            <h2 class="card-title" id="rp-params-h">
              Parameters
            </h2>
            <p class="card-subtitle">{def.desc}</p>
          </div>
        </div>
        <div class="card-body">
          <div class="rp-params">
            <For each={def.params}>{(k) => <Field kind={k} />}</For>
            <div class="rp-apply">
              <button class="btn btn-primary" type="submit">
                Apply
              </button>
            </div>
          </div>
          <p class="error-text rp-params-error" id="rp-err" hidden={!paramError()}>
            <Icon name="alert-circle" size={16} />
            <span>{paramError()?.message}</span>
          </p>
        </div>
      </form>
      <p class="visually-hidden" role="status" id="rp-status">
        {status()}
      </p>
      <div id="rp-result">
        <Switch>
          <Match when={report.state() === "error" && report.error()}>
            {(err) => (
              <section class="card rp-result" aria-labelledby="rp-title">
                <Header disabled />
                {errorStateFor(err())}
              </section>
            )}
          </Match>
          <Match when={report.state() === "loading" || report.state() === "refreshing"}>
            <section class="card rp-result" aria-labelledby="rp-title" aria-busy="true">
              <Header disabled />
              <div class="card-body">
                <span class="skeleton skeleton-title" />
                <span class="skeleton skeleton-text is-medium" />
              </div>
              <SkeletonRows rows={8} cols={6} />
            </section>
          </Match>
          <Match when={empty()}>
            <section class="card rp-result" aria-labelledby="rp-title">
              <Header disabled />
              <EmptyState
                icon="bar-chart"
                title="No data for the selected parameters"
                text={emptyText()}
                actions={
                  <>
                    <button type="button" class="btn btn-primary" onClick={adjust}>
                      Adjust parameters
                    </button>
                    <button type="button" class="btn btn-secondary" onClick={resetToDefaults}>
                      Reset to defaults
                    </button>
                  </>
                }
              />
            </section>
          </Match>
          <Match when={built()}>
            {(b) => (
              <section class="card rp-result" aria-labelledby="rp-title">
                <Header disabled={false} />
                <div class="card-body stack">
                  {b().summary}
                  <Show when={b().chart}>
                    {(c) => (
                      <div>
                        <h3 class="rp-chart-title">{c().title}</h3>
                        <div id="rp-chart">
                          <HBarChart items={c().items} valueFormat="money" title={c().title} />
                        </div>
                      </div>
                    )}
                  </Show>
                </div>
                {b().table}
                <Show when={b().note}>
                  <div class="card-footer">
                    <p class="rp-note">{b().note}</p>
                  </div>
                </Show>
              </section>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- page -- */

export default function Reports() {
  const params = useParams();
  const navigate = useNavigate();
  const def = createMemo(() => REPORTS.find((r) => r.id === params.report));
  const categories = createLoader((signal) => api.get<Category[]>("/api/categories", signal));

  return (
    <AppShell active="reports" title="Reports">
      <div class="page-header">
        <div>
          <h1>Reports</h1>
          <p class="page-subtitle">
            Stock balances, movement, low stock, write-offs and stock value. Stock, write-off and adjustment values are
            at weighted average cost in USD.
          </p>
        </div>
      </div>
      <Show when={def()} keyed fallback={<Navigate href="/reports/stock-on-date" />}>
        {(r) => (
          <>
            <nav class="tabs rp-tabs" aria-label="Report type">
              <For each={REPORTS}>
                {(x) => (
                  <a
                    class={`tab${x.id === r.id ? " is-active" : ""}`}
                    href={`/reports/${x.id}`}
                    aria-current={x.id === r.id ? "page" : undefined}
                  >
                    {x.label}
                  </a>
                )}
              </For>
            </nav>
            <div class="field rp-switch-select">
              <label for="rp-switch">Report</label>
              <select class="select" id="rp-switch" onChange={(e) => navigate(`/reports/${e.currentTarget.value}`)}>
                <For each={REPORTS}>
                  {(x) => (
                    <option value={x.id} selected={x.id === r.id}>
                      {x.label}
                    </option>
                  )}
                </For>
              </select>
            </div>
            <ReportView def={r} categories={categories} />
          </>
        )}
      </Show>
    </AppShell>
  );
}
