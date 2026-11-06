import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { api, qs, ApiError } from "../../api/client";
import { AppShell } from "../../components/AppShell";
import { Badge } from "../../components/Badge";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { Menu, type MenuItem } from "../../components/Menu";
import { SkeletonRows } from "../../components/SkeletonRows";
import { toast } from "../../components/Toast";
import { fmtMoney, fmtQty, plural } from "../../lib/format";
import { createLoader } from "../../lib/resource";
import { useListFilters } from "../../lib/url";
import { ArchiveProductModal, restoreProduct } from "./ArchiveProductModal";
import { categoryLabel, isLow, type Category, type Product, type ProductListResponse } from "./types";
import "./ProductList.css";
import { StockQty } from "../../components/StockQty";

export const PAGE_SIZE = 20;

export const SORT_KEYS = [
  "sku",
  "name",
  "category",
  "stock",
  "min_stock",
  "purchase_price",
  "avg_cost",
  "sale_price",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
/** Sort keys the API supports; the others are applied to the loaded list on the client. */
const SERVER_SORTS = new Set<string>(["name", "sku", "category", "stock"]);

// col: column sizing class (TASK-005, see "column sizing" in styles/app.css)
const COLS: { key: SortKey | "unit"; label: string; num?: boolean; nosort?: boolean; col: string }[] = [
  { key: "sku", label: "SKU", col: "col-fit" },
  { key: "name", label: "Name", col: "col-grow" },
  { key: "category", label: "Category", col: "col-label" },
  { key: "unit", label: "Unit", nosort: true, col: "col-fit" },
  { key: "stock", label: "Stock", num: true, col: "col-fit" },
  { key: "min_stock", label: "Min stock", num: true, col: "col-fit th-wrap" },
  { key: "purchase_price", label: "Purchase price", num: true, col: "col-fit th-wrap" },
  { key: "avg_cost", label: "Avg cost", num: true, col: "col-fit th-wrap" },
  { key: "sale_price", label: "Sale price", num: true, col: "col-fit th-wrap" },
];

const MOBILE_SORTS: [string, string][] = [
  ["name:asc", "Name (A–Z)"],
  ["name:desc", "Name (Z–A)"],
  ["sku:asc", "SKU"],
  ["stock:asc", "Stock (low to high)"],
  ["stock:desc", "Stock (high to low)"],
  ["purchase_price:desc", "Purchase price (high to low)"],
  ["avg_cost:desc", "Avg cost (high to low)"],
  ["sale_price:desc", "Sale price (high to low)"],
];

export const DEFAULT_FILTERS = {
  search: "",
  category_id: "",
  low_stock: false,
  status: "active",
  sort: "name",
  order: "asc",
  page: 1,
};
export type ProductFilters = typeof DEFAULT_FILTERS;

/** Query params for GET /api/products and the CSV export. */
export function apiParams(f: ProductFilters): Record<string, string | boolean> {
  const server = SERVER_SORTS.has(f.sort);
  return {
    search: f.search.trim(),
    category_id: f.category_id,
    status: f.status === "active" ? "" : f.status,
    low_stock: f.low_stock ? true : "",
    sort: server && f.sort !== "name" ? f.sort : "",
    order: server && f.order === "desc" ? "desc" : "",
  };
}

function sortValue(p: Product, key: string): string | number {
  switch (key) {
    case "sku":
      return p.sku.toLowerCase();
    case "name":
      return p.name.toLowerCase();
    case "category":
      return (p.category_name ?? "").toLowerCase();
    case "min_stock":
      return p.min_stock == null ? -1 : p.min_stock;
    case "purchase_price":
      return p.purchase_price;
    case "avg_cost":
      return p.avg_cost;
    case "sale_price":
      return p.sale_price;
    default:
      return p.stock;
  }
}

/** Items shown for the filters: archived rows never count as low stock; client-side sort keys applied. */
export function visibleItems(items: Product[], f: ProductFilters): Product[] {
  let list = f.low_stock ? items.filter((p) => !p.archived) : items.slice();
  if (!SERVER_SORTS.has(f.sort)) {
    const dir = f.order === "desc" ? -1 : 1;
    list = list
      .map((p, i) => ({ p, i }))
      .sort((a, b) => {
        const x = sortValue(a.p, f.sort);
        const y = sortValue(b.p, f.sort);
        return (x < y ? -1 : x > y ? 1 : 0) * dir || a.i - b.i;
      })
      .map((x) => x.p);
  }
  return list;
}

export default function ProductList() {
  const navigate = useNavigate();
  const [filters, setFilters, resetFilters] = useListFilters(DEFAULT_FILTERS, {
    enums: {
      status: ["active", "archived", "all"],
      order: ["asc", "desc"],
      sort: SORT_KEYS,
    },
  });

  const query = createMemo(() => qs(apiParams(filters())));
  const products = createLoader((signal) => api.get<ProductListResponse>(`/api/products${query()}`, signal));
  const categories = createLoader((signal) => api.get<Category[]>("/api/categories", signal));

  /* ---- search (debounced into the URL) ---- */
  const [q, setQ] = createSignal(filters().search);
  let searchInput: HTMLInputElement | undefined;
  let qTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      () => filters().search,
      (s) => {
        if (s !== q()) setQ(s);
      },
      { defer: true },
    ),
  );
  onCleanup(() => clearTimeout(qTimer));
  const onSearch = (v: string) => {
    setQ(v);
    clearTimeout(qTimer);
    qTimer = setTimeout(() => setFilters({ search: v, page: 1 }), 250);
  };

  const f = filters;
  const list = createMemo(() => {
    const d = products.data();
    return d ? visibleItems(d.items, f()) : [];
  });
  const pages = () => Math.max(1, Math.ceil(list().length / PAGE_SIZE));
  const page = () => Math.min(Math.max(1, Math.floor(f().page)), pages());
  const slice = () => list().slice((page() - 1) * PAGE_SIZE, page() * PAGE_SIZE);
  const firstRun = () => products.data()?.counts.all === 0;
  const isFiltered = () => !!(f().search.trim() || f().category_id || f().low_stock || f().status !== "active");

  const categoryName = (id: string) => {
    if (id === "none") return "No category";
    return categories.data()?.find((c) => String(c.id) === id)?.name ?? "the selected category";
  };
  const activeFiltersText = () => {
    const parts: string[] = [];
    if (f().status === "archived") parts.push("archived");
    if (f().status === "all") parts.push("active and archived");
    if (f().category_id === "none") parts.push("without category");
    else if (f().category_id) parts.push(`in ${categoryName(f().category_id)}`);
    if (f().low_stock) parts.push("low stock only");
    if (f().search.trim()) parts.push(`matching “${f().search.trim()}”`);
    return parts.join(" · ");
  };

  const reset = () => {
    clearTimeout(qTimer);
    setQ("");
    resetFilters();
  };
  const clearSearch = () => {
    clearTimeout(qTimer);
    setQ("");
    setFilters({ search: "", page: 1 });
    searchInput?.focus();
  };

  const toggleSort = (key: SortKey) => {
    if (f().sort === key) setFilters({ order: f().order === "asc" ? "desc" : "asc" });
    else setFilters({ sort: key, order: "asc" });
    queueMicrotask(() => document.querySelector<HTMLElement>(`[data-sort="${key}"]`)?.focus());
  };

  const goPage = (n: number) => {
    setFilters({ page: Math.min(Math.max(1, n), pages()) });
    document.getElementById("list-root")?.scrollIntoView({ block: "start" });
  };

  /* ---- export ---- */
  const [exporting, setExporting] = createSignal(false);
  const exportCsv = async () => {
    if (exporting()) return;
    setExporting(true);
    try {
      const n = list().length;
      const name = await api.download(`/api/products/export.csv${query()}`, "products.csv");
      toast({
        type: "success",
        title: `${name} exported · ${n} ${plural(n, "row")}`,
        text: SERVER_SORTS.has(f().sort)
          ? "Exported with the current filters and sort."
          : "Exported with the current filters, sorted by name.",
      });
    } catch (err) {
      toast({ type: "error", title: "Couldn’t export products", text: err instanceof ApiError ? err.message : undefined });
    } finally {
      setExporting(false);
    }
  };

  /* ---- archive / restore ---- */
  const [archiveTarget, setArchiveTarget] = createSignal<Product | null>(null);
  const restore = async (p: Product) => {
    try {
      await restoreProduct(p);
      void products.reload();
    } catch (err) {
      toast({ type: "error", title: err instanceof ApiError ? err.message : "Couldn’t restore the product." });
    }
  };
  const menuItems = (p: Product): MenuItem[] => [
    { label: "View details", icon: "eye", href: `/products/${p.id}` },
    { label: "Edit", icon: "pencil", href: `/products/${p.id}/edit` },
    { divider: true },
    p.archived
      ? { label: "Restore", icon: "archive-restore", onClick: () => void restore(p) }
      : { label: "Archive", icon: "archive", onClick: () => setArchiveTarget(p) },
  ];

  const onRowClick = (e: MouseEvent, href: string) => {
    const t = e.target as HTMLElement;
    if (t.closest('a, button, input, select, textarea, label, [role="menuitem"]')) return;
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
    else navigate(href);
  };

  const mobileSortValue = () => `${f().sort}:${f().order}`;
  const mobileSortOptions = () => {
    const v = mobileSortValue();
    if (MOBILE_SORTS.some(([k]) => k === v)) return MOBILE_SORTS;
    const label = COLS.find((c) => c.key === f().sort)?.label ?? f().sort;
    return [...MOBILE_SORTS, [v, `${label} (${f().order === "asc" ? "ascending" : "descending"})`] as [string, string]];
  };

  const header = (): JSX.Element => (
    <thead>
      <tr>
        <For each={COLS}>
          {(c) => {
            const on = () => f().sort === c.key;
            const cls = () =>
              [c.num ? "num" : "", c.nosort ? "" : "sortable", c.col].filter(Boolean).join(" ") || undefined;
            return (
              <Show
                when={!c.nosort}
                fallback={
                  <th scope="col" class={cls()}>
                    {c.label}
                  </th>
                }
              >
                <th
                  scope="col"
                  class={cls()}
                  aria-sort={on() ? (f().order === "asc" ? "ascending" : "descending") : undefined}
                >
                  <button
                    type="button"
                    class={`th-sort${c.num ? " num" : ""}`}
                    data-sort={c.key}
                    onClick={() => toggleSort(c.key as SortKey)}
                  >
                    {c.label}
                    <Icon name={on() ? (f().order === "asc" ? "chevron-up" : "chevron-down") : "arrow-up-down"} size={14} />
                    <span class="visually-hidden">
                      {on() ? (f().order === "asc" ? ", sorted ascending" : ", sorted descending") : ", sort"}
                    </span>
                  </button>
                </th>
              </Show>
            );
          }}
        </For>
        <th scope="col" class="td-actions">
          <span class="visually-hidden">Actions</span>
        </th>
      </tr>
    </thead>
  );

  const row = (p: Product): JSX.Element => {
    const href = `/products/${p.id}`;
    const low = isLow(p);
    return (
      <tr class={`row-link${p.archived ? " is-archived" : ""}`} data-href={href} onClick={(e) => onRowClick(e, href)}>
        <td data-label="SKU" class="mono nowrap col-fit">
          {p.sku}
        </td>
        <td class="td-primary col-grow" data-label="Name">
          <span class="name-cell">
            <a class="cell-link" href={href}>
              {p.name}
            </a>
            <Show when={p.archived}>
              <Badge kind="archived" />
            </Show>
          </span>
        </td>
        <td data-label="Category" class="col-label">
          {categoryLabel(p)}
        </td>
        <td data-label="Unit" class="col-fit">
          {p.unit}
        </td>
        <td data-label="Stock" class="num col-fit">
          <StockQty qty={p.stock} unit={p.unit} low={low} />
        </td>
        <td data-label="Min stock" class="num col-fit">
          {p.min_stock == null ? <span aria-label="Not set">—</span> : fmtQty(p.min_stock, p.unit)}
        </td>
        <td data-label="Purchase price" class="num col-fit">
          {fmtMoney(p.purchase_price)}
        </td>
        <td data-label="Avg cost" class="num col-fit">
          {fmtMoney(p.avg_cost)}
        </td>
        <td data-label="Sale price" class="num col-fit">
          {fmtMoney(p.sale_price)}
        </td>
        <td class="td-actions">
          <Menu align="end" items={menuItems(p)}>
            {(t) => (
              <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label={`Actions for ${p.name}`} {...t}>
                <Icon name="more-horizontal" size={18} />
              </button>
            )}
          </Menu>
        </td>
      </tr>
    );
  };

  const pagination = (): JSX.Element => {
    const total = () => list().length;
    const from = () => (total() ? (page() - 1) * PAGE_SIZE + 1 : 0);
    const to = () => Math.min(total(), page() * PAGE_SIZE);
    return (
      <nav class="pagination" aria-label="Pagination">
        <span class="pagination-info">
          Showing {from()}–{to()} of {total()}
        </span>
        <Show when={pages() > 1}>
          <ul class="pagination-pages">
            <li>
              <button
                type="button"
                class="page-btn"
                aria-label="Previous page"
                disabled={page() <= 1}
                onClick={() => goPage(page() - 1)}
              >
                <Icon name="chevron-left" size={18} />
              </button>
            </li>
            <For each={Array.from({ length: pages() }, (_, i) => i + 1)}>
              {(i) => (
                <li>
                  <button
                    type="button"
                    class="page-btn"
                    aria-current={i === page() ? "page" : undefined}
                    aria-label={`Page ${i}`}
                    onClick={() => goPage(i)}
                  >
                    {i}
                  </button>
                </li>
              )}
            </For>
            <li>
              <button
                type="button"
                class="page-btn"
                aria-label="Next page"
                disabled={page() >= pages()}
                onClick={() => goPage(page() + 1)}
              >
                <Icon name="chevron-right" size={18} />
              </button>
            </li>
          </ul>
        </Show>
      </nav>
    );
  };

  const emptyResults = (): JSX.Element => {
    const s = f().search.trim();
    if (s)
      return (
        <EmptyState
          icon="search"
          title={`No products match “${s}”`}
          text={`Check the spelling or search by SKU, for example FST-0012.${
            f().category_id || f().low_stock || f().status !== "active" ? " Other filters are also applied." : ""
          }`}
          actions={
            <button type="button" class="btn btn-secondary" onClick={clearSearch}>
              <Icon name="x" size={18} />
              <span>Clear search</span>
            </button>
          }
        />
      );
    if (f().status === "archived" && !f().category_id && !f().low_stock)
      return (
        <EmptyState
          icon="archive"
          title="No archived products"
          text="Products you archive will appear here. You can restore them at any time."
        />
      );
    return (
      <EmptyState
        icon="filter"
        title="No products match these filters"
        text="Try another category or turn off “Low stock only”."
        actions={
          <button type="button" class="btn btn-secondary" onClick={reset}>
            Reset filters
          </button>
        }
      />
    );
  };

  return (
    <AppShell active="products" title="Products">
      <div class="page-header">
        <div>
          <h1>Products</h1>
          <p class="page-subtitle">Your product catalogue with current stock, prices and average cost.</p>
        </div>
        <div class="page-actions">
          <button
            type="button"
            class={`btn btn-secondary${exporting() ? " is-loading" : ""}`}
            aria-busy={exporting() ? "true" : undefined}
            disabled={exporting() || firstRun() || products.state() === "loading" || products.state() === "error"}
            onClick={() => void exportCsv()}
          >
            <Icon name="download" size={18} />
            <span>Export CSV</span>
          </button>
          <a class="btn btn-primary" href="/products/new">
            <Icon name="plus" size={18} />
            <span>New product</span>
          </a>
        </div>
      </div>

      <Show when={!firstRun()}>
        <form
          class="toolbar"
          role="search"
          aria-label="Filter products"
          onSubmit={(e) => e.preventDefault()}
          inert={products.state() === "loading" ? true : undefined}
        >
          <div class="search">
            <span class="search-icon">
              <Icon name="search" size={18} />
            </span>
            <label for="q" class="visually-hidden">
              Search by name or SKU
            </label>
            <input
              ref={searchInput}
              class="input"
              type="search"
              id="q"
              placeholder="Search by name or SKU"
              autocomplete="off"
              value={q()}
              onInput={(e) => onSearch(e.currentTarget.value)}
            />
          </div>
          <label for="f-cat" class="visually-hidden">
            Category
          </label>
          <select
            class="select"
            id="f-cat"
            value={f().category_id}
            onChange={(e) => setFilters({ category_id: e.currentTarget.value, page: 1 })}
          >
            <option value="">All categories</option>
            <option value="none">No category</option>
            <For each={categories.data() ?? []}>{(c) => <option value={String(c.id)}>{c.name}</option>}</For>
            <Show
              when={
                f().category_id &&
                f().category_id !== "none" &&
                !categories.data()?.some((c) => String(c.id) === f().category_id)
              }
            >
              <option value={f().category_id}>{categories.data() ? "Unknown category" : "Loading…"}</option>
            </Show>
          </select>
          <button
            type="button"
            class="chip"
            aria-pressed={f().low_stock ? "true" : "false"}
            onClick={() => {
              const low = !f().low_stock;
              setFilters({ low_stock: low, page: 1, ...(low && f().status === "archived" ? { status: "active" } : {}) });
            }}
          >
            <Icon name="alert-triangle" size={16} />
            <span>Low stock only</span>
            <Show when={products.data()}>{(d) => <span class="chip-count">{d().counts.low_stock}</span>}</Show>
          </button>
          <div class="segmented" role="group" aria-label="Product status">
            <For each={[["active", "Active"], ["archived", "Archived"], ["all", "All"]] as const}>
              {([value, label]) => (
                <button
                  type="button"
                  data-status={value}
                  aria-pressed={f().status === value ? "true" : "false"}
                  onClick={() => setFilters({ status: value, page: 1 })}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
          <div class="mobile-sort">
            <label for="m-sort">Sort by</label>
            <select
              class="select"
              id="m-sort"
              value={mobileSortValue()}
              onChange={(e) => {
                const [sort, order] = e.currentTarget.value.split(":");
                setFilters({ sort, order });
              }}
            >
              <For each={mobileSortOptions()}>{([v, label]) => <option value={v}>{label}</option>}</For>
            </select>
          </div>
        </form>
      </Show>

      <div id="list-root">
        <Switch>
          <Match when={products.state() === "error"}>
            <div class="card">
              <div class="card-body">
                <ErrorState
                  title="Couldn’t load products"
                  text="Something went wrong while loading your catalogue. Check your connection and try again."
                  actions={
                    <button type="button" class="btn btn-secondary" onClick={() => void products.reload()}>
                      <Icon name="refresh-cw" size={18} />
                      <span>Retry</span>
                    </button>
                  }
                />
              </div>
            </div>
          </Match>
          <Match when={products.state() === "loading"}>
            <p class="result-line">
              <span class="skeleton skeleton-text is-short" style={{ width: "120px" }} aria-hidden="true" />
            </p>
            <div class="card">
              <div class="card-body">
                <SkeletonRows rows={10} cols={6} />
              </div>
            </div>
          </Match>
          <Match when={firstRun()}>
            <div class="card">
              <div class="card-body">
                <EmptyState
                  icon="box"
                  title="No products yet"
                  text="Add the products you stock — with SKU, unit of measure and prices — then record a receipt to bring them into stock."
                  actions={
                    <a class="btn btn-primary" href="/products/new">
                      <Icon name="plus" size={18} />
                      <span>New product</span>
                    </a>
                  }
                />
              </div>
            </div>
          </Match>
          <Match when={products.data()}>
            <p class="result-line" role="status" aria-live="polite">
              <span>
                <strong class="fw-semibold" style={{ color: "var(--text)" }}>
                  {list().length}
                </strong>{" "}
                {plural(list().length, "product")}
                {activeFiltersText() ? ` · ${activeFiltersText()}` : ""}
              </span>
              <Show when={isFiltered()}>
                <button type="button" class="btn btn-ghost btn-sm" onClick={reset}>
                  <Icon name="x" size={16} />
                  <span>Reset filters</span>
                </button>
              </Show>
            </p>
            <Show
              when={list().length > 0}
              fallback={
                <div class="card">
                  <div class="card-body">{emptyResults()}</div>
                </div>
              }
            >
              <div class="table-wrap" aria-busy={products.state() === "refreshing" ? "true" : undefined}>
                <table class="table table-cards" id="products-table">
                  <caption class="visually-hidden">
                    Products, sorted by {COLS.find((c) => c.key === f().sort)?.label.toLowerCase() ?? f().sort}{" "}
                    {f().order === "asc" ? "ascending" : "descending"}
                  </caption>
                  {header()}
                  <tbody>
                    <For each={slice()}>{(p) => row(p)}</For>
                  </tbody>
                </table>
              </div>
              {pagination()}
            </Show>
          </Match>
        </Switch>
      </div>

      <ArchiveProductModal
        variant="list"
        product={archiveTarget()}
        onClose={() => setArchiveTarget(null)}
        onArchived={() => {
          setArchiveTarget(null);
          void products.reload();
        }}
      />
    </AppShell>
  );
}
