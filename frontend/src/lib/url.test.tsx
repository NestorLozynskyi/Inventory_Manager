import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory, useLocation } from "@solidjs/router";
import { filtersToQuery, parseFilters, useListFilters } from "./url";

const DEFAULTS = { search: "", status: "active", page: 1, low_stock: false, sort: "name" };

describe("parseFilters / filtersToQuery", () => {
  it("applies defaults, types and enums", () => {
    expect(parseFilters({}, DEFAULTS)).toEqual(DEFAULTS);
    expect(
      parseFilters({ search: "tape", status: "archived", page: "3", low_stock: "1", extra: "x" }, DEFAULTS, {
        enums: { status: ["active", "archived", "all"] },
      }),
    ).toEqual({ search: "tape", status: "archived", page: 3, low_stock: true, sort: "name" });
    expect(parseFilters({ status: "bogus", page: "abc" }, DEFAULTS, { enums: { status: ["active"] } })).toEqual(DEFAULTS);
    expect(parseFilters({ search: ["a", "b"] }, DEFAULTS).search).toBe("a");
  });

  it("removes default / empty values from the URL", () => {
    expect(filtersToQuery({ search: "", status: "active", page: 2, low_stock: true }, DEFAULTS)).toEqual({
      search: null,
      status: null,
      page: "2",
      low_stock: "1",
    });
    const BOOL_DEFAULTS: { low_stock: boolean } = { low_stock: true };
    expect(filtersToQuery({ low_stock: true }, BOOL_DEFAULTS)).toEqual({ low_stock: null });
    expect(filtersToQuery({ low_stock: false }, BOOL_DEFAULTS)).toEqual({ low_stock: "0" });
  });
});

describe("useListFilters", () => {
  it("reads and writes filters in the query string", async () => {
    const history = createMemoryHistory();
    history.set({ value: "/products?status=archived&search=tape" });
    function Page() {
      const [filters, setFilters, reset] = useListFilters(DEFAULTS);
      const loc = useLocation();
      return (
        <>
          <p data-testid="f">{JSON.stringify(filters())}</p>
          <p data-testid="q">{loc.search}</p>
          <button onClick={() => setFilters({ low_stock: true, search: "" })}>set</button>
          <button onClick={reset}>reset</button>
        </>
      );
    }
    render(() => (
      <MemoryRouter history={history}>
        <Route path="/products" component={Page} />
      </MemoryRouter>
    ));
    expect(JSON.parse(screen.getByTestId("f").textContent!)).toMatchObject({ status: "archived", search: "tape" });
    fireEvent.click(screen.getByText("set"));
    expect(await screen.findByText("?status=archived&low_stock=1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("reset"));
    await waitFor(() => expect(screen.getByTestId("q").textContent).toBe(""));
    expect(JSON.parse(screen.getByTestId("f").textContent!)).toEqual(DEFAULTS);
  });
});
