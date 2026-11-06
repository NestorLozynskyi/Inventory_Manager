import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { createLoader } from "./resource";
import { LoadView } from "../components/LoadView";
import { EmptyState } from "../components/EmptyState";
import { ApiError } from "../api/client";

describe("createLoader + LoadView", () => {
  it("goes loading → error (retry) → ready / empty, and reloads when tracked signals change", async () => {
    const [q, setQ] = createSignal("");
    const fetcher = vi
      .fn<(q: string) => Promise<string[]>>()
      .mockRejectedValueOnce(new ApiError(0, "network_error", "offline"))
      .mockResolvedValueOnce(["Tape", "Glue"])
      .mockResolvedValueOnce([]);
    render(() => {
      const l = createLoader(() => fetcher(q()));
      return (
        <LoadView loader={l} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No products found" />}>
          {(d) => <ul>{d().map((x) => <li>{x}</li>)}</ul>}
        </LoadView>
      );
    });
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load data");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Tape")).toBeInTheDocument();
    setQ("zzz");
    expect(await screen.findByText("No products found")).toBeInTheDocument();
    expect(fetcher).toHaveBeenLastCalledWith("zzz");
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  });
});
