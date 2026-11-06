/**
 * Modal dialog + bottom Sheet + promise-based confirm() — port of IM.modal / IM.sheet (app.js).
 *
 * Markup is identical to app.js, so app.css applies unchanged (incl. bottom-sheet rendering of
 * .modal on mobile and the `is-closing` exit animation). Behaviour: role=dialog, aria-modal,
 * aria-labelledby/-describedby, focus trap, Esc + backdrop close (unless dismissible=false),
 * focus returns to the opener, `has-overlay` on <html>, `inert` on the app root.
 *
 *   <Modal open={open()} onClose={() => setOpen(false)} title="Archive product?" size="sm"
 *          confirmLabel="Archive" confirmVariant="danger" onConfirm={archive}>
 *     <p>…</p>
 *   </Modal>
 *
 *   if (await confirm({ title: "Delete draft?", body: "…", confirmLabel: "Delete", confirmVariant: "danger" })) …
 */
import {
  Show,
  createEffect,
  createRoot,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "./Icon";
import { toast } from "./Toast";
import {
  prefersReducedMotion,
  pushOverlay,
  removeOverlay,
  trapTab,
  uid,
  type OverlayEntry,
} from "./overlay";

const CLOSE_MS = 180;

type Kind = "modal" | "sheet";

/** Open/close lifecycle shared by Modal and Sheet: stack registration, exit animation, focus return. */
function createOverlayLifecycle(props: { open: boolean; onClose: () => void; onClosed?: () => void }) {
  const [mounted, setMounted] = createSignal(false);
  const [closing, setClosing] = createSignal(false);
  let entry: OverlayEntry | null = null;
  let opener: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const finish = (restoreFocus: boolean) => {
    if (!entry) return;
    removeOverlay(entry);
    entry = null;
    const done = () => {
      setMounted(false);
      setClosing(false);
      props.onClosed?.();
    };
    if (prefersReducedMotion()) done();
    else {
      setClosing(true);
      timer = setTimeout(done, CLOSE_MS);
    }
    if (restoreFocus && opener && document.contains(opener)) {
      try {
        opener.focus();
      } catch {
        /* ignore */
      }
    }
    opener = null;
  };

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open) {
          clearTimeout(timer);
          setClosing(false);
          if (!entry) {
            opener = document.activeElement as HTMLElement | null;
            entry = { close: () => props.onClose() };
            pushOverlay(entry);
          }
          setMounted(true);
        } else finish(true);
      },
    ),
  );
  onCleanup(() => {
    clearTimeout(timer);
    if (entry) {
      removeOverlay(entry);
      entry = null;
    }
  });

  return { mounted, closing };
}

function focusInitial(dialog: HTMLElement, kind: Kind, initialFocus?: string, danger?: boolean) {
  let target: HTMLElement | null = null;
  if (initialFocus) target = dialog.querySelector<HTMLElement>(initialFocus);
  if (!target && kind !== "sheet")
    target = dialog.querySelector<HTMLElement>(".modal-body input, .modal-body select, .modal-body textarea");
  if (!target && kind !== "sheet")
    target = danger
      ? dialog.querySelector<HTMLElement>("[data-im-cancel]")
      : dialog.querySelector<HTMLElement>("[data-im-confirm]");
  (target ?? dialog).focus();
}

function backdropHandlers(getDialog: () => HTMLElement | undefined, dismissible: () => boolean, close: () => void) {
  return {
    onMouseDown: (e: MouseEvent) => {
      if (e.target === e.currentTarget && dismissible()) close();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible()) {
        e.stopPropagation();
        close();
        return;
      }
      const dialog = getDialog();
      if (e.key === "Tab" && dialog) trapTab(e, dialog);
    },
  };
}

/* ------------------------------------------------------------------ Modal -- */

export interface ModalProps {
  open: boolean;
  /** Requested close (Esc, backdrop, ×, Cancel). The parent must set `open` to false. */
  onClose: () => void;
  /** Called after the exit animation, when the dialog is removed from the DOM. */
  onClosed?: () => void;
  title: JSX.Element;
  /** Modal body. */
  children?: JSX.Element;
  size?: "sm" | "md" | "lg";
  /** false → no ×, no Esc / backdrop close. */
  dismissible?: boolean;
  /** Custom footer content (replaces the default Cancel/Confirm buttons). */
  footer?: JSX.Element;
  /** Default footer: rendered when `onConfirm` or `confirmLabel` is given. */
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  /** null hides the Cancel button. */
  cancelLabel?: string | null;
  onConfirm?: () => void;
  /** Confirm button shows the loading state and is disabled. */
  confirmBusy?: boolean;
  /** CSS selector of the element to focus first. */
  initialFocus?: string;
  /** Extra class on .modal (page-specific styling). */
  class?: string;
}

export function Modal(props: ModalProps): JSX.Element {
  const id = uid("modal");
  const life = createOverlayLifecycle(props);
  const dismissible = () => props.dismissible !== false;
  const sizeCls = () => (props.size === "sm" ? " modal-sm" : props.size === "lg" ? " modal-lg" : "");
  const hasDefaultFooter = () => props.footer === undefined && (!!props.onConfirm || props.confirmLabel != null);

  return (
    <Show when={life.mounted()}>
      <Portal>
        {(() => {
          let dialog: HTMLDivElement | undefined;
          onMount(() => dialog && focusInitial(dialog, "modal", props.initialFocus, props.confirmVariant === "danger"));
          const h = backdropHandlers(() => dialog, dismissible, () => props.onClose());
          return (
            <div
              class={`modal-backdrop${life.closing() ? " is-closing" : ""}`}
              onMouseDown={h.onMouseDown}
              onKeyDown={h.onKeyDown}
            >
              <div
                ref={dialog}
                class={`modal${sizeCls()}${props.class ? ` ${props.class}` : ""}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${id}-t`}
                aria-describedby={`${id}-b`}
                tabindex="-1"
              >
                <div class="modal-header">
                  <h2 class="modal-title" id={`${id}-t`}>
                    {props.title}
                  </h2>
                  <Show when={dismissible()}>
                    <button
                      type="button"
                      class="btn btn-ghost btn-icon btn-sm modal-close"
                      data-im-close-modal
                      aria-label="Close"
                      onClick={() => props.onClose()}
                    >
                      <Icon name="x" />
                    </button>
                  </Show>
                </div>
                <div class="modal-body" id={`${id}-b`}>
                  {props.children}
                </div>
                <Show when={props.footer !== undefined || hasDefaultFooter()}>
                  <div class="modal-footer">
                    <Show when={hasDefaultFooter()} fallback={props.footer}>
                      <Show when={props.cancelLabel !== null}>
                        <button type="button" class="btn btn-secondary" data-im-cancel onClick={() => props.onClose()}>
                          {props.cancelLabel ?? "Cancel"}
                        </button>
                      </Show>
                      <button
                        type="button"
                        class={`btn ${props.confirmVariant === "danger" ? "btn-danger" : "btn-primary"}${props.confirmBusy ? " is-loading" : ""}`}
                        data-im-confirm
                        disabled={props.confirmBusy}
                        aria-busy={props.confirmBusy ? "true" : undefined}
                        onClick={() => props.onConfirm?.()}
                      >
                        {props.confirmLabel ?? "Confirm"}
                      </button>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>
          );
        })()}
      </Portal>
    </Show>
  );
}

/* ------------------------------------------------------------------ Sheet -- */

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  onClosed?: () => void;
  title: JSX.Element;
  children?: JSX.Element;
  initialFocus?: string;
}

/** Bottom sheet dialog (IM.sheet): same behaviour as Modal. */
export function Sheet(props: SheetProps): JSX.Element {
  const id = uid("sheet");
  const life = createOverlayLifecycle(props);
  return (
    <Show when={life.mounted()}>
      <Portal>
        {(() => {
          let dialog: HTMLDivElement | undefined;
          onMount(() => dialog && focusInitial(dialog, "sheet", props.initialFocus));
          const h = backdropHandlers(() => dialog, () => true, () => props.onClose());
          return (
            <div
              class={`sheet-backdrop${life.closing() ? " is-closing" : ""}`}
              onMouseDown={h.onMouseDown}
              onKeyDown={h.onKeyDown}
            >
              <div ref={dialog} class="sheet" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabindex="-1">
                <div class="sheet-handle" aria-hidden="true" />
                <div class="sheet-header">
                  <h2 class="sheet-title" id={`${id}-t`}>
                    {props.title}
                  </h2>
                  <button
                    type="button"
                    class="btn btn-ghost btn-icon"
                    data-im-close-modal
                    aria-label="Close"
                    onClick={() => props.onClose()}
                  >
                    <Icon name="x" />
                  </button>
                </div>
                <div class="sheet-body">{props.children}</div>
              </div>
            </div>
          );
        })()}
      </Portal>
    </Show>
  );
}

/* ---------------------------------------------------------------- confirm -- */

export interface ConfirmOptions {
  title: string;
  /** String → wrapped in <p>; or any JSX. */
  body?: JSX.Element | string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  /** null hides Cancel. Default "Cancel". */
  cancelLabel?: string | null;
  size?: "sm" | "md" | "lg";
  /**
   * Optional async action run on confirm while the button shows the loading state.
   * If it throws, the dialog stays open and an error toast shows the message.
   */
  action?: () => unknown | Promise<unknown>;
}

/** Promise-based confirmation dialog. Resolves true on confirm, false on cancel / Esc / backdrop. */
export function confirm(o: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    createRoot((dispose) => {
      const [open, setOpen] = createSignal(true);
      const [busy, setBusy] = createSignal(false);
      const settle = (result: boolean) => {
        if (!open()) return;
        setOpen(false);
        resolve(result);
      };
      const onConfirm = async () => {
        if (busy()) return;
        if (!o.action) return settle(true);
        setBusy(true);
        try {
          await o.action();
          setBusy(false);
          settle(true);
        } catch (err) {
          setBusy(false);
          toast({ type: "error", title: err instanceof Error ? err.message : "Something went wrong." });
        }
      };
      return (
        <Modal
          open={open()}
          onClose={() => !busy() && settle(false)}
          onClosed={dispose}
          title={o.title}
          size={o.size ?? "sm"}
          confirmLabel={o.confirmLabel ?? "Confirm"}
          confirmVariant={o.confirmVariant ?? "primary"}
          cancelLabel={o.cancelLabel}
          confirmBusy={busy()}
          onConfirm={onConfirm}
        >
          {typeof o.body === "string" ? <p>{o.body}</p> : o.body}
        </Modal>
      );
    });
  });
}
