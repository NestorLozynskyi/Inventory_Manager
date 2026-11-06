/**
 * Dropdown menu — port of IM.menu (app.js): same markup (ul.menu[role=menu] > li > .menu-item),
 * positioning and keyboard behaviour:
 *   trigger: Enter/Space/click toggles, ArrowDown opens (first item), ArrowUp opens (last item);
 *   menu: ArrowUp/Down cycle, Home/End, Esc closes (focus back to trigger), Tab closes.
 * Outside mousedown/touchstart, resize and scroll close it. Opening a modal closes all menus.
 *
 *   <Menu align="end" items={[{ label: "Edit", icon: "pencil", href: "/products/1/edit" },
 *                             { divider: true }, { label: "Archive", icon: "archive", danger: true, onClick }]}>
 *     {(trigger) => (
 *       <button type="button" class="btn btn-ghost btn-icon" aria-label="More actions" {...trigger}>
 *         <Icon name="more-horizontal" />
 *       </button>
 *     )}
 *   </Menu>
 */
import { For, Match, Show, Switch, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon, type IconName } from "./Icon";
import { closeAllMenus, prefersReducedMotion, registerMenu, uid } from "./overlay";

export type MenuItem =
  | {
      label: string;
      icon?: IconName;
      href?: string;
      onClick?: (e: MouseEvent) => void;
      danger?: boolean;
      disabled?: boolean;
    }
  | { divider: true }
  | { header: string; sub?: string };

export interface MenuTriggerProps {
  ref: (el: HTMLElement) => void;
  onClick: (e: MouseEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  "aria-haspopup": "menu";
  "aria-expanded": "true" | "false";
  "aria-controls": string | undefined;
}

export interface MenuProps {
  items: MenuItem[];
  align?: "start" | "end";
  children: (trigger: MenuTriggerProps) => JSX.Element;
}

const CLOSE_MS = 100;

export function Menu(props: MenuProps): JSX.Element {
  const menuId = uid("menu");
  let trigger: HTMLElement | undefined;
  let el: HTMLUListElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [closing, setClosing] = createSignal(false);
  const [rendered, setRendered] = createSignal(false);
  const [label, setLabel] = createSignal("");
  const [pos, setPos] = createSignal<{ left: number; top: number } | null>(null);
  let focusLastOnOpen = false;
  let unregister: (() => void) | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const items = () => (el ? Array.from(el.querySelectorAll<HTMLElement>('.menu-item:not([aria-disabled="true"])')) : []);

  function position() {
    if (!el || !trigger) return;
    const r = trigger.getBoundingClientRect();
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let left = props.align === "end" ? r.right - mw : r.left;
    if (left + mw > vw - 8) left = vw - 8 - mw;
    if (left < 8) left = 8;
    let top = r.bottom + 4;
    if (top + mh > vh - 8 && r.top - mh - 4 > 8) top = r.top - mh - 4;
    setPos({ left: Math.round(left), top: Math.round(top) });
  }

  const onDocDown = (e: Event) => {
    const t = e.target as Node;
    if (el && !el.contains(t) && !trigger?.contains(t)) close(false);
  };
  const onWin = () => close(false);

  function openMenu(focusLast: boolean) {
    if (open()) return;
    closeAllMenus();
    clearTimeout(closeTimer);
    focusLastOnOpen = focusLast;
    setLabel(trigger?.getAttribute("aria-label") || trigger?.textContent?.trim() || "");
    setClosing(false);
    setPos(null);
    setOpen(true);
    setRendered(true);
    unregister = registerMenu(() => close(false));
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("touchstart", onDocDown, true);
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
  }

  function detach() {
    unregister?.();
    unregister = null;
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("touchstart", onDocDown, true);
    window.removeEventListener("resize", onWin);
    window.removeEventListener("scroll", onWin, true);
  }

  function close(returnFocus: boolean) {
    if (!open()) return;
    setOpen(false);
    detach();
    if (prefersReducedMotion()) setRendered(false);
    else {
      setClosing(true);
      closeTimer = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, CLOSE_MS);
    }
    if (returnFocus) trigger?.focus();
  }

  onCleanup(() => {
    clearTimeout(closeTimer);
    detach();
  });

  /** Called when the <ul> is attached: position it and move focus into it. */
  function onMenuRef(node: HTMLUListElement) {
    el = node;
    queueMicrotask(() => {
      if (!open() || el !== node) return;
      position();
      const list = items();
      const f = focusLastOnOpen ? list[list.length - 1] : list[0];
      f?.focus();
    });
  }

  function onMenuKeyDown(e: KeyboardEvent) {
    const list = items();
    const idx = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      (list[(idx + 1) % list.length] ?? list[0])?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (list[(idx - 1 + list.length) % list.length] ?? list[0])?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  function onItemClick(e: MouseEvent, it: Extract<MenuItem, { label: string }>) {
    if (it.disabled) {
      e.preventDefault();
      return;
    }
    if (it.onClick) {
      e.preventDefault();
      close(true);
      it.onClick(e);
      return;
    }
    // Links navigate (client-side router); close without stealing focus back.
    close(!it.href);
  }

  const triggerProps: MenuTriggerProps = {
    ref: (node: HTMLElement) => {
      trigger = node;
    },
    onClick: (e: MouseEvent) => {
      e.preventDefault();
      if (open()) close(true);
      else openMenu(false);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        openMenu(false);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        openMenu(true);
      }
    },
    "aria-haspopup": "menu",
    get "aria-expanded"() {
      return open() ? ("true" as const) : ("false" as const);
    },
    get "aria-controls"() {
      return open() ? menuId : undefined;
    },
  };

  return (
    <>
      {props.children(triggerProps)}
      <Show when={rendered()}>
        <Portal>
          <ul
            ref={onMenuRef}
            class={`menu${closing() ? " is-closing" : ""}`}
            id={menuId}
            role="menu"
            aria-label={label() || undefined}
            style={pos() ? { left: `${pos()!.left}px`, top: `${pos()!.top}px` } : { visibility: "hidden" }}
            on:keydown={onMenuKeyDown}
          >
            <For each={props.items}>
              {(it) => (
                <Switch>
                  <Match when={"divider" in it}>
                    <li role="separator" class="menu-divider" />
                  </Match>
                  <Match when={"header" in it && it}>
                    {(h) => {
                      const hd = h() as Extract<MenuItem, { header: string }>;
                      return (
                        <li role="presentation" class="menu-header">
                          {hd.header}
                          <Show when={hd.sub}>
                            <strong>{hd.sub}</strong>
                          </Show>
                        </li>
                      );
                    }}
                  </Match>
                  <Match when={"label" in it && it}>
                    {(x) => {
                      const item = x() as Extract<MenuItem, { label: string }>;
                      const cls = `menu-item${item.danger ? " is-danger" : ""}`;
                      const inner = (
                        <>
                          <Show when={item.icon}>{(ic) => <Icon name={ic()} size={16} />}</Show>
                          <span>{item.label}</span>
                        </>
                      );
                      return (
                        <li role="none">
                          <Show
                            when={item.href && !item.disabled}
                            fallback={
                              <button
                                type="button"
                                role="menuitem"
                                tabindex="-1"
                                class={cls}
                                aria-disabled={item.disabled ? "true" : undefined}
                                onClick={(e) => onItemClick(e, item)}
                              >
                                {inner}
                              </button>
                            }
                          >
                            <a role="menuitem" tabindex="-1" class={cls} href={item.href} onClick={(e) => onItemClick(e, item)}>
                              {inner}
                            </a>
                          </Show>
                        </li>
                      );
                    }}
                  </Match>
                </Switch>
              )}
            </For>
          </ul>
        </Portal>
      </Show>
    </>
  );
}
