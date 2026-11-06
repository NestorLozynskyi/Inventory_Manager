/**
 * Toasts — port of IM.toast (app.js). `toast()` can be called from anywhere; <ToastRegion/> (mounted
 * once in App, portalled to <body> so it stays outside the inert app root) renders them.
 *
 *   toast({ type: "success", title: "Receipt posted", text: "Stock updated for 3 products." });
 *   const t = toast({ type: "info", title: "Exporting…", duration: 0 }); … t.dismiss();
 */
import { For, Show, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "./Icon";
import { prefersReducedMotion } from "./overlay";

export type ToastType = "success" | "error" | "info";

export interface ToastOptions {
  type?: ToastType;
  title?: string;
  text?: JSX.Element;
  /** ms; 0 = sticky. Default 5000. */
  duration?: number;
}

interface ToastItem {
  id: number;
  type: ToastType;
  title?: string;
  text?: JSX.Element;
  duration: number;
  leaving: () => boolean;
  setLeaving: (v: boolean) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface ToastHandle {
  dismiss: () => void;
}

const LEAVE_MS = 140;
let nextId = 0;
const [toasts, setToasts] = createSignal<ToastItem[]>([]);

/** Currently shown toasts (for tests / debugging). */
export { toasts };

function removeNow(id: number) {
  setToasts((list) => list.filter((t) => t.id !== id));
}

function dismissItem(item: ToastItem) {
  clearTimeout(item.timer);
  if (!toasts().includes(item) || item.leaving()) return;
  if (prefersReducedMotion()) return removeNow(item.id);
  item.setLeaving(true);
  setTimeout(() => removeNow(item.id), LEAVE_MS);
}

function arm(item: ToastItem) {
  clearTimeout(item.timer);
  if (item.duration > 0) item.timer = setTimeout(() => dismissItem(item), item.duration);
}

export function toast(o: ToastOptions): ToastHandle {
  const type: ToastType = o.type === "error" ? "error" : o.type === "success" ? "success" : "info";
  const [leaving, setLeaving] = createSignal(false);
  const item: ToastItem = {
    id: ++nextId,
    type,
    title: o.title,
    text: o.text,
    duration: o.duration ?? 5000,
    leaving,
    setLeaving,
  };
  setToasts((list) => [...list, item]);
  arm(item);
  return { dismiss: () => dismissItem(item) };
}

/** Remove all toasts immediately (tests, sign-out). */
export function clearToasts(): void {
  for (const t of toasts()) clearTimeout(t.timer);
  setToasts([]);
}

const ICON = { success: "check-circle", error: "alert-circle", info: "info" } as const;

function ToastView(props: { item: ToastItem }): JSX.Element {
  const item = props.item;
  onCleanup(() => clearTimeout(item.timer));
  return (
    <div
      class={`toast toast-${item.type}${item.leaving() ? " is-leaving" : ""}`}
      role={item.type === "error" ? "alert" : undefined}
      onMouseEnter={() => clearTimeout(item.timer)}
      onMouseLeave={() => arm(item)}
      onFocusIn={() => clearTimeout(item.timer)}
      onFocusOut={() => arm(item)}
    >
      <span class="toast-icon">
        <Icon name={ICON[item.type]} />
      </span>
      <div class="toast-content">
        <Show when={item.title}>
          <p class="toast-title">{item.title}</p>
        </Show>
        <Show when={item.text}>
          <p class="toast-text">{item.text}</p>
        </Show>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-icon btn-sm toast-close"
        aria-label="Dismiss notification"
        onClick={() => dismissItem(item)}
      >
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

/** The live region with all toasts. Mount once (App). */
export function ToastRegion(): JSX.Element {
  return (
    <Portal>
      <div class="toast-region" aria-live="polite" aria-relevant="additions" aria-label="Notifications">
        <For each={toasts()}>{(item) => <ToastView item={item} />}</For>
      </div>
    </Portal>
  );
}
