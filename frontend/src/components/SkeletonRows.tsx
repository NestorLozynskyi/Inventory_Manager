/** Table loading placeholder — same markup as IM.skeletonRows (app.js). */
import { For, type JSX } from "solid-js";

export function SkeletonRows(props: { rows?: number; cols?: number }): JSX.Element {
  const rows = () => Array.from({ length: props.rows ?? 6 });
  const cols = () => Array.from({ length: props.cols ?? 5 }, (_, c) => c);
  return (
    <div aria-busy="true">
      <span class="visually-hidden" role="status">
        Loading…
      </span>
      <For each={rows()}>
        {() => (
          <div class="skeleton-row" aria-hidden="true">
            <For each={cols()}>
              {(c) => <span class={`skeleton${c === 0 ? " is-narrow" : c === 1 ? " is-wide" : ""}`} />}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
