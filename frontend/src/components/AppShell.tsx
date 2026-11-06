/**
 * Application shell — port of IM.mountShell (app.js) with the same DOM and class names:
 *   a.skip-link · div.app > header.topbar · aside.sidebar · main#main.page · nav.bottom-nav
 * Desktop ≥ 1200: sidebar; 768–1199: icon rail; < 768: top bar + bottom nav + "More" sheet.
 * The demo banner is the first child of <main> while the session is a demo.
 *
 *   <AppShell active="products" title="Products"> …page content… </AppShell>
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon, type IconName } from "./Icon";
import { Menu, type MenuItem } from "./Menu";
import { Sheet, confirm } from "./Modal";
import { avatarLetter, me, setMe, signOut } from "../lib/auth";

export type NavId =
  | "dashboard"
  | "products"
  | "categories"
  | "receipts"
  | "write-offs"
  | "stock-counts"
  | "history"
  | "reports";

export interface NavEntry {
  id: NavId;
  label: string;
  icon: IconName;
  href: string;
}

export const NAV: NavEntry[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", href: "/dashboard" },
  { id: "products", label: "Products", icon: "box", href: "/products" },
  { id: "categories", label: "Categories", icon: "tag", href: "/categories" },
  { id: "receipts", label: "Receipts", icon: "arrow-down-to-line", href: "/receipts" },
  { id: "write-offs", label: "Write-offs", icon: "arrow-up-from-line", href: "/write-offs" },
  { id: "stock-counts", label: "Stock counts", icon: "clipboard-check", href: "/stock-counts" },
  { id: "history", label: "History", icon: "history", href: "/history" },
  { id: "reports", label: "Reports", icon: "bar-chart", href: "/reports" },
];
const BOTTOM: NavId[] = ["dashboard", "products", "receipts", "write-offs"];
const MORE: NavId[] = ["categories", "stock-counts", "history", "reports"];

const navItem = (id: NavId) => NAV.find((n) => n.id === id)!;

/** "23 h 41 min" / "41 min" / "less than 1 min" for the demo banner. */
export function formatRemaining(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60000);
  if (totalMin < 1) return "less than 1 min";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function NavLink(props: { item: NavEntry; active: NavId | null | undefined; cls: string; onClick?: () => void }) {
  const on = () => props.item.id === props.active;
  return (
    <a
      class={`${props.cls}${on() ? " is-active" : ""}`}
      href={props.item.href}
      aria-current={on() ? "page" : undefined}
      onClick={() => props.onClick?.()}
    >
      <span class="nav-icon">
        <Icon name={props.item.icon} />
      </span>
      <span class="nav-label">{props.item.label}</span>
    </a>
  );
}

function AccountBlock(props: { email: string; letter: string; titled?: boolean }) {
  return (
    <div class="account-block">
      <span class="avatar" aria-hidden="true">
        {props.letter}
      </span>
      <div class="account-meta">
        <span class="account-caption">Signed in as</span>
        <span class="account-email" title={props.titled ? props.email : undefined}>
          {props.email}
        </span>
      </div>
    </div>
  );
}

/**
 * Sign-out confirmation (texts of IM.confirmSignOut). On confirm: POST /api/auth/sign-out,
 * then navigate to /signed-out (demo: /signed-out?demo=1). Resolves true if signed out.
 */
export async function confirmSignOut(navigate: (to: string) => void): Promise<boolean> {
  const m = me();
  const demo = !!m?.is_demo;
  const ok = await confirm(
    demo
      ? {
          title: "Sign out of the demo?",
          body: (
            <p>Your demo workspace and all its data will be deleted. You can’t return to it — Try demo always starts a new demo.</p>
          ),
          confirmLabel: "Sign out and delete demo",
          confirmVariant: "danger",
          cancelLabel: "Cancel",
          size: "sm",
          action: () => signOut(),
        }
      : {
          title: "Sign out?",
          body: (
            <p>
              You’ll need to sign in again with <strong>{m?.email ?? ""}</strong> to access your inventory.
            </p>
          ),
          confirmLabel: "Sign out",
          confirmVariant: "primary",
          cancelLabel: "Cancel",
          size: "sm",
          action: () => signOut(),
        },
  );
  if (ok) navigate(demo ? "/signed-out?demo=1" : "/signed-out");
  return ok;
}

export interface AppShellProps {
  /** Active nav section (null → none, e.g. 404). */
  active?: NavId | null;
  /** Page title: topbar title and document.title "<title> · Inventory Manager". */
  title: string;
  children?: JSX.Element;
}

export function AppShell(props: AppShellProps): JSX.Element {
  const navigate = useNavigate();
  let main: HTMLElement | undefined;
  const email = () => me()?.email ?? "";
  const letter = () => avatarLetter(me());
  const demo = () => !!me()?.is_demo;
  const [moreOpen, setMoreOpen] = createSignal(false);
  const moreActive = () => !!props.active && MORE.includes(props.active);

  createEffect(() => {
    document.title = `${props.title} · Inventory Manager`;
  });

  /* Demo countdown — recomputed every minute; when it passes → /demo-expired. */
  const [now, setNow] = createSignal(Date.now());
  const expiresAt = createMemo(() => {
    const iso = me()?.is_demo ? me()?.demo_expires_at : null;
    const t = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(t) ? t : null;
  });
  const remaining = () => (expiresAt() == null ? null : expiresAt()! - now());
  const tick = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(tick));
  createEffect(() => {
    const exp = expiresAt();
    if (exp == null) return;
    const left = exp - Date.now();
    if (left <= 0) return; // handled below
    // Exact expiry moment (setTimeout max ≈ 24.8 days).
    const t = setTimeout(() => setNow(Date.now()), Math.min(left + 50, 2_147_000_000));
    onCleanup(() => clearTimeout(t));
  });
  createEffect(() => {
    const r = remaining();
    if (r != null && r <= 0) {
      setMe(null);
      navigate("/demo-expired", { replace: true });
    }
  });

  const signOutFlow = () => {
    setMoreOpen(false);
    void confirmSignOut((to) => navigate(to));
  };

  const accountItems = (): MenuItem[] => [
    { header: "Signed in as", sub: email() },
    { divider: true },
    { label: "Sign out", icon: "log-out", onClick: signOutFlow },
  ];

  const skipToContent = (e: MouseEvent) => {
    e.preventDefault();
    main?.focus();
    main?.scrollIntoView?.();
  };

  return (
    <>
      <a class="skip-link" href="#main" onClick={skipToContent}>
        Skip to content
      </a>
      <div id="app" class="app">
        <header class="topbar">
          <a class="brand-mark" href="/dashboard" aria-label="Inventory Manager — Dashboard">
            <Icon name="box" size={16} />
          </a>
          <div class="topbar-title">{props.title}</div>
          <div class="topbar-actions">
            <Menu items={accountItems()} align="end">
              {(t) => (
                <button
                  type="button"
                  class="btn btn-ghost btn-icon"
                  data-im-account
                  aria-label={`Account: ${email()}`}
                  {...t}
                >
                  <Icon name="user" />
                </button>
              )}
            </Menu>
          </div>
        </header>

        <aside class="sidebar" aria-label="Sidebar">
          <a class="sidebar-brand" href="/dashboard" aria-label="Inventory Manager — Dashboard">
            <span class="brand-mark">
              <Icon name="box" size={18} />
            </span>
            <span class="brand-name">Inventory Manager</span>
          </a>
          <nav aria-label="Main">
            <ul class="nav-list">
              <For each={NAV}>
                {(n) => (
                  <li>
                    <NavLink item={n} active={props.active} cls="nav-item" />
                  </li>
                )}
              </For>
            </ul>
          </nav>
          <div class="sidebar-account">
            <AccountBlock email={email()} letter={letter()} titled />
            <button type="button" class="btn btn-secondary btn-sm btn-block" data-im-signout onClick={signOutFlow}>
              <Icon name="log-out" size={16} />
              <span>Sign out</span>
            </button>
            <Menu items={accountItems()} align="start">
              {(t) => (
                <button
                  type="button"
                  class="nav-item account-trigger"
                  data-im-account
                  aria-label={`Account: ${email()}`}
                  {...t}
                >
                  <span class="nav-icon">
                    <Icon name="user" />
                  </span>
                  <span class="nav-label">Account</span>
                </button>
              )}
            </Menu>
          </div>
        </aside>

        <main ref={main} id="main" class="page" tabindex="-1">
          <Show when={demo()}>
            <div class="demo-banner" role="region" aria-label="Demo workspace">
              <p class="demo-banner-text">
                <span class="demo-banner-icon">
                  <Icon name="clock" size={18} />
                </span>
                <span>
                  <strong>Demo workspace</strong> · expires in {formatRemaining(remaining() ?? 0)} · all demo data is
                  deleted after 24 hours
                </span>
              </p>
              <a class="btn btn-primary btn-sm" href="/sign-up">
                Sign up to start your own workspace
              </a>
            </div>
          </Show>
          {props.children}
        </main>

        <nav class="bottom-nav" aria-label="Main">
          <For each={BOTTOM}>{(id) => <NavLink item={navItem(id)} active={props.active} cls="bottom-nav-item" />}</For>
          <button
            type="button"
            class={`bottom-nav-item${moreActive() ? " is-active" : ""}`}
            data-im-more
            aria-haspopup="dialog"
            onClick={() => setMoreOpen(true)}
          >
            <span class="nav-icon">
              <Icon name="more-horizontal" />
            </span>
            <span class="nav-label">More</span>
            <Show when={moreActive()}>
              <span class="visually-hidden"> (current: {navItem(props.active!).label})</span>
            </Show>
          </button>
        </nav>
      </div>

      <Sheet open={moreOpen()} onClose={() => setMoreOpen(false)} title="More">
        <nav aria-label="More sections">
          <ul class="nav-list">
            <For each={MORE}>
              {(id) => (
                <li>
                  <NavLink item={navItem(id)} active={props.active} cls="nav-item" onClick={() => setMoreOpen(false)} />
                </li>
              )}
            </For>
          </ul>
        </nav>
        <AccountBlock email={email()} letter={letter()} />
        <button type="button" class="btn btn-secondary btn-block" data-im-signout onClick={signOutFlow}>
          <Icon name="log-out" size={18} />
          <span>Sign out</span>
        </button>
      </Sheet>
    </>
  );
}
