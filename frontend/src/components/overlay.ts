/**
 * Shared overlay plumbing (port of the app.js overlay stack):
 *  - stack of open modals/sheets → `has-overlay` on <html> and `inert` on the app root;
 *  - registry of open menus (opening a modal closes menus; Esc closes menus);
 *  - focus helpers.
 */

let uidN = 0;
export function uid(prefix = "im"): string {
  uidN += 1;
  return `${prefix}-${uidN}`;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Visible focusable elements inside `root` (without layout — e.g. jsdom — all are considered visible). */
export function focusables(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  const hasLayout = root.offsetWidth > 0 || root.offsetHeight > 0;
  if (!hasLayout) return all;
  return all.filter((n) => n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement);
}

/** Keep Tab / Shift+Tab inside `dialog` (same algorithm as app.js). */
export function trapTab(e: KeyboardEvent, dialog: HTMLElement): void {
  const f = focusables(dialog);
  if (!f.length) {
    e.preventDefault();
    dialog.focus();
    return;
  }
  const first = f[0];
  const last = f[f.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === dialog)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ------------------------------------------------------------- app root -- */

let appRootId = "root";
/** Element made `inert` while an overlay is open (defaults to #root). */
export function setAppRootId(id: string): void {
  appRootId = id;
}

function setInert(on: boolean): void {
  const root = document.getElementById(appRootId);
  if (!root) return;
  if (on) root.setAttribute("inert", "");
  else root.removeAttribute("inert");
}

/* ---------------------------------------------------------------- stack -- */

export interface OverlayEntry {
  close: () => void;
}

const stack: OverlayEntry[] = [];

export function pushOverlay(entry: OverlayEntry): void {
  closeAllMenus();
  stack.push(entry);
  document.documentElement.classList.add("has-overlay");
  setInert(true);
}

export function removeOverlay(entry: OverlayEntry): void {
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  if (!stack.length) {
    document.documentElement.classList.remove("has-overlay");
    setInert(false);
  }
}

export function overlayCount(): number {
  return stack.length;
}

/** Close the top-most modal/sheet (IM.closeModal). */
export function closeTopOverlay(): void {
  stack[stack.length - 1]?.close();
}

/* ---------------------------------------------------------------- menus -- */

const menus = new Set<() => void>();

export function registerMenu(close: () => void): () => void {
  menus.add(close);
  return () => menus.delete(close);
}

export function closeAllMenus(): void {
  for (const close of Array.from(menus)) close();
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menus.size) closeAllMenus();
  });
}
