import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import ProductForm from "./ProductForm";
import { calls, clearToasts, product, renderAt, stubFetch, toastTitles } from "./testUtils";

const CATS = [{ id: 3, name: "Fasteners", product_count: 5, active_product_count: 5 }];
const cats = (u: string) => (/\/api\/categories$/.test(u) ? { body: CATS } : undefined);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearToasts();
});

function fill(id: string, v: string) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
  el.value = v;
  fireEvent.input(el);
  fireEvent.change(el);
}

describe("ProductForm", () => {
  it("shows inline errors and the error summary on an empty submit, without calling the API", async () => {
    const f = stubFetch(cats);
    renderAt("/products/new", "/products/new", ProductForm);
    await screen.findByLabelText("SKU");
    fireEvent.click(screen.getByRole("button", { name: /save product/i }));
    await screen.findByText("Fix 5 problems to save the product");
    const sku = screen.getByLabelText("SKU");
    expect(sku.getAttribute("aria-invalid")).toBe("true");
    expect(sku.getAttribute("aria-describedby")).toContain("f-sku-error");
    expect(document.getElementById("f-sku-error")!.textContent).toContain("Enter a SKU.");
    expect(calls(f, "POST", /\/api\/products/)).toHaveLength(0);
  });

  it("shows the duplicate SKU error from the server next to the field", async () => {
    const f = stubFetch(cats, (u, i) => {
      if (i.method === "POST" && /\/api\/products$/.test(u))
        return { status: 409, body: { error: { code: "duplicate_sku", message: "SKU taken",
          details: [{ field: "sku", message: "This SKU is already used.", type: "duplicate" }] } } };
      if (/\/api\/products\?/.test(u)) return { body: { items: [product()], counts: {} } };
      return undefined;
    });
    renderAt("/products/new", "/products/new", ProductForm);
    await screen.findByLabelText("SKU");
    await waitFor(() => expect(document.querySelectorAll("#f-category option").length).toBe(2));
    fill("f-sku", "fst-0012");
    fill("f-name", "Nails");
    fill("f-unit", "kg");
    fill("f-purchase", "3.4");
    fill("f-sale", "5.8");
    fireEvent.click(screen.getByRole("button", { name: /save product/i }));
    await waitFor(() =>
      expect(document.getElementById("f-sku-error")!.textContent).toContain("SKU FST-0012 is already used by ‘Galvanized nails 50 mm’"),
    );
    expect(screen.getByRole("link", { name: "View Galvanized nails 50 mm" }).getAttribute("href")).toBe("/products/12");
    expect(screen.getByLabelText("SKU").getAttribute("aria-invalid")).toBe("true");
    const body = JSON.parse(calls(f, "POST", /\/api\/products$/)[0][1]!.body as string);
    expect(body).toMatchObject({ sku: "fst-0012", unit: "kg", purchase_price: 3.4, category_id: null, min_stock: null });
  });

  it("edit: locks the unit after movements, saves with PUT and opens the details page with a toast", async () => {
    const f = stubFetch(cats, (u, i) => {
      if (/\/api\/products\/12$/.test(u)) return { body: i.method === "PUT" ? product({ name: "Nails 2" }) : product() };
      return undefined;
    });
    renderAt("/products/12/edit", "/products/:id/edit", ProductForm);
    await waitFor(() => expect((screen.getByLabelText("SKU") as HTMLInputElement).value).toBe("FST-0012"));
    const unit = screen.getByLabelText("Unit of measure") as HTMLSelectElement;
    expect(unit.disabled).toBe(true);
    expect(screen.getByText("The unit can’t be changed after stock movements are recorded.")).toBeTruthy();
    fill("f-name", "Nails 2");
    fireEvent.click(screen.getByRole("button", { name: /save product/i }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/products/12"));
    expect(calls(f, "PUT", /\/api\/products\/12$/)).toHaveLength(1);
    expect(toastTitles()).toContain("Product saved");
  });

  it("server unit error is shown inline", async () => {
    stubFetch(cats, (u, i) => {
      if (/\/api\/products\/12$/.test(u))
        return i.method === "PUT"
          ? { status: 422, body: { error: { code: "validation_error", message: "Invalid",
              details: [{ field: "unit", message: "The unit can't be changed after stock movements are recorded.", type: "x" }] } } }
          : { body: product({ has_movements: false, stock: 0 }) };
      return undefined;
    });
    renderAt("/products/12/edit", "/products/:id/edit", ProductForm);
    await waitFor(() => expect((screen.getByLabelText("Unit of measure") as HTMLSelectElement).disabled).toBe(false));
    fill("f-unit", "pcs");
    fill("f-min", "20");
    fireEvent.click(screen.getByRole("button", { name: /save product/i }));
    await waitFor(() => expect(document.getElementById("f-unit-error")!.textContent).toContain("can't be changed"));
    expect(screen.getByTestId("where").textContent).toBe("/products/12/edit");
  });
});
