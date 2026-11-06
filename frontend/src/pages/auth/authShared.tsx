/** Shared pieces of the auth pages (sign-in, sign-up, demo-expired, signed-out). Page-local, not a shared component. */
import { For, Show, createSignal, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { ApiError } from "../../api/client";
import { Icon } from "../../components/Icon";
import { loadMe, startDemo } from "../../lib/auth";

/** Same rule as the mockups (client-side only; the server is the source of truth). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const DEMO_LOADING_TEXT = "Preparing your demo workspace…";

export function AuthBrand(): JSX.Element {
  return (
    <a class="auth-brand" href="/sign-in" aria-label="Inventory Manager — Sign in">
      <span class="brand-mark">
        <Icon name="box" size={18} />
      </span>
      <span>Inventory Manager</span>
    </a>
  );
}

/** <p class="error-text"> with the alert-circle icon; hidden when there is no message. */
export function FieldError(props: { id: string; message?: string | null }): JSX.Element {
  return (
    <p class="error-text" id={props.id} aria-live="polite" hidden={!props.message}>
      <Show when={props.message}>
        <Icon name="alert-circle" size={16} />
        <span>{props.message}</span>
      </Show>
    </p>
  );
}

/** Show/hide password addon button (aria-pressed, Show/Hide label, eye/eye-off icon). */
export function PasswordToggle(props: {
  controls: string;
  shown: boolean;
  onToggle: () => void;
  disabled?: boolean;
  srLabel?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      class="input-addon pw-toggle"
      aria-controls={props.controls}
      aria-pressed={props.shown ? "true" : "false"}
      disabled={props.disabled}
      onClick={() => props.onToggle()}
    >
      <span class="pw-toggle-icon">
        <Icon name={props.shown ? "eye-off" : "eye"} size={18} />
      </span>
      <span class="pw-toggle-label">{props.shown ? "Hide" : "Show"}</span>
      <span class="visually-hidden"> {props.srLabel ?? "password"}</span>
    </button>
  );
}

export interface SummaryItem {
  id: string;
  msg: string;
}

/** Error summary alert (≥2 problems); links focus the field. */
export function ErrorSummary(props: { title: string; items: SummaryItem[]; ref?: (el: HTMLDivElement) => void }): JSX.Element {
  const focusField = (e: MouseEvent, id: string) => {
    e.preventDefault();
    document.getElementById(id)?.focus();
  };
  return (
    <div class="alert alert-danger error-summary" role="alert" tabindex="-1" id="error-summary" ref={props.ref}>
      <span class="alert-icon">
        <Icon name="alert-circle" size={20} />
      </span>
      <div class="alert-content">
        <p class="alert-title">{props.title}</p>
        <div class="alert-body">
          <ul>
            <For each={props.items}>
              {(it) => (
                <li>
                  <a href={`#${it.id}`} onClick={(e) => focusField(e, it.id)}>
                    {it.msg}
                  </a>
                </li>
              )}
            </For>
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Form-level danger alert. */
export function FormAlert(props: {
  title: string;
  children?: JSX.Element;
  id?: string;
  class?: string;
  ref?: (el: HTMLDivElement) => void;
}): JSX.Element {
  return (
    <div
      class={`alert alert-danger${props.class ? ` ${props.class}` : ""}`}
      role="alert"
      tabindex="-1"
      id={props.id}
      ref={props.ref}
    >
      <span class="alert-icon">
        <Icon name="alert-circle" size={20} />
      </span>
      <div class="alert-content">
        <p class="alert-title">{props.title}</p>
        <p class="alert-body">{props.children}</p>
      </div>
    </div>
  );
}

/** Text shown when starting a demo fails (429 rate_limited → server message). */
export function demoErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.isNetworkError) return "We couldn’t reach the server. Check your connection and try again.";
    if (err.status >= 500 || err.code === "http_error") return "Something went wrong on our side. Try again in a moment.";
    return err.message;
  }
  return "Something went wrong. Try again.";
}

/**
 * "Try demo": POST /api/auth/demo → /dashboard. `pending()` while seeding; `error()` holds the failure text.
 * Navigation happens before the guard of the current (guest) page re-renders with the new session.
 */
export function useStartDemo() {
  const navigate = useNavigate();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const start = async (): Promise<boolean> => {
    if (pending()) return false;
    setError(null);
    setPending(true);
    try {
      await startDemo();
    } catch (err) {
      setPending(false);
      setError(demoErrorText(err));
      return false;
    }
    navigate("/dashboard", { replace: true });
    void loadMe(true).catch(() => undefined);
    return true;
  };
  return { pending, error, start, clearError: () => setError(null) };
}
