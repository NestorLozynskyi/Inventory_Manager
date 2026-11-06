import { For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { AppShell } from "../../components/AppShell";
import { api } from "../../api/client";
import { createLoader } from "../../lib/resource";
import { LoadView } from "../../components/LoadView";
import { EmptyState } from "../../components/EmptyState";
import { SkeletonRows } from "../../components/SkeletonRows";
import { StatusBadge } from "../../components/Badge";
import { Icon } from "../../components/Icon";
import { fmtDateTime, fmtSignedMoney } from "../../lib/format";
import { docDate, scopeLabel, signCls, type StockCountSummary } from "./stockCount";
import "./StockCountList.css";

/** Row click navigates (links, buttons and form controls inside keep their own behaviour). */
export function rowLinkHandler(navigate: (to: string) => void, href: string) {
  return (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t || t.closest("a, button, input, select, textarea, label, [role='menuitem']")) return;
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
    else navigate(href);
  };
}

function CountRow(props: { sc: StockCountSummary }) {
  const navigate = useNavigate();
  const sc = () => props.sc;
  const url = () => `/stock-counts/${sc().id}`;
  const draft = () => sc().status === "draft";
  const net = () => sc().net_value;
  const diffLabel = () => (net() > 0 ? "Net surplus " : net() < 0 ? "Net shortage " : "No net change ");
  return (
    <tr class="row-link" data-href={url()} onClick={rowLinkHandler(navigate, url())}>
      <td class="td-primary" data-label="Number">
        <a class="cell-link mono" href={url()}>
          {sc().number}
        </a>
        <Show when={sc().note}>
          <span class="cell-sub">{sc().note}</span>
        </Show>
      </td>
      <td data-label="Date" class="nowrap">
        {fmtDateTime(docDate(sc()))}
        <span class="cell-sub">{draft() ? "Created" : "Posted"}</span>
      </td>
      <td data-label="Scope">{scopeLabel(sc())}</td>
      <td data-label="Items counted" class="num">
        <div class="scl-progress">
          <span>
            {sc().counted} of {sc().line_count}
          </span>
          <Show when={sc().counted < sc().line_count}>
            <span class="cell-sub">{sc().line_count - sc().counted} not counted</span>
          </Show>
        </div>
      </td>
      <td data-label="Difference value" class="num">
        <div class="scl-diff">
          <span class={`fw-semibold ${signCls(net())}`}>
            <span class="visually-hidden">{diffLabel()}</span>
            {fmtSignedMoney(net())}
          </span>
          <span class="cell-sub">
            {sc().surplus_count} surplus · {sc().shortage_count} shortage{draft() ? " · so far" : ""}
          </span>
        </div>
      </td>
      <td data-label="Status">
        <StatusBadge doc={sc()} />
      </td>
    </tr>
  );
}

export default function StockCountList() {
  const counts = createLoader((signal) => api.get<{ items: StockCountSummary[] }>("/api/stock-counts", signal));

  return (
    <AppShell active="stock-counts" title="Stock counts">
      <div class="page-header">
        <div>
          <h1>Stock counts</h1>
          <p class="page-subtitle">
            Compare book quantities with what’s on the shelves, then post the differences as stock adjustments.
          </p>
        </div>
        <div class="page-actions">
          <a class="btn btn-primary" href="/stock-counts/new">
            <Icon name="plus" size={18} />
            <span>New stock count</span>
          </a>
        </div>
      </div>
      <div class="card">
        <LoadView
          loader={counts}
          skeleton={<SkeletonRows rows={6} cols={6} />}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <EmptyState
              icon="clipboard-check"
              title="No stock counts yet"
              text="Start a stock count to compare book quantities with actual stock. Posting a count adjusts stock and records every change in History."
              actions={
                <a class="btn btn-primary" href="/stock-counts/new">
                  <Icon name="plus" size={18} />
                  <span>New stock count</span>
                </a>
              }
            />
          }
        >
          {(d) => (
            <>
              <div class="table-wrap">
                <table class="table table-cards">
                  <caption class="visually-hidden">Stock counts, newest first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Number</th>
                      <th scope="col">Date</th>
                      <th scope="col">Scope</th>
                      <th scope="col" class="num">
                        Items counted
                      </th>
                      <th scope="col" class="num">
                        Difference value
                      </th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={d().items}>{(sc) => <CountRow sc={sc} />}</For>
                  </tbody>
                </table>
              </div>
              <div class="card-footer">
                <span class="hint">
                  {d().items.length} {d().items.length === 1 ? "stock count" : "stock counts"} · date = created
                  (drafts) or posted · difference value at average cost (+ surplus, − shortage) · drafts update live
                </span>
              </div>
            </>
          )}
        </LoadView>
      </div>
    </AppShell>
  );
}
