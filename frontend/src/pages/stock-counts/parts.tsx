/** Markup pieces shared by the stock count views (screens/stock-count.html helpers). */
import { Show, type JSX } from "solid-js";
import { Badge } from "../../components/Badge";
import { Icon } from "../../components/Icon";
import { fmtMoney, fmtSignedMoney, fmtSignedQty } from "../../lib/format";
import { pl, signCls, type CountTotals, type ProductRef } from "./stockCount";

export function Breadcrumb(props: { current: string }): JSX.Element {
  return (
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <ol>
        <li>
          <a href="/stock-counts">Stock counts</a>
        </li>
        <li aria-current="page">{props.current}</li>
      </ol>
    </nav>
  );
}

export function ProductCell(props: { p: ProductRef }): JSX.Element {
  return (
    <td class="td-primary" data-label="Product">
      <span class="cell-title">
        <a class="cell-link" href={`/products/${props.p.id}`}>
          {props.p.name}
        </a>
      </span>
      <span class="cell-sub mono">
        {props.p.sku}
        {props.p.archived ? " · Archived" : ""}
      </span>
    </td>
  );
}

export function DiffQty(props: { counted: boolean; diff: number; unit: string }): JSX.Element {
  return (
    <Show when={props.counted} fallback={<span class="badge badge-neutral">Not counted</span>}>
      <Show
        when={props.diff !== 0}
        fallback={<span class="muted">No difference</span>}
      >
        <span class="sc-flag">
          <Badge kind={props.diff > 0 ? "surplus" : "shortage"} />
          <span class={`fw-semibold ${props.diff > 0 ? "text-success" : "text-danger"}`}>
            {fmtSignedQty(props.diff, props.unit)}
          </span>
        </span>
      </Show>
    </Show>
  );
}

export function DiffValue(props: { counted: boolean; val: number }): JSX.Element {
  return (
    <Show
      when={props.counted}
      fallback={
        <span class="muted" aria-label="Not counted">
          —
        </span>
      }
    >
      <Show when={props.val !== 0} fallback={<span class="muted">{fmtMoney(0)}</span>}>
        <span class={`fw-semibold ${signCls(props.val)}`}>{fmtSignedMoney(props.val)}</span>
      </Show>
    </Show>
  );
}

export function Kpis(props: { t: CountTotals; posted?: boolean }): JSX.Element {
  const pct = () => (props.t.total ? Math.round((props.t.counted / props.t.total) * 100) : 0);
  return (
    <>
      <Show
        when={props.posted}
        fallback={
          <div class="kpi">
            <span class="kpi-label">
              <Icon name="clipboard-check" size={16} />
              Counted
            </span>
            <span class="kpi-value">
              {props.t.counted} of {props.t.total}
            </span>
            <span class="kpi-meta">
              {props.t.notCounted ? `${pl(props.t.notCounted, "item")} not counted` : "All items counted"}
            </span>
            <div class="sc-progress" aria-hidden="true">
              <span style={{ width: `${pct()}%` }} />
            </div>
          </div>
        }
      >
        <div class="kpi">
          <span class="kpi-label">
            <Icon name="check-circle" size={16} />
            Items unchanged
          </span>
          <span class="kpi-value">{props.t.unchanged}</span>
          <span class="kpi-meta">of {pl(props.t.counted, "item")} counted</span>
        </div>
      </Show>
      <div class="kpi">
        <span class="kpi-label">
          <Icon name="trending-up" size={16} />
          Surplus
        </span>
        <span class="kpi-value">{fmtSignedMoney(props.t.surplusV)}</span>
        <span class="kpi-delta is-positive">
          <Badge kind="surplus" label={pl(props.t.surplusN, "item")} />
        </span>
      </div>
      <div class="kpi">
        <span class="kpi-label">
          <Icon name="trending-down" size={16} />
          Shortage
        </span>
        <span class="kpi-value">{fmtSignedMoney(props.t.shortageV)}</span>
        <span class="kpi-delta is-negative">
          <Badge kind="shortage" label={pl(props.t.shortageN, "item")} />
        </span>
      </div>
      <div class="kpi">
        <span class="kpi-label">
          <Icon name="dollar-sign" size={16} />
          Net change
        </span>
        <span class="kpi-value">{fmtSignedMoney(props.t.net)}</span>
        <span class="kpi-meta">{props.posted ? "At average cost at posting" : "At average cost"}</span>
      </div>
    </>
  );
}
