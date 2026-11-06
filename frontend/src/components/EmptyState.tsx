/** Empty state — same markup as IM.emptyState (app.js). */
import { Show, type JSX } from "solid-js";
import { Icon, type IconName } from "./Icon";

export interface EmptyStateProps {
  icon?: IconName;
  title?: string;
  text?: JSX.Element;
  actions?: JSX.Element;
  compact?: boolean;
}

export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div class={`empty-state${props.compact ? " is-compact" : ""}`}>
      <span class="empty-state-icon">
        <Icon name={props.icon ?? "box"} size={24} />
      </span>
      <h2 class="empty-state-title">{props.title ?? "Nothing here yet"}</h2>
      <Show when={props.text}>
        <p class="empty-state-text">{props.text}</p>
      </Show>
      <Show when={props.actions}>
        <div class="empty-state-actions">{props.actions}</div>
      </Show>
    </div>
  );
}
