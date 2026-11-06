/** Posted stock count — read-only; book qty, difference and value as at posting (screens/stock-count.html?state=posted). */
import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import { StatusBadge } from "../../components/Badge";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/EmptyState";
import { fmtDateTime, fmtQty } from "../../lib/format";
import { Breadcrumb, DiffQty, DiffValue, Kpis, ProductCell } from "./parts";
import { pl, scopeLabel, type CountTotals, type StockCount } from "./stockCount";

export function StockCountPosted(props: { doc: StockCount }): JSX.Element {
  const sc = () => props.doc;
  const [showAll, setShowAll] = createSignal(false);
  const lines = createMemo(() =>
    sc().lines.map((l) => ({
      l,
      counted: l.actual_qty != null,
      diff: l.difference ?? 0,
      val: l.value ?? 0,
    })),
  );
  const totals = createMemo<CountTotals>(() => {
    const d = sc();
    const counted = d.counted;
    return {
      total: d.line_count,
      counted,
      notCounted: d.line_count - counted,
      unchanged: counted - d.surplus_count - d.shortage_count,
      surplusN: d.surplus_count,
      surplusV: d.surplus_value,
      shortageN: d.shortage_count,
      shortageV: d.shortage_value,
      net: d.net_value,
      invalid: 0,
    };
  });
  const diffCount = () => sc().surplus_count + sc().shortage_count;
  const histUrl = () => `/history?doc=${encodeURIComponent(sc().number)}`;
  const shown = createMemo(() => lines().filter((x) => showAll() || (x.counted && x.diff !== 0)));
  const subtitle = () => {
    if (showAll()) return `Showing all ${pl(lines().length, "item")}`;
    const t = totals();
    const hidden = lines().length - shown().length;
    const what = t.notCounted ? "unchanged or not counted" : "unchanged";
    return `Showing ${pl(shown().length, "item")} with differences · ${hidden} ${what} hidden`;
  };

  return (
    <>
      <div class="page-header">
        <div>
          <Breadcrumb current={sc().number} />
          <div class="page-title-row">
            <h1>Stock count {sc().number}</h1>
            <StatusBadge doc={sc()} />
          </div>
          <p class="page-subtitle">
            {scopeLabel(sc())} · Posted {fmtDateTime(sc().posted_at)}
          </p>
        </div>
        <div class="page-actions">
          <a class="btn btn-secondary" href={histUrl()}>
            <Icon name="history" size={18} />
            <span>View in History</span>
          </a>
        </div>
      </div>
      <div class="stack">
        <div class="alert alert-success" role="status">
          <span class="alert-icon">
            <Icon name="check-circle" size={20} />
          </span>
          <div class="alert-content">
            <p class="alert-title">Posted on {fmtDateTime(sc().posted_at)}</p>
            <p class="alert-body">
              Stock of each counted item was set to its actual quantity — {pl(diffCount(), "item")} changed.
              {totals().notCounted ? ` ${pl(totals().notCounted, "item")} not counted kept ${totals().notCounted === 1 ? "its" : "their"} stock.` : ""}{" "}
              Differences were recorded against stock at the moment of posting and added to History. Posted stock counts
              can’t be edited.
            </p>
            <Show when={diffCount() > 0}>
              <div class="alert-actions">
                <a class="link" href={histUrl()}>
                  See {pl(diffCount(), "movement")} for {sc().number} in History
                </a>
              </div>
            </Show>
          </div>
        </div>
        <section class="card" aria-labelledby="sc-details-h">
          <div class="card-header">
            <h2 class="card-title" id="sc-details-h">
              Details
            </h2>
          </div>
          <div class="card-body">
            <dl class="meta-list">
              <div>
                <dt>Created</dt>
                <dd>{fmtDateTime(sc().created_at)}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>{scopeLabel(sc())}</dd>
              </div>
              <div>
                <dt>Posted</dt>
                <dd>{fmtDateTime(sc().posted_at)}</dd>
              </div>
              <div>
                <dt>Items counted</dt>
                <dd>
                  {totals().counted} of {totals().total}
                </dd>
              </div>
              <div>
                <dt>Note</dt>
                <dd>
                  <Show when={sc().note} fallback={<span class="muted">—</span>}>
                    {sc().note}
                  </Show>
                </dd>
              </div>
            </dl>
          </div>
        </section>
        <section class="kpi-grid" aria-label="Count summary">
          <Kpis t={totals()} posted />
        </section>
        <section class="card" aria-labelledby="sc-lines-h">
          <div class="card-header">
            <div>
              <h2 class="card-title" id="sc-lines-h">
                Count lines
              </h2>
              <p class="card-subtitle" id="sc-lines-sub" aria-live="polite">
                {subtitle()}
              </p>
            </div>
            <div class="sc-switch-row">
              <label class="switch">
                <input
                  type="checkbox"
                  role="switch"
                  id="sc-showall"
                  checked={showAll()}
                  onChange={(e) => setShowAll(e.currentTarget.checked)}
                />
                <span class="switch-track" aria-hidden="true" />
                <span class="switch-label">Show all items</span>
              </label>
            </div>
          </div>
          <div class="table-wrap" hidden={shown().length === 0}>
            <table class="table table-cards sc-table">
              <caption class="visually-hidden">Count lines of {sc().number} (read-only)</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Unit</th>
                  <th scope="col" class="num">
                    Book qty at posting
                  </th>
                  <th scope="col" class="num">
                    Actual qty
                  </th>
                  <th scope="col" class="num">
                    Difference qty
                  </th>
                  <th scope="col" class="num">
                    Difference (avg cost)
                  </th>
                </tr>
              </thead>
              <tbody id="sc-body">
                <For each={shown()}>
                  {(x) => (
                    <tr>
                      <ProductCell p={x.l.product} />
                      <td data-label="Unit">{x.l.product.unit}</td>
                      <td data-label="Book qty at posting" class="num">
                        {fmtQty(x.l.book_qty, x.l.product.unit)}
                      </td>
                      <td data-label="Actual qty" class="num fw-semibold">
                        <Show when={x.counted} fallback={<span class="muted">—</span>}>
                          {fmtQty(x.l.actual_qty, x.l.product.unit)}
                        </Show>
                      </td>
                      <td data-label="Difference qty" class="num">
                        <DiffQty counted={x.counted} diff={x.diff} unit={x.l.product.unit} />
                      </td>
                      <td data-label="Difference (avg cost)" class="num">
                        <DiffValue counted={x.counted} val={x.val} />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <Show when={shown().length === 0}>
            <EmptyState
              icon="check-circle"
              compact
              title="No differences"
              text="Every counted item matched its book quantity. Turn on “Show all items” to see them."
            />
          </Show>
        </section>
      </div>
    </>
  );
}
