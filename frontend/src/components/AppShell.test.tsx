import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory, useLocation } from "@solidjs/router";
import { AppShell, formatRemaining, type NavId } from "./AppShell";
import { setMe, type Me } from "../lib/auth";

const REGULAR: Me = {
  id: 1,
  email: "alex.morgan@northwindsupply.com",
  is_demo: false,
  demo_expires_at: null,
  currency: "USD",
  created_at: "2026-11-01T10:00:00Z",
};
const demoMe = (msLeft: number): Me => ({
  id: 2,
  email: "demo-7f3a9c@demo.inventory.app",
  is_demo: true,
  demo_expires_at: new Date(Date.now() + msLeft).toISOString(),
  currency: "USD",
  created_at: "2026-11-05T08:00:00Z",
});
const HOUR = 3_600_000;
const MIN = 60_000;

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderShell(active: NavId | null = "products", title = "Products", path = "/products") {
  const history = createMemoryHistory();
  history.set({ value: path });
  return render(() => (
    <MemoryRouter history={history}>
      <Route
        path="*"
        component={() => (
          <>
            <AppShell active={active} title={title}>
              <h1>{title}</h1>
            </AppShell>
            <Where />
          </>
        )}
      />
    </MemoryRouter>
  ));
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ was_demo: false }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  setMe(undefined);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.documentElement.className = "";
});

describe("AppShell structure & navigation", () => {
  it("renders sidebar, topbar, bottom nav and skip link with the active section", () => {
    setMe(REGULAR);
    const { container } = renderShell("products", "Products");
    const app = container.querySelector(".app")!;
    expect(Array.from(app.children).map((c) => c.tagName.toLowerCase() + "." + c.className)).toEqual([
      "header.topbar",
      "aside.sidebar",
      "main.page",
      "nav.bottom-nav",
    ]);
    expect(container.querySelector("a.skip-link")).toHaveTextContent("Skip to content");
    expect(container.querySelector("main#main")).toHaveAttribute("tabindex", "-1");

    const sidebar = container.querySelector(".sidebar")!;
    const links = Array.from(sidebar.querySelectorAll<HTMLAnchorElement>(".nav-list .nav-item"));
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Dashboard", "/dashboard"],
      ["Products", "/products"],
      ["Categories", "/categories"],
      ["Receipts", "/receipts"],
      ["Write-offs", "/write-offs"],
      ["Stock counts", "/stock-counts"],
      ["History", "/history"],
      ["Reports", "/reports"],
    ]);
    const active = links.filter((a) => a.classList.contains("is-active"));
    expect(active.map((a) => a.textContent)).toEqual(["Products"]);
    expect(active[0]).toHaveAttribute("aria-current", "page");
    expect(links[0]).not.toHaveAttribute("aria-current");

    const bottom = container.querySelector(".bottom-nav")!;
    expect(Array.from(bottom.children).map((c) => c.textContent)).toEqual([
      "Dashboard",
      "Products",
      "Receipts",
      "Write-offs",
      "More",
    ]);
    expect(bottom.querySelector(".is-active")).toHaveTextContent("Products");

    expect(container.querySelector(".topbar-title")).toHaveTextContent("Products");
    expect(document.title).toBe("Products · Inventory Manager");
    // regular account: no demo banner, avatar = first letter of the email
    expect(container.querySelector(".demo-banner")).toBeNull();
    expect(sidebar.querySelector(".avatar")).toHaveTextContent("A");
    expect(sidebar.querySelector(".account-email")).toHaveTextContent(REGULAR.email);
  });

  it("marks More as active for sections in the More sheet and lists them there", async () => {
    setMe(REGULAR);
    const { container } = renderShell("history", "History", "/history");
    const more = container.querySelector<HTMLButtonElement>("[data-im-more]")!;
    expect(more).toHaveClass("bottom-nav-item", "is-active");
    expect(more).toHaveTextContent("More (current: History)");
    fireEvent.click(more);
    const sheet = await screen.findByRole("dialog", { name: "More" });
    const links = within(sheet).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Categories", "Stock counts", "History", "Reports"]);
    expect(within(sheet).getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(sheet.querySelector(".account-email")).toHaveTextContent(REGULAR.email);
    expect(within(sheet).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("opens the account menu with header, divider and Sign out", async () => {
    setMe(REGULAR);
    const { container } = renderShell();
    const trigger = container.querySelector<HTMLButtonElement>(".topbar [data-im-account]")!;
    expect(trigger).toHaveAttribute("aria-label", `Account: ${REGULAR.email}`);
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(menu.querySelector(".menu-header")).toHaveTextContent(`Signed in as${REGULAR.email}`);
    expect(menu.querySelector(".menu-divider")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toHaveTextContent("Sign out"));
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });
});

describe("demo banner", () => {
  it("shows the live remaining time and updates every minute", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
    setMe(demoMe(23 * HOUR + 41 * MIN + 30_000));
    const { container } = renderShell("dashboard", "Dashboard", "/dashboard");
    const banner = container.querySelector(".demo-banner")!;
    expect(banner).toHaveAttribute("role", "region");
    expect(banner).toHaveAttribute("aria-label", "Demo workspace");
    expect(banner.querySelector(".demo-banner-text")).toHaveTextContent(
      "Demo workspace · expires in 23 h 41 min · all demo data is deleted after 24 hours",
    );
    expect(container.querySelector("main")!.firstElementChild).toBe(banner);
    const cta = within(banner as HTMLElement).getByRole("link", { name: "Sign up to start your own workspace" });
    expect(cta).toHaveAttribute("href", "/sign-up");
    expect(cta).toHaveClass("btn", "btn-primary", "btn-sm");
    expect(container.querySelector(".sidebar .avatar")).toHaveTextContent("D");

    vi.advanceTimersByTime(MIN);
    expect(banner).toHaveTextContent("expires in 23 h 40 min");
    vi.advanceTimersByTime(23 * HOUR);
    expect(banner).toHaveTextContent("expires in 40 min");
  });

  it("goes to /demo-expired when the demo expires", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
    setMe(demoMe(90_000));
    renderShell("dashboard", "Dashboard", "/dashboard");
    expect(screen.getByText(/expires in 1 min/)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2 * MIN);
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/demo-expired"));
  });

  it("formats remaining time", () => {
    expect(formatRemaining(23 * HOUR + 41 * MIN + 59_000)).toBe("23 h 41 min");
    expect(formatRemaining(2 * HOUR)).toBe("2 h 0 min");
    expect(formatRemaining(41 * MIN)).toBe("41 min");
    expect(formatRemaining(30_000)).toBe("less than 1 min");
    expect(formatRemaining(-5)).toBe("less than 1 min");
  });
});

describe("sign-out confirmation", () => {
  it("regular account: 'Sign out?' → POST sign-out → /signed-out", async () => {
    setMe(REGULAR);
    const { container } = renderShell();
    fireEvent.click(container.querySelector<HTMLButtonElement>(".sidebar [data-im-signout]")!);
    const dialog = await screen.findByRole("dialog", { name: "Sign out?" });
    expect(dialog).toHaveClass("modal", "modal-sm");
    expect(dialog.querySelector(".modal-body")).toHaveTextContent(
      `You’ll need to sign in again with ${REGULAR.email} to access your inventory.`,
    );
    expect(dialog.querySelector(".modal-body strong")).toHaveTextContent(REGULAR.email);
    const btn = within(dialog).getByRole("button", { name: "Sign out" });
    expect(btn).toHaveClass("btn-primary");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/signed-out$/));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", expect.objectContaining({ method: "POST" }));
  });

  it("demo: danger 'Sign out and delete demo' → /signed-out?demo=1", async () => {
    setMe(demoMe(5 * HOUR));
    const { container } = renderShell();
    fireEvent.click(container.querySelector<HTMLButtonElement>(".sidebar [data-im-signout]")!);
    const dialog = await screen.findByRole("dialog", { name: "Sign out of the demo?" });
    expect(dialog.querySelector(".modal-body")).toHaveTextContent(
      "Your demo workspace and all its data will be deleted. You can’t return to it — Try demo always starts a new demo.",
    );
    const btn = within(dialog).getByRole("button", { name: "Sign out and delete demo" });
    expect(btn).toHaveClass("btn-danger");
    await waitFor(() => expect(document.activeElement).toHaveTextContent("Cancel"));
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/signed-out?demo=1"));
  });

  it("Cancel keeps the session and does not call the API", async () => {
    setMe(REGULAR);
    const { container } = renderShell();
    fireEvent.click(container.querySelector<HTMLButtonElement>(".sidebar [data-im-signout]")!);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("where")).toHaveTextContent("/products");
  });
});
