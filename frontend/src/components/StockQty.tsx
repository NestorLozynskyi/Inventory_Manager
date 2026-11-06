import { Show } from "solid-js";
import { fmtQty } from "../lib/format";
import { Icon } from "./Icon";

/**
 * Quantity with an inline low-stock mark (TASK-004): "⚠ 27 pcs" in the warning colour on one line,
 * instead of a separate "Low stock" badge above/below the value (keeps table rows the same height).
 * The state stays available to screen readers (visually hidden text) and as a tooltip.
 */
export function StockQty(props: { qty: number; unit?: string; low?: boolean; class?: string }) {
  const out = () => props.low && props.qty <= 0;
  const label = () => (out() ? "Out of stock" : "Low stock");
  return (
    <Show
      when={props.low}
      fallback={<span class={`stock-qty${props.class ? ` ${props.class}` : ""}`}>{fmtQty(props.qty, props.unit)}</span>}
    >
      <span
        class={`stock-qty is-low${out() ? " is-out" : ""}${props.class ? ` ${props.class}` : ""}`}
        title={label()}
      >
        <Icon name="alert-triangle" size={14} />
        <span class="visually-hidden">{label()}: </span>
        {fmtQty(props.qty, props.unit)}
      </span>
    </Show>
  );
}
