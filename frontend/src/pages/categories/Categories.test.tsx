import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import Categories, { blockedText, checkCategoryName } from "./Categories";
import { calls, clearToasts, renderAt, stubFetch, toastTitles } from "../products/testUtils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearToasts();
});

const CATS = [
  { id: 1, name: "Fasteners", product_count: 5, active_product_count: 4 },
  { id: 2, name: "Garden", product_count: 0, active_product_count: 0 },
];

describe("category helpers", () => {
  it("validates names", () => {
    expect(checkCategoryName("  ", CATS, null)).toBe("Enter a category name.");
    expect(checkCategoryName("x".repeat(61), CATS, null)).toBe("Use at most 60 characters.");
    expect(checkCategoryName("fasteners", CATS, null)).toBe("A category named ‘Fasteners’ already exists.");
    expect(checkCategoryName("Fasteners", CATS, 1)).toBe("");
    expect(blockedText(5, 1)).toBe("5 products use this category (including 1 archived). Move them to another category or archive them first.");
  });
});

describe("Categories page", () => {
  it("empty state", async () => {
    stubFetch((u) => (/\/api\/categories$/.test(u) ? { body: [] } : undefined));
    renderAt("/categories", "/categories", Categories);
    await screen.findByText("No categories yet");
  });

  it("create shows the server duplicate-name error inline", async () => {
    const f = stubFetch((u, i) => {
      if (/\/api\/categories$/.test(u) && i.method === "POST")
        return { status: 409, body: { error: { code: "duplicate_name", message: "Dup", details: [{ field: "name", message: "A category named ‘Tools’ already exists.", type: "x" }] } } };
      if (/\/api\/categories$/.test(u)) return { body: CATS };
      return undefined;
    });
    renderAt("/categories", "/categories", Categories);
    await screen.findByText("Garden");
    fireEvent.click(screen.getAllByRole("button", { name: /new category/i })[0]);
    const input = (await screen.findByLabelText("Name")) as HTMLInputElement;
    input.value = "Tools";
    fireEvent.input(input);
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));
    await waitFor(() => expect(document.getElementById("cat-name-error")!.textContent).toContain("already exists"));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(calls(f, "POST", /\/api\/categories$/)).toHaveLength(1);
  });

  it("delete of a used category explains why instead of deleting", async () => {
    const f = stubFetch((u) => (/\/api\/categories$/.test(u) ? { body: CATS } : undefined));
    renderAt("/categories", "/categories", Categories);
    await screen.findByText("Garden");
    fireEvent.click(screen.getByRole("button", { name: "Delete Fasteners (in use)" }));
    await screen.findByText("Can’t delete ‘Fasteners’");
    expect(screen.getByText(/5 products use this category \(including 1 archived\)/)).toBeTruthy();
    expect(calls(f, "DELETE", /categories/)).toHaveLength(0);
  });

  it("delete confirm deletes an unused category; 409 category_in_use switches to the blocked dialog", async () => {
    let inUse = false;
    const f = stubFetch((u, i) => {
      if (/\/api\/categories\/2$/.test(u) && i.method === "DELETE")
        return inUse ? { status: 409, body: { error: { code: "category_in_use", message: "In use", product_count: 2 } } } : { status: 204 };
      if (/\/api\/categories$/.test(u)) return { body: CATS };
      return undefined;
    });
    renderAt("/categories", "/categories", Categories);
    await screen.findByText("Garden");
    fireEvent.click(screen.getByRole("button", { name: "Delete Garden" }));
    await screen.findByText("Delete category ‘Garden’?");
    fireEvent.click(screen.getByRole("button", { name: "Delete category" }));
    await waitFor(() => expect(toastTitles()).toContain("Category deleted"));
    expect(calls(f, "DELETE", /categories\/2$/)).toHaveLength(1);

    inUse = true;
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Delete Garden" }));
    await screen.findByText("Delete category ‘Garden’?");
    fireEvent.click(screen.getByRole("button", { name: "Delete category" }));
    await screen.findByText("Can’t delete ‘Garden’");
    expect(screen.getByText(/2 products use this category/)).toBeTruthy();
  });
});
