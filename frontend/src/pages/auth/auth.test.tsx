import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory, useLocation } from "@solidjs/router";
import type { Component } from "solid-js";
import { me, setMe, type Me } from "../../lib/auth";
import SignIn from "./SignIn";
import SignUp from "./SignUp";
import SignedOut from "./SignedOut";
import DemoExpired from "./DemoExpired";

const REGULAR: Me = { id: 1, email: "a@b.com", is_demo: false, demo_expires_at: null, currency: "USD", created_at: "2026-11-01T10:00:00Z" };
const DEMO: Me = { ...REGULAR, id: 2, email: "demo-1@demo.inventory.app", is_demo: true, demo_expires_at: "2026-11-06T10:00:00Z" };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const apiErr = (status: number, code: string, message: string, details: unknown[] = [], extra = {}) =>
  json(status, { error: { code, message, details, ...extra } });

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderAt(Page: Component, path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path="*" component={() => (<><Page /><Where /></>)} />
    </MemoryRouter>
  ));
}

let fetchMock: ReturnType<typeof vi.fn>;
let routes: Record<string, () => Response | Promise<Response>>;
beforeEach(() => {
  routes = { "GET /api/auth/me": () => json(200, me() ?? REGULAR) };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).split("?")[0]}`;
    const h = routes[key];
    if (!h) throw new Error(`unexpected ${key}`);
    return h();
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  setMe(undefined);
  vi.unstubAllGlobals();
});

const input = (id: string, v: string) => fireEvent.input(document.getElementById(id)!, { target: { value: v } });
const where = () => screen.getByTestId("where").textContent;
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

describe("SignIn", () => {
  it("shows inline errors and a summary when the form is empty, without calling the API", async () => {
    renderAt(SignIn, "/sign-in");
    fireEvent.submit(document.getElementById("sign-in-form")!);
    expect(await screen.findByText("There are 2 problems with your sign-in details")).toBeInTheDocument();
    const email = document.getElementById("email")!;
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-describedby", "email-error");
    expect(document.getElementById("email-error")).toHaveTextContent("Enter your email address");
    expect(document.getElementById("password-error")).toHaveTextContent("Enter your password");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("single invalid email → inline error only, fixed on input", async () => {
    renderAt(SignIn, "/sign-in");
    input("email", "bad");
    input("password", "x");
    fireEvent.submit(document.getElementById("sign-in-form")!);
    expect(document.getElementById("email-error")).toHaveTextContent("Enter a valid email address, like name@example.com");
    expect(document.querySelector(".error-summary")).toBeNull();
    input("email", "a@b.com");
    expect(document.getElementById("email")).not.toHaveAttribute("aria-invalid");
  });

  it("wrong credentials → alert, password cleared", async () => {
    routes["POST /api/auth/sign-in"] = () => apiErr(401, "invalid_credentials", "The email or password is incorrect.");
    renderAt(SignIn, "/sign-in");
    input("email", "a@b.com");
    input("password", "nope1234");
    fireEvent.submit(document.getElementById("sign-in-form")!);
    expect(await screen.findByText("Couldn’t sign you in")).toBeInTheDocument();
    expect(screen.getByText("Email or password is incorrect. Check them and try again.")).toBeInTheDocument();
    expect((document.getElementById("password") as HTMLInputElement).value).toBe("");
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ email: "a@b.com", password: "nope1234" });
  });

  it("too many attempts → alert with the server message", async () => {
    routes["POST /api/auth/sign-in"] = () =>
      apiErr(429, "too_many_attempts", "Too many failed sign-in attempts. Try again in a few minutes.", [], { retry_after: 900 });
    renderAt(SignIn, "/sign-in");
    input("email", "a@b.com");
    input("password", "nope1234");
    fireEvent.submit(document.getElementById("sign-in-form")!);
    expect(await screen.findByText("Too many sign-in attempts")).toBeInTheDocument();
    expect(screen.getByText("Too many failed sign-in attempts. Try again in a few minutes.")).toBeInTheDocument();
  });

  it("server field errors are shown inline", async () => {
    routes["POST /api/auth/sign-in"] = () =>
      apiErr(422, "validation_error", "Check the highlighted fields.", [{ field: "email", message: "Enter a valid email address, like name@company.com.", type: "value_error" }]);
    renderAt(SignIn, "/sign-in");
    input("email", "a@b.co");
    input("password", "x");
    fireEvent.submit(document.getElementById("sign-in-form")!);
    await waitFor(() => expect(document.getElementById("email-error")).toHaveTextContent("like name@company.com."));
  });

  it("success → /dashboard", async () => {
    routes["POST /api/auth/sign-in"] = () => json(200, REGULAR);
    renderAt(SignIn, "/sign-in");
    input("email", "A@b.com ");
    input("password", "password1");
    fireEvent.submit(document.getElementById("sign-in-form")!);
    await waitFor(() => expect(where()).toBe("/dashboard"));
    expect(me()).toMatchObject({ email: "a@b.com" });
  });

  it("Try demo shows the loading state, then goes to /dashboard", async () => {
    let resolve!: (r: Response) => void;
    routes["POST /api/auth/demo"] = () => new Promise<Response>((r) => (resolve = r));
    renderAt(SignIn, "/sign-in");
    fireEvent.click(document.getElementById("demo-btn")!);
    const btn = document.getElementById("demo-btn")!;
    await waitFor(() => expect(btn).toHaveAttribute("aria-busy", "true"));
    expect(btn).toHaveTextContent("Preparing your demo workspace…");
    expect(document.getElementById("sign-in-fields")).toBeDisabled();
    resolve(json(201, DEMO));
    await waitFor(() => expect(where()).toBe("/dashboard"));
  });

  it("demo rate limit → alert, button restored", async () => {
    routes["POST /api/auth/demo"] = () =>
      apiErr(429, "rate_limited", "Too many demo workspaces were started from your network. Try again later or sign up.");
    renderAt(SignIn, "/sign-in");
    fireEvent.click(document.getElementById("demo-btn")!);
    expect(await screen.findByText("Couldn’t start a demo")).toBeInTheDocument();
    expect(document.getElementById("demo-btn")).toHaveTextContent("Try demo");
    expect(where()).toBe("/sign-in");
  });
});

describe("SignUp", () => {
  const fill = (e: string, p: string, c: string) => {
    input("email", e);
    input("password", p);
    input("confirm", c);
    fireEvent.submit(document.getElementById("sign-up-form")!);
  };

  it("client validation: summary with labelled items", async () => {
    renderAt(SignUp, "/sign-up");
    fill("alex@northwind", "stock12", "stock123");
    expect(await screen.findByText("Fix 3 problems to create your account")).toBeInTheDocument();
    expect(screen.getByText("Password: Password must be at least 8 characters")).toBeInTheDocument();
    expect(document.getElementById("confirm-error")).toHaveTextContent("Passwords don’t match");
    expect(document.getElementById("password")).toHaveAttribute("aria-describedby", "password-hint password-error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("email taken → inline error + alert with sign-in link", async () => {
    routes["POST /api/auth/sign-up"] = () =>
      apiErr(409, "email_taken", "An account with this email already exists.", [{ field: "email", message: "An account with this email already exists.", type: "email_taken" }]);
    renderAt(SignUp, "/sign-up");
    fill("a@b.com", "password1", "password1");
    expect(await screen.findByText("Email already in use")).toBeInTheDocument();
    expect(document.getElementById("email-error")).toHaveTextContent("This email is already registered");
    expect(screen.getByText("Sign in instead?")).toHaveAttribute("href", "/sign-in");
  });

  it("server password error shown inline", async () => {
    routes["POST /api/auth/sign-up"] = () =>
      apiErr(422, "validation_error", "Check the highlighted fields.", [{ field: "password", message: "Use at least 8 characters.", type: "value_error" }]);
    renderAt(SignUp, "/sign-up");
    fill("a@b.com", "password1", "password1");
    await waitFor(() => expect(document.getElementById("password-error")).toHaveTextContent("Use at least 8 characters."));
  });

  it("demo session: explains that the demo is deleted; success → /dashboard", async () => {
    setMe(DEMO);
    routes["POST /api/auth/sign-up"] = () => json(201, REGULAR);
    renderAt(SignUp, "/sign-up");
    expect(screen.getByText("You’re in a demo")).toBeInTheDocument();
    expect(screen.getByText(/demo workspace and all its data are deleted/)).toBeInTheDocument();
    expect(screen.queryByText("Try demo instead")).toBeNull();
    fill("a@b.com", "password1", "password1");
    await waitFor(() => expect(where()).toBe("/dashboard"));
    expect(me()?.is_demo).toBe(false);
  });
});

describe("SignedOut / DemoExpired", () => {
  it("regular variant", () => {
    renderAt(SignedOut, "/signed-out");
    expect(screen.getByRole("heading", { name: "You’ve been signed out" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByText("Try demo")).toBeInTheDocument();
  });

  it("demo variant starts a new demo", async () => {
    routes["POST /api/auth/demo"] = () => json(201, DEMO);
    renderAt(SignedOut, "/signed-out?demo=1");
    expect(screen.getByRole("heading", { name: "You left the demo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up");
    fireEvent.click(screen.getByText("Start a new demo"));
    await waitFor(() => expect(where()).toBe("/dashboard"));
  });

  it("demo expired: start a new demo, error shown on failure", async () => {
    routes["POST /api/auth/demo"] = () => apiErr(429, "rate_limited", "Too many demo workspaces were started from your network.");
    renderAt(DemoExpired, "/demo-expired");
    expect(screen.getByRole("heading", { name: "Your demo session has ended" })).toBeInTheDocument();
    fireEvent.click(document.getElementById("new-demo-btn")!);
    expect(await screen.findByText("Too many demo workspaces were started from your network.")).toBeInTheDocument();
    expect(where()).toBe("/demo-expired");
  });
});
