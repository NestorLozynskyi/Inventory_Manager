import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { Modal, Sheet, confirm } from "./Modal";

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
});
afterEach(() => {
  cleanup();
  root.remove();
  document.body.innerHTML = "";
  document.documentElement.className = "";
});

function Harness(props: { danger?: boolean; withInput?: boolean }) {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal
        open={open()}
        onClose={() => setOpen(false)}
        title="Archive product?"
        size="sm"
        confirmLabel="Archive"
        confirmVariant={props.danger ? "danger" : "primary"}
        onConfirm={() => setOpen(false)}
      >
        <p>It disappears from lists.</p>
        {props.withInput && <input aria-label="Note" />}
      </Modal>
    </>
  );
}

const openWith = async (opener: HTMLElement) => {
  opener.focus();
  fireEvent.click(opener);
  return screen.findByRole("dialog");
};

describe("Modal", () => {
  it("renders the app.js markup with aria attributes", async () => {
    render(() => <Harness />, { container: root });
    const dialog = await openWith(screen.getByText("Open"));
    expect(dialog).toHaveClass("modal", "modal-sm");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.parentElement).toHaveClass("modal-backdrop");
    const title = dialog.querySelector(".modal-header > h2.modal-title")!;
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(title).toHaveTextContent("Archive product?");
    const body = dialog.querySelector(".modal-body")!;
    expect(dialog.getAttribute("aria-describedby")).toBe(body.id);
    expect(dialog.querySelector(".modal-close")).toHaveAttribute("aria-label", "Close");
    const footer = dialog.querySelector(".modal-footer")!;
    expect(Array.from(footer.querySelectorAll("button")).map((b) => [b.className, b.textContent])).toEqual([
      ["btn btn-secondary", "Cancel"],
      ["btn btn-primary", "Archive"],
    ]);
    // overlay is outside the inert app root
    expect(root.contains(dialog)).toBe(false);
  });

  it("sets has-overlay + inert while open and focuses the confirm button", async () => {
    render(() => <Harness />, { container: root });
    const dialog = await openWith(screen.getByText("Open"));
    expect(document.documentElement).toHaveClass("has-overlay");
    expect(root).toHaveAttribute("inert");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Archive")));
    expect(dialog).toBeInTheDocument();
  });

  it("focuses Cancel for danger dialogs and the first field when there is one", async () => {
    const { unmount } = render(() => <Harness danger />, { container: root });
    await openWith(screen.getByText("Open"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Cancel")));
    unmount();
    render(() => <Harness withInput />, { container: root });
    await openWith(screen.getByText("Open"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Note")));
  });

  it("closes on Escape with the is-closing animation and returns focus to the opener", async () => {
    render(() => <Harness />, { container: root });
    const opener = screen.getByText("Open");
    const dialog = await openWith(opener);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Archive")));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(dialog.parentElement).toHaveClass("is-closing");
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement).not.toHaveClass("has-overlay");
    expect(root).not.toHaveAttribute("inert");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on backdrop mousedown but not on mousedown inside the dialog", async () => {
    render(() => <Harness />, { container: root });
    const dialog = await openWith(screen.getByText("Open"));
    fireEvent.mouseDown(dialog);
    expect(dialog.parentElement).not.toHaveClass("is-closing");
    fireEvent.mouseDown(dialog.parentElement!);
    expect(dialog.parentElement).toHaveClass("is-closing");
  });

  it("traps Tab focus inside the dialog", async () => {
    render(() => <Harness />, { container: root });
    const dialog = await openWith(screen.getByText("Open"));
    const close = dialog.querySelector<HTMLElement>(".modal-close")!;
    const confirmBtn = screen.getByText("Archive");
    await waitFor(() => expect(document.activeElement).toBe(confirmBtn));
    fireEvent.keyDown(confirmBtn, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirmBtn);
  });

  it("does not close on Escape when dismissible=false", async () => {
    render(() => (
      <Modal open onClose={() => undefined} title="Busy" dismissible={false}>
        <p>Working…</p>
      </Modal>
    ), { container: root });
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector(".modal-close")).toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog.parentElement).not.toHaveClass("is-closing");
  });
});

describe("Sheet", () => {
  it("renders the sheet markup", async () => {
    render(() => (
      <Sheet open onClose={() => undefined} title="More">
        <a href="/history">History</a>
      </Sheet>
    ), { container: root });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("sheet");
    expect(dialog.parentElement).toHaveClass("sheet-backdrop");
    expect(dialog.querySelector(".sheet-handle")).toHaveAttribute("aria-hidden", "true");
    expect(dialog.querySelector(".sheet-title")).toHaveTextContent("More");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
  });
});

describe("confirm()", () => {
  it("resolves true on confirm", async () => {
    const p = confirm({ title: "Delete draft?", body: "This can’t be undone.", confirmLabel: "Delete", confirmVariant: "danger" });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("modal-sm");
    expect(dialog.querySelector(".modal-body p")).toHaveTextContent("This can’t be undone.");
    expect(screen.getByText("Delete")).toHaveClass("btn-danger");
    fireEvent.click(screen.getByText("Delete"));
    await expect(p).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("resolves false on Cancel, Escape and ×", async () => {
    let p = confirm({ title: "A?" });
    fireEvent.click(await screen.findByText("Cancel"));
    await expect(p).resolves.toBe(false);

    p = confirm({ title: "B?" });
    const d = await screen.findByRole("dialog", { name: "B?" });
    fireEvent.keyDown(d, { key: "Escape" });
    await expect(p).resolves.toBe(false);

    p = confirm({ title: "C?" });
    const d2 = await screen.findByRole("dialog", { name: "C?" });
    fireEvent.click(d2.querySelector(".modal-close")!);
    await expect(p).resolves.toBe(false);
  });

  it("runs an async action with a loading button and stays open when it fails", async () => {
    let attempt = 0;
    const p = confirm({
      title: "Post?",
      confirmLabel: "Post",
      action: () =>
        new Promise<void>((resolve, reject) => {
          attempt += 1;
          setTimeout(() => (attempt === 1 ? reject(new Error("Not enough stock.")) : resolve()), 10);
        }),
    });
    const btn = await screen.findByText("Post");
    fireEvent.click(btn);
    expect(btn).toHaveClass("is-loading");
    expect(btn).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(btn).not.toHaveClass("is-loading"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(btn);
    await expect(p).resolves.toBe(true);
    expect(attempt).toBe(2);
  });
});
