/** Error state — same markup as IM.errorState (app.js); default action is "Try again". */
import { Show, type JSX } from "solid-js";
import { Icon } from "./Icon";

export interface ErrorStateProps {
  title?: string;
  text?: JSX.Element;
  /** Custom actions (replace the default "Try again" button). */
  actions?: JSX.Element;
  /** Handler of the default "Try again" button. */
  onRetry?: () => void;
  compact?: boolean;
}

export const DEFAULT_ERROR_TEXT = "Something went wrong on our side. Check your connection and try again.";

export function ErrorState(props: ErrorStateProps): JSX.Element {
  return (
    <div class={`error-state${props.compact ? " is-compact" : ""}`} role="alert">
      <span class="error-state-icon">
        <Icon name="alert-circle" size={24} />
      </span>
      <h2 class="error-state-title">{props.title ?? "Couldn’t load data"}</h2>
      <p class="error-state-text">{props.text ?? DEFAULT_ERROR_TEXT}</p>
      <div class="error-state-actions">
        <Show
          when={props.actions}
          fallback={
            <button
              type="button"
              class="btn btn-secondary"
              onClick={() => (props.onRetry ? props.onRetry() : window.location.reload())}
            >
              <Icon name="refresh-cw" size={18} />
              <span>Try again</span>
            </button>
          }
        >
          {props.actions}
        </Show>
      </div>
    </div>
  );
}
