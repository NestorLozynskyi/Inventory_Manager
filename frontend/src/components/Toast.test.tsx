import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { ToastRegion, clearToasts, toast } from "./Toast";

afterEach(() => {
  cleanup();
  clearToasts();
  vi.useRealTimers();
});

describe("toast", () => {
  it("renders into the polite live region with the app.js markup", async () => {
    render(() => <ToastRegion />);
    toast({ type: "success", title: "Receipt posted", text: "Stock updated for 3 products." });
    const title = await screen.findByText("Receipt posted");
    const t = title.closest(".toast")!;
    expect(t).toHaveClass("toast", "toast-success");
    expect(t).not.toHaveAttribute("role");
    expect(t.querySelector(".toast-icon svg")).toHaveClass("icon-check-circle");
    expect(t.querySelector(".toast-text")).toHaveTextContent("Stock updated for 3 products.");
    const region = t.parentElement!;
    expect(region).toHaveClass("toast-region");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-label", "Notifications");
  });

  it("uses role=alert for errors and dismisses via the close button", async () => {
    render(() => <ToastRegion />);
    toast({ type: "error", title: "Couldn’t post" });
    const t = (await screen.findByText("Couldn’t post")).closest(".toast")!;
    expect(t).toHaveAttribute("role", "alert");
    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    expect(t).toHaveClass("is-leaving");
    await waitFor(() => expect(screen.queryByText("Couldn’t post")).toBeNull());
  });

  it("auto-dismisses after the duration, pauses on hover, 0 = sticky", async () => {
    vi.useFakeTimers();
    render(() => <ToastRegion />);
    toast({ type: "info", title: "Auto", duration: 1000 });
    toast({ title: "Sticky", duration: 0 });
    const auto = screen.getByText("Auto").closest(".toast")!;
    expect(auto).toHaveClass("toast-info");
    fireEvent.mouseEnter(auto);
    vi.advanceTimersByTime(3000);
    expect(screen.getByText("Auto")).toBeInTheDocument();
    fireEvent.mouseLeave(auto);
    vi.advanceTimersByTime(1000 + 140);
    expect(screen.queryByText("Auto")).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(screen.getByText("Sticky")).toBeInTheDocument();
  });

  it("returns a handle that dismisses the toast", async () => {
    vi.useFakeTimers();
    render(() => <ToastRegion />);
    const h = toast({ title: "Exporting…", duration: 0 });
    expect(screen.getByText("Exporting…")).toBeInTheDocument();
    h.dismiss();
    vi.advanceTimersByTime(200);
    expect(screen.queryByText("Exporting…")).toBeNull();
  });
});
