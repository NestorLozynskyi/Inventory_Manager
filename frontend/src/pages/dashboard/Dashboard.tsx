/** Dashboard — screens/dashboard.html (states: default, loading, error, empty for a new account). */
import { For, Match, Show, Switch, type JSX } from "solid-js";
import { ApiError, api, qs } from "../../api/client";
import { AppShell } from "../../components/AppShell";
import { BarChart, HBarChart } from "../../components/Charts";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { SkeletonRows } from "../../components/SkeletonRows";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, fmtSignedQty, plural } from "../../lib/format";
import { createLoader } from "../../lib/resource";
import { useListFilters } from "../../lib/url";
import "./Dashboard.css";
import { StockQty } from "../../components/StockQty";

/* ------------------------------------------------------------------ API types -- */

export interface DashProduct {
  id: number;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  min_stock: number | null;
}

export interface DashMovement {
  id: number;
  at: string;
  type: string;
  document: { id: number; kind: string; number: string };
  product: { id: number; sku: string; name: string; unit: string };
  qty_change: number;
}

export interface DashboardData {
  today: string;
  kpis: {
    stock_value: number;
    active_products: number;
    archived_products: number;
    low_stock_count: number;
    received_30d: number;
    receipts_30d: number;
    written_off_30d: number;
    write_offs_30d: number;
  };
  weeks: { start: string; label: string; receipts: number; write_offs: number }[];
  by_reason: { reason: string; value: number }[];
  period: { from: string; to: string };
  low_stock: { items: DashProduct[]; total: number };
  recent: DashMovement[];
}

/* ---------------------------------------------------------------- helpers -- */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026-11-05" → "Thursday, Nov 5, 2026". */
export function longDate(isoDay: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay);
  if (!m) return "";
  const wd = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return `${WEEKDAYS[wd]}, ${fmtDate(isoDay.slice(0, 10))}`;
}

function localIsoDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Link of a movement's document by document kind. */
export function documentHref(doc: { id: number | string; kind: string }): string {
  switch (doc.kind) {
    case "receipt":
      return `/receipts/${doc.id}`;
    case "write_off":
      return `/write-offs/${doc.id}`;
    case "receipt_reversal":
    case "write_off_reversal":
      return `/reversals/${doc.id}`;
    case "stock_count":
      return `/stock-counts/${doc.id}`;
    default:
      return "/history";
  }
}

export function movementTypeLabel(type: string): string {
  return (
    ({ receipt: "Receipt", write_off: "Write-off", stock_count: "Stock count adjustment", reversal: "Reversal" } as Record<
      string,
      string
    >)[type] ?? type
  );
}

/** A brand-new account: nothing in the catalogue and no stock movements yet. */
export function isNewAccount(d: DashboardData): boolean {
  return d.kpis.active_products + d.kpis.archived_products === 0 && d.recent.length === 0;
}

const n = (count: number, one: string, many: string) => `${count} ${plural(count, one, many)}`;

export const LOW_STOCK_HREF = "/products?low_stock=1";

/* ------------------------------------------------------------------- parts -- */

function Kpis(props: { d: DashboardData; empty?: boolean }): JSX.Element {
  const k = () => props.d.kpis;
  return (
    <section aria-labelledby="kpi-h">
      <h2 id="kpi-h" class="visually-hidden">
        Key figures
      </h2>
      <div class="kpi-grid dash-kpis">
        <a class="kpi" href="/reports/stock-value">
          <span class="kpi-label">
            <Icon name="dollar-sign" size={16} />
            Total stock value
          </span>
          <span class="kpi-value">{fmtMoney(k().stock_value)}</span>
          <span class="kpi-meta">At average cost</span>
        </a>
        <a class="kpi" href="/products">
          <span class="kpi-label">
            <Icon name="box" size={16} />
            Active products
          </span>
          <span class="kpi-value">{k().active_products}</span>
          <span class="kpi-meta">
            {props.empty ? "No products yet" : n(k().archived_products, "archived product", "archived products")}
          </span>
        </a>
        <a class="kpi" href={LOW_STOCK_HREF}>
          <span class="kpi-label">
            <Icon name="alert-triangle" size={16} />
            Low stock items
          </span>
          <span class="kpi-value">{k().low_stock_count}</span>
          <Show when={k().low_stock_count > 0} fallback={<span class="kpi-meta">All above minimum</span>}>
            <span class="kpi-delta is-warning">
              <Icon name="alert-triangle" size={16} />
              At or below minimum
            </span>
          </Show>
        </a>
        <a class="kpi" href="/receipts">
          <span class="kpi-label">
            <Icon name="arrow-down-to-line" size={16} />
            Received · last 30 days
          </span>
          <span class="kpi-value">{fmtMoney(k().received_30d)}</span>
          <span class="kpi-meta">{n(k().receipts_30d, "posted receipt", "posted receipts")}</span>
        </a>
        <a class="kpi" href="/write-offs">
          <span class="kpi-label">
            <Icon name="arrow-up-from-line" size={16} />
            Written off · last 30 days
          </span>
          <span class="kpi-value">{fmtMoney(k().written_off_30d)}</span>
          <span class="kpi-meta">{n(k().write_offs_30d, "posted write-off", "posted write-offs")} · at average cost</span>
        </a>
      </div>
    </section>
  );
}

function Charts(props: { d: DashboardData; weeks: number; onWeeks: (w: number) => void }): JSX.Element {
  const hasBars = () => props.d.weeks.some((w) => w.receipts > 0 || w.write_offs > 0);
  const hasReasons = () => props.d.by_reason.some((r) => r.value > 0);
  return (
    <div class="dash-charts">
      <section class="card" aria-labelledby="ch1-h">
        <div class="card-header">
          <div>
            <h2 class="card-title" id="ch1-h">
              Receipts vs write-offs
            </h2>
            <p class="card-subtitle" id="ch1-sub">
              Last {props.d.weeks.length} weeks · receipts at receipt prices, write-offs at average cost
            </p>
          </div>
          <div class="card-actions">
            <div class="segmented" role="group" aria-label="Chart period">
              <For each={[4, 8]}>
                {(w) => (
                  <button type="button" data-weeks={w} aria-pressed={props.weeks === w ? "true" : "false"} onClick={() => props.onWeeks(w)}>
                    {w} weeks
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
        <div class="card-body">
          <div id="chart-bars">
            <Show
              when={hasBars()}
              fallback={<div class="chart-empty">No receipts or write-offs in the last {props.d.weeks.length} weeks</div>}
            >
              <BarChart
                title={`Receipts vs write-offs, last ${props.d.weeks.length} weeks`}
                categories={props.d.weeks.map((w) => w.label)}
                series={[
                  { name: "Receipts", color: "var(--chart-1)", values: props.d.weeks.map((w) => w.receipts) },
                  { name: "Write-offs", color: "var(--chart-2)", values: props.d.weeks.map((w) => w.write_offs) },
                ]}
                valueFormat="money"
                height={260}
              />
            </Show>
          </div>
        </div>
      </section>
      <section class="card" aria-labelledby="ch2-h">
        <div class="card-header">
          <div>
            <h2 class="card-title" id="ch2-h">
              Write-offs by reason
            </h2>
            <p class="card-subtitle">
              Last 30 days · {fmtDate(props.d.period.from)} – {fmtDate(props.d.period.to)}
            </p>
          </div>
          <div class="card-actions">
            <a class="link-subtle text-sm" href="/reports/write-offs-by-reason">
              View report
            </a>
          </div>
        </div>
        <div class="card-body">
          <div id="chart-hbars">
            <Show when={hasReasons()} fallback={<div class="chart-empty">No write-offs in the last 30 days</div>}>
              <HBarChart
                title="Write-offs by reason, last 30 days"
                items={props.d.by_reason.map((r) => ({ label: r.reason, value: r.value }))}
                valueFormat="money"
              />
            </Show>
          </div>
        </div>
      </section>
    </div>
  );
}

function LowStockCard(props: { d: DashboardData; empty?: boolean }): JSX.Element {
  const items = () => props.d.low_stock.items;
  return (
    <section class="card" aria-labelledby="low-h">
      <div class="card-header">
        <div>
          <h2 class="card-title" id="low-h">
            Low stock
          </h2>
          <p class="card-subtitle">Stock at or below minimum</p>
        </div>
      </div>
      <Show
        when={items().length > 0}
        fallback={
          <div class="card-body">
            <EmptyState
              icon="check-circle"
              compact
              title={props.empty ? "No products yet" : "No low stock"}
              text={
                props.empty
                  ? "Products with a minimum stock level will show up here when they run low."
                  : "All products are above their minimum stock."
              }
            />
          </div>
        }
      >
        <ul class="low-list">
          <For each={items()}>
            {(p) => (
              <li>
                <div class="ll-main">
                  <a href={`/products/${p.id}`}>{p.name}</a>
                  <span class="text-xs muted mono">{p.sku}</span>
                </div>
                <div class="ll-side">
                  <span class="ll-qty">
                    <StockQty qty={p.stock} unit={p.unit} low />{" "}
                    <span class="muted">/ min {fmtQty(p.min_stock, p.unit)}</span>
                  </span>
                </div>
              </li>
            )}
          </For>
        </ul>
        <div class="card-footer">
          <span class="text-sm muted">
            Showing {items().length} of {props.d.low_stock.total}
          </span>
          <a class="link-subtle text-sm" href={LOW_STOCK_HREF}>
            View all low-stock products
          </a>
        </div>
      </Show>
    </section>
  );
}

function RecentCard(props: { d: DashboardData }): JSX.Element {
  const list = () => props.d.recent;
  return (
    <section class="card" aria-labelledby="rec-h">
      <div class="card-header">
        <div>
          <h2 class="card-title" id="rec-h">
            Recent operations
          </h2>
          <p class="card-subtitle">Latest stock movements across all documents</p>
        </div>
      </div>
      <Show
        when={list().length > 0}
        fallback={
          <div class="card-body">
            <EmptyState
              icon="history"
              compact
              title="No operations yet"
              text="Posted receipts, write-offs and stock counts will appear here."
            />
          </div>
        }
      >
        <div class="table-wrap">
          <table class="table table-cards recent-table">
            <caption class="visually-hidden">Last {list().length} stock movements</caption>
            <thead>
              <tr>
                <th scope="col" class="col-fit">
                  Date
                </th>
                <th scope="col" class="col-grow">
                  Product
                </th>
                <th scope="col">Type</th>
                <th scope="col" class="col-fit">
                  Document
                </th>
                <th scope="col" class="num col-fit">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={list()}>
                {(m) => {
                  const cls = m.qty_change > 0 ? "text-success" : m.qty_change < 0 ? "text-danger" : "";
                  return (
                    <tr>
                      <td data-label="Date" class="nowrap col-fit">
                        {fmtDateTime(m.at)}
                      </td>
                      <td class="td-primary col-grow" data-label="Product">
                        <a class="cell-link" href={`/products/${m.product.id}`}>
                          {m.product.name}
                        </a>
                        <span class="cell-sub mono">{m.product.sku}</span>
                      </td>
                      <td data-label="Type">{movementTypeLabel(m.type)}</td>
                      <td data-label="Document" class="col-fit">
                        <a class="link mono" href={documentHref(m.document)}>
                          {m.document.number}
                        </a>
                      </td>
                      <td data-label="Change" class="num col-fit">
                        <span class={`fw-semibold ${cls}`}>{fmtSignedQty(m.qty_change, m.product.unit)}</span>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
        <div class="card-footer">
          <span class="text-sm muted">Last {list().length} movements</span>
          <a class="link-subtle text-sm" href="/history">
            View history
          </a>
        </div>
      </Show>
    </section>
  );
}

function SkeletonKpi(): JSX.Element {
  return (
    <div class="kpi">
      <div class="dash-skel-kpi" aria-hidden="true">
        <span class="skeleton skeleton-text is-medium" />
        <span class="skeleton skeleton-title" />
        <span class="skeleton skeleton-text is-short" />
      </div>
    </div>
  );
}

function SkeletonChart(): JSX.Element {
  return (
    <div class="card">
      <div class="card-body" aria-hidden="true">
        <span class="skeleton skeleton-text is-medium" />
        <span class="skeleton skeleton-block" style={{ height: "260px", "margin-top": "var(--sp-4)" }} />
      </div>
    </div>
  );
}

function DashboardSkeleton(): JSX.Element {
  return (
    <div class="stack-lg" aria-busy="true">
      <span class="visually-hidden" role="status">
        Loading dashboard…
      </span>
      <div class="kpi-grid dash-kpis">
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
      </div>
      <div class="dash-charts">
        <SkeletonChart />
        <SkeletonChart />
      </div>
      <div class="dash-bottom">
        <div class="card">
          <div class="card-body" aria-hidden="true">
            <SkeletonRows rows={5} cols={3} />
          </div>
        </div>
        <div class="card">
          <div class="card-body" aria-hidden="true">
            <SkeletonRows rows={8} cols={5} />
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyDashboard(props: { d: DashboardData }): JSX.Element {
  return (
    <>
      <Kpis d={props.d} empty />
      <section class="card" aria-label="Get started">
        <div class="card-body">
          <EmptyState
            icon="box"
            title="Your inventory is empty"
            text="Add products to your catalogue, then record a receipt to bring stock in. Your stock value, charts and recent operations will appear here."
            actions={
              <>
                <a class="btn btn-primary" href="/products/new">
                  <Icon name="plus" size={18} />
                  <span>Add your first product</span>
                </a>
                <a class="btn btn-secondary" href="/receipts/new">
                  <Icon name="arrow-down-to-line" size={18} />
                  <span>Create a receipt</span>
                </a>
              </>
            }
          />
        </div>
      </section>
      <div class="dash-charts">
        <section class="card" aria-labelledby="ch1-h">
          <div class="card-header">
            <div>
              <h2 class="card-title" id="ch1-h">
                Receipts vs write-offs
              </h2>
              <p class="card-subtitle">Last {props.d.weeks.length || 8} weeks</p>
            </div>
          </div>
          <div class="card-body">
            <div class="chart-empty">No receipts or write-offs yet</div>
          </div>
        </section>
        <section class="card" aria-labelledby="ch2-h">
          <div class="card-header">
            <div>
              <h2 class="card-title" id="ch2-h">
                Write-offs by reason
              </h2>
              <p class="card-subtitle">Last 30 days</p>
            </div>
          </div>
          <div class="card-body">
            <div class="chart-empty">No write-offs yet</div>
          </div>
        </section>
      </div>
      <div class="dash-bottom">
        <LowStockCard d={props.d} empty />
        <RecentCard d={props.d} />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------- page -- */

export default function Dashboard(): JSX.Element {
  const [filters, setFilters] = useListFilters({ weeks: 8 });
  const weeks = () => (filters().weeks === 4 ? 4 : 8);
  const dash = createLoader((signal) => api.get<DashboardData>(`/api/dashboard${qs({ weeks: weeks() })}`, signal));

  const subtitle = () => longDate(dash.data()?.today ?? localIsoDay());
  const errText = () => {
    const e = dash.error();
    if (e instanceof ApiError && !e.isNetworkError && e.status > 0 && e.status < 500 && e.code !== "http_error") return e.message;
    return "We couldn’t reach the server to load your stock figures. Check your connection and try again.";
  };

  return (
    <AppShell active="dashboard" title="Dashboard">
      <div class="page-header">
        <div>
          <h1>Dashboard</h1>
          <p class="page-subtitle" id="dash-sub">
            {subtitle()}
          </p>
        </div>
        <div class="page-actions">
          <a class="btn btn-primary" href="/receipts/new">
            <Icon name="arrow-down-to-line" size={18} />
            <span>New receipt</span>
          </a>
          <a class="btn btn-secondary" href="/write-offs/new">
            <Icon name="arrow-up-from-line" size={18} />
            <span>New write-off</span>
          </a>
        </div>
      </div>
      <div id="dash-root" class="stack-lg" aria-busy={dash.state() === "refreshing" ? "true" : undefined}>
        <Switch>
          <Match when={dash.state() === "error"}>
            <div class="card">
              <div class="card-body">
                <ErrorState
                  title="Couldn’t load the dashboard"
                  text={errText()}
                  actions={
                    <button type="button" class="btn btn-secondary" onClick={() => void dash.reload({ reset: true })}>
                      <Icon name="refresh-cw" size={18} />
                      <span>Retry</span>
                    </button>
                  }
                />
              </div>
            </div>
          </Match>
          <Match when={dash.state() === "loading"}>
            <DashboardSkeleton />
          </Match>
          <Match when={dash.data()}>
            {(d) => (
              <Show
                when={!isNewAccount(d())}
                fallback={<EmptyDashboard d={d()} />}
              >
                <Kpis d={d()} />
                <Charts d={d()} weeks={weeks()} onWeeks={(w) => setFilters({ weeks: w })} />
                <div class="dash-bottom">
                  <LowStockCard d={d()} />
                  <RecentCard d={d()} />
                </div>
              </Show>
            )}
          </Match>
        </Switch>
      </div>
    </AppShell>
  );
}
