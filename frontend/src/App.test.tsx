import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { MemoryRouter, createMemoryHistory } from "@solidjs/router";
import { AppRoutes, Root } from "./App";
import { setMe } from "./lib/auth";

const ME = {
  id: 1,
  email: "alex.morgan@northwindsupply.com",
  is_demo: false,
  demo_expires_at: null,
  currency: "USD",
  created_at: "2026-11-01T10:00:00Z",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function start(path: string, fetchImpl: (url: string) => Response, allRequests = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        // only the session endpoint is relevant here; page data requests get a plain server error
        allRequests || String(url).includes("/api/auth/") || !String(url).startsWith("/api/")
          ? fetchImpl(url)
          : json(503, { error: { code: "unavailable", message: "Not under test." } }),
      ),
    ),
  );
  const history = createMemoryHistory();
  history.set({ value: path });
  render(() => (
    <MemoryRouter history={history} root={Root}>
      <AppRoutes />
    </MemoryRouter>
  ));
  return history;
}

afterEach(() => {
  cleanup();
  setMe(undefined);
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("routing & guards", () => {
  it("redirects to /sign-in without a session", async () => {
    const h = start("/dashboard", () => json(401, { error: { code: "unauthenticated", message: "x" } }));
    await waitFor(() => expect(h.get()).toBe("/sign-in"));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("redirects to /demo-expired for an expired demo session", async () => {
    const h = start("/products", () => json(401, { error: { code: "demo_expired", message: "x" } }));
    await waitFor(() => expect(h.get()).toBe("/demo-expired"));
  });

  it("renders app pages for a signed-in user and redirects / and /reports", async () => {
    const h = start("/", () => json(200, ME));
    await waitFor(() => expect(h.get()).toBe("/dashboard"));
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    h.set({ value: "/reports" });
    await waitFor(() => expect(h.get()).toBe("/reports/stock-on-date"));
  });

  it("sends signed-in users away from auth pages; demo users may open /sign-up", async () => {
    const h = start("/sign-in", () => json(200, ME));
    await waitFor(() => expect(h.get()).toBe("/dashboard"));
    cleanup();
    setMe(undefined);
    const h2 = start("/sign-up", () => json(200, { ...ME, is_demo: true, demo_expires_at: "2099-01-01T00:00:00Z" }));
    expect(await screen.findByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(h2.get()).toBe("/sign-up");
  });

  it("shows the 404 page for unknown paths", async () => {
    start("/nope/123", () => json(200, ME));
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByText("Error 404")).toHaveClass("nf-code");
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(document.title).toBe("Page not found · Inventory Manager");
  });

  it("a 401 from any API call goes to /sign-in through the central handler", async () => {
    const { api } = await import("./api/client");
    const h = start("/dashboard", (url) =>
      url === "/api/auth/me" ? json(200, ME) : json(401, { error: { code: "unauthenticated", message: "x" } }),
      true,
    );
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    await api.get("/api/products").catch(() => undefined);
    await waitFor(() => expect(h.get()).toBe("/sign-in"));
  });
});
