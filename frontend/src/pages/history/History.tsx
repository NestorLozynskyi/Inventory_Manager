/** Movement history — screens/history.html: every stock movement with filters (in the URL), pagination, links. */
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import { AppShell } from "../../components/AppShell";
import { api, qs } from "../../api/client";
import { createLoader } from "../../lib/resource";
import { useListFilters } from "../../lib/url";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { errorText } from "../../components/LoadView";
import { SkeletonRows } from "../../components/SkeletonRows";
import { Icon, type IconName } from "../../components/Icon";
import { fmtDateTime, fmtQty, fmtSignedQty, toIsoDate } from "../../lib/format";
import {
  PAGE_SIZE,
  PERIOD_IDS,
  TYPES,
  docHref,
  pageList,
  periodLabel,
  periods,
  rangeOf,
  type Movement,
} from "./historyModel";
import "./History.css";

interface ProductOpt {
  id: number;
  sku: string;
  name: string;
  archived: boolean;
}
interface CategoryOpt {
  id: number;
  name: string;
}
interface DocListItem {
  id: number;
  reversal?: { id: number; number: string } | null;
  reverses?: { id: number; number: string } | null;
}

const DEFAULTS = {
  search: "",
  period: "",
  from: "",
  to: "",
  type: "",
  product: "",
  category: "",
  doc: "",
  page: 1,
};

export default function History(): JSX.Element {
  const [filters, setFilters, resetFilters] = useListFilters(DEFAULTS, {
    enums: { period: [...PERIOD_IDS], type: TYPES.map((t) => t.id) },
  });
  const now = new Date();
  const periodList = periods(now);
  const today = toIsoDate(now);

  /* -------------------------------------------------------- reference data -- */
  const [products, setProducts] = createSignal<ProductOpt[]>([]);
  const [categories, setCategories] = createSignal<CategoryOpt[]>([]);
  /** Document id → "Reversed by RV-…" / "Reverses RC-…" (movement.document has no reversal info). */
  const [docNotes, setDocNotes] = createSignal<Map<number, string>>(new Map());
  onMount(() => {
    const ctl = new AbortController();
    onCleanup(() => ctl.abort());
    api
      .get<{ items: ProductOpt[] }>("/api/products?status=all&sort=name", ctl.signal)
      .then((d) => setProducts([...d.items].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => undefined);
    api
      .get<CategoryOpt[]>("/api/categories", ctl.signal)
      .then((d) => setCategories([...d].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => undefined);
    Promise.allSettled([
      api.get<{ items: DocListItem[] }>("/api/receipts", ctl.signal),
      api.get<{ items: DocListItem[] }>("/api/write-offs", ctl.signal),
    ]).then((res) => {
      const m = new Map<number, string>();
      for (const r of res) {
        if (r.status !== "fulfilled") continue;
        for (const d of r.value.items) {
          if (d.reverses) m.set(d.id, `Reverses ${d.reverses.number}`);
          else if (d.reversal) m.set(d.id, `Reversed by ${d.reversal.number}`);
        }
      }
      setDocNotes(m);
    });
  });

  /* ------------------------------------------------------------- movements -- */
  const moves = createLoader((signal) => {
    const f = filters();
    const r = rangeOf(f, now);
    return api.get<{ items: Movement[]; total: number }>(
      `/api/movements${qs({
        search: f.doc || f.search,
        type: f.type,
        product_id: f.product,
        category_id: f.category,
        from: r.from,
        to: r.to,
        limit: PAGE_SIZE,
        offset: (Math.max(1, f.page) - 1) * PAGE_SIZE,
      })}`,
      signal,
    );
  });
  const total = () => moves.data()?.total ?? 0;
  const pages = () => Math.max(1, Math.ceil(total() / PAGE_SIZE));
  const page = () => Math.max(1, filters().page);

  /* Page beyond the end (e.g. stale URL) → last page. */
  createEffect(() => {
    if (moves.state() === "ready" && total() > 0 && page() > pages()) setFilters({ page: pages() });
  });

  /* ---------------------------------------------------------- search input -- */
  const [q, setQ] = createSignal(filters().doc ? "" : filters().search);
  let qIn: HTMLInputElement | undefined;
  let qTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(qTimer));
  const onSearch = (v: string) => {
    setQ(v);
    clearTimeout(qTimer);
    qTimer = setTimeout(() => setFilters({ search: v.trim(), doc: "", page: 1 }), 250);
  };
  createEffect(
    on(
      () => filters().search,
      (s) => {
        if (s !== q().trim()) setQ(s);
      },
      { defer: true },
    ),
  );

  /* ---------------------------------------------------------- custom range -- */
  const [fromV, setFromV] = createSignal(filters().from);
  const [toV, setToV] = createSignal(filters().to);
  const [rangeErr, setRangeErr] = createSignal(false);
  const onPeriod = (v: string) => {
    if (v === "custom" && !filters().from && !filters().to) {
      const first = periodList.find((p) => p.id === "last-month")!.from!;
      setFromV(first);
      setToV(today);
      setRangeErr(false);
      setFilters({ period: v, from: first, to: today, page: 1 });
    } else if (v === "custom") {
      setFilters({ period: v, page: 1 });
    } else {
      setRangeErr(false);
      setFilters({ period: v, from: "", to: "", page: 1 });
    }
  };
  const onRange = () => {
    const bad = !!fromV() && !!toV() && fromV() > toV();
    setRangeErr(bad);
    if (!bad) setFilters({ from: fromV(), to: toV(), page: 1 });
  };
  createEffect(
    on(
      () => [filters().from, filters().to] as const,
      ([f, t]) => {
        if (!rangeErr()) {
          setFromV(f);
          setToV(t);
        }
      },
      { defer: true },
    ),
  );

  /* -------------------------------------------------------- active filters -- */
  const productName = (id: string) => {
    const p = products().find((x) => String(x.id) === id);
    if (p) return p.name;
    const m = moves.data()?.items.find((x) => String(x.product.id) === id);
    return m ? m.product.name : `#${id}`;
  };
  const categoryName = (id: string) => categories().find((c) => String(c.id) === id)?.name ?? `#${id}`;
  const active = createMemo(() => {
    const f = filters();
    const a: [keyof typeof DEFAULTS, string][] = [];
    if (f.search && !f.doc) a.push(["search", `Search: “${f.search}”`]);
    if (f.period) a.push(["period", `Period: ${periodLabel(f, now)}`]);
    if (f.type) a.push(["type", `Type: ${TYPES.find((t) => t.id === f.type)?.label ?? f.type}`]);
    if (f.product) a.push(["product", `Product: ${productName(f.product)}`]);
    if (f.category) a.push(["category", `Category: ${categoryName(f.category)}`]);
    if (f.doc) a.push(["doc", `Document: ${f.doc}`]);
    return a;
  });
  const removeFilter = (k: keyof typeof DEFAULTS) => {
    if (k === "period") {
      setRangeErr(false);
      setFilters({ period: "", from: "", to: "", page: 1 });
    } else if (k === "search") {
      clearTimeout(qTimer);
      setQ("");
      setFilters({ search: "", page: 1 });
    } else setFilters({ [k]: "", page: 1 } as Partial<typeof DEFAULTS>);
    qIn?.focus();
  };
  const clearAll = () => {
    clearTimeout(qTimer);
    setQ("");
    setRangeErr(false);
    resetFilters();
    qIn?.focus();
  };

  /* ------------------------------------------------------------ pagination -- */
  let results: HTMLDivElement | undefined;
  let focusPage = false;
  const goPage = (n: number) => {
    if (n < 1 || n > pages() || n === page()) return;
    focusPage = true;
    setFilters({ page: n });
  };
  createEffect(
    on(
      () => moves.data(),
      () => {
        if (!focusPage || moves.loading()) return;
        focusPage = false;
        queueMicrotask(() => {
          (results?.querySelector('.page-btn[aria-current="page"]') as HTMLElement | null)?.focus();
          results?.scrollIntoView?.({ block: "start" });
        });
      },
    ),
  );

  const initialLoading = () => moves.state() === "loading";

  const select = (id: string, label: string, value: string, onChange: (v: string) => void, opts: JSX.Element) => (
    <>
      <label class="visually-hidden" for={id}>
        {label}
      </label>
      <select
        class="select"
        id={id}
        value={value}
        disabled={initialLoading()}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        {opts}
      </select>
    </>
  );

  return (
    <AppShell active="history" title="History">
      <div class="page-header">
        <div>
          <h1>History</h1>
          <p class="page-subtitle">
            Every stock movement from receipts, write-offs, stock counts and reversals, newest first.
          </p>
        </div>
      </div>

      <form
        class="toolbar hist-toolbar"
        role="search"
        aria-label="Filter movements"
        id="h-form"
        onSubmit={(e) => e.preventDefault()}
      >
        <div class="search">
          <span class="search-icon">
            <Icon name="search" size={18} />
          </span>
          <label class="visually-hidden" for="h-q">
            Search by product, SKU or document
          </label>
          <input
            ref={qIn}
            class="input"
            id="h-q"
            type="search"
            placeholder="Search product, SKU or document"
            autocomplete="off"
            value={q()}
            disabled={initialLoading()}
            onInput={(e) => onSearch(e.currentTarget.value)}
          />
        </div>
        {select(
          "h-period",
          "Period",
          filters().period,
          onPeriod,
          <For each={periodList}>{(p) => <option value={p.id}>{p.label}</option>}</For>,
        )}
        {select(
          "h-type",
          "Type",
          filters().type,
          (v) => setFilters({ type: v, page: 1 }),
          <>
            <option value="">All types</option>
            <For each={TYPES}>{(t) => <option value={t.id}>{t.label}</option>}</For>
          </>,
        )}
        {select(
          "h-product",
          "Product",
          filters().product,
          (v) => setFilters({ product: v, page: 1 }),
          <>
            <option value="">All products</option>
            <For each={products()}>
              {(p) => (
                <option value={String(p.id)} selected={String(p.id) === filters().product}>
                  {p.name} · {p.sku}
                  {p.archived ? " (archived)" : ""}
                </option>
              )}
            </For>
          </>,
        )}
        {select(
          "h-category",
          "Category",
          filters().category,
          (v) => setFilters({ category: v, page: 1 }),
          <>
            <option value="">All categories</option>
            <For each={categories()}>
              {(c) => (
                <option value={String(c.id)} selected={String(c.id) === filters().category}>
                  {c.name}
                </option>
              )}
            </For>
          </>,
        )}
      </form>

      <div class="hist-range" id="h-range" hidden={filters().period !== "custom"}>
        <div class="field">
          <label for="h-from">From</label>
          <input
            class="input"
            type="date"
            id="h-from"
            max={today}
            value={fromV()}
            onChange={(e) => {
              setFromV(e.currentTarget.value);
              onRange();
            }}
          />
        </div>
        <div class="field">
          <label for="h-to">To</label>
          <input
            class="input"
            type="date"
            id="h-to"
            max={today}
            value={toV()}
            aria-invalid={rangeErr() ? "true" : undefined}
            aria-describedby={rangeErr() ? "h-range-err" : undefined}
            onChange={(e) => {
              setToV(e.currentTarget.value);
              onRange();
            }}
          />
        </div>
        <Show when={rangeErr()}>
          <p class="error-text" id="h-range-err">
            <Icon name="alert-circle" size={16} />
            <span>“From” must be on or before “To”.</span>
          </p>
        </Show>
      </div>

      <div class="hist-active" id="h-active" aria-live="polite">
        <Show
          when={!initialLoading()}
          fallback={<span class="hist-count">Loading movements…</span>}
        >
          <Show when={moves.state() !== "error"}>
            <span class="hist-count">
              {total().toLocaleString("en-US")} {total() === 1 ? "movement" : "movements"}
            </span>
          </Show>
          <For each={active()}>
            {([k, label]) => (
              <span class="chip is-active">
                {label}
                <button
                  type="button"
                  class="chip-remove"
                  data-rm={k}
                  aria-label={`Remove filter ${label}`}
                  onClick={() => removeFilter(k)}
                >
                  <Icon name="x" size={14} />
                </button>
              </span>
            )}
          </For>
          <Show when={active().length}>
            <button type="button" class="btn btn-ghost btn-sm" data-clear onClick={clearAll}>
              Clear filters
            </button>
          </Show>
        </Show>
      </div>

      <div
        ref={results}
        class={`card hist-results${moves.state() === "refreshing" ? " is-refreshing" : ""}`}
        id="h-results"
        aria-busy={moves.loading() ? "true" : undefined}
      >
        <Show when={moves.state() !== "error"} fallback={
          <ErrorState title="Couldn’t load movements" text={errorText(moves.error())} onRetry={() => void moves.reload()} />
        }>
          <Show when={!initialLoading()} fallback={<SkeletonRows rows={8} cols={6} />}>
            <Show
              when={(moves.data()?.items.length ?? 0) > 0}
              fallback={
                <Show
                  when={active().length}
                  fallback={
                    <EmptyState
                      icon="history"
                      title="No stock movements yet"
                      text="Movements appear here when you post receipts, write-offs, stock counts or reversals."
                      actions={
                        <a class="btn btn-primary" href="/receipts/new">
                          <Icon name="plus" size={18} />
                          <span>New receipt</span>
                        </a>
                      }
                    />
                  }
                >
                  <EmptyState
                    icon="search"
                    title="No movements match your filters"
                    text="Try a different search term, period or type, or clear the filters to see all movements."
                    actions={
                      <button type="button" class="btn btn-secondary" data-clear onClick={clearAll}>
                        <Icon name="x" size={18} />
                        <span>Clear filters</span>
                      </button>
                    }
                  />
                </Show>
              }
            >
              <div class="table-wrap">
                <table class="table table-cards">
                  <caption class="visually-hidden">Stock movements, newest first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date &amp; time</th>
                      <th scope="col">Type</th>
                      <th scope="col">Document</th>
                      <th scope="col">Product</th>
                      <th scope="col" class="num">
                        Qty change
                      </th>
                      <th scope="col" class="num">
                        Balance after
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={moves.data()?.items ?? []}>{(m) => <MovementRow m={m} note={docNotes().get(m.document.id)} />}</For>
                  </tbody>
                </table>
              </div>
              <nav class="pagination card-footer" aria-label="Pagination">
                <p class="pagination-info">
                  Showing {(page() - 1) * PAGE_SIZE + 1}–{Math.min(total(), page() * PAGE_SIZE)} of{" "}
                  {total().toLocaleString("en-US")} movements
                </p>
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
                  <For each={pageList(page(), pages())}>
                    {(n) => (
                      <li>
                        <Show when={n != null} fallback={<span class="page-ellipsis" aria-hidden="true">…</span>}>
                          <button
                            type="button"
                            class="page-btn"
                            data-page={n}
                            aria-current={n === page() ? "page" : undefined}
                            aria-label={`Page ${n}`}
                            onClick={() => goPage(n!)}
                          >
                            {n}
                          </button>
                        </Show>
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
              </nav>
            </Show>
          </Show>
        </Show>
      </div>
    </AppShell>
  );
}

function TypeBadge(props: { type: string }): JSX.Element {
  const d = () => TYPES.find((t) => t.id === props.type);
  return (
    <span class={`badge ${props.type === "reversal" ? "badge-reversal" : "badge-neutral"} has-icon`}>
      <Icon name={(d()?.icon ?? "info") as IconName} size={14} />
      {d()?.label ?? props.type}
    </span>
  );
}

function MovementRow(props: { m: Movement; note?: string }): JSX.Element {
  const m = () => props.m;
  const p = () => props.m.product;
  const cls = () => (m().qty_change > 0 ? "text-success" : m().qty_change < 0 ? "text-danger" : "muted");
  const dir = () => (m().qty_change > 0 ? "Increase " : m().qty_change < 0 ? "Decrease " : "");
  return (
    <tr>
      <td data-label="Date & time" class="nowrap">
        {fmtDateTime(m().at)}
      </td>
      <td data-label="Type">
        <TypeBadge type={m().type} />
      </td>
      <td data-label="Document">
        <div class="hist-doc">
          <a class="link-subtle mono" href={docHref(m().document)}>
            {m().document.number}
          </a>
          <Show when={props.note}>
            <span class="cell-sub">{props.note}</span>
          </Show>
        </div>
      </td>
      <td class="td-primary" data-label="Product">
        <span class="cell-title">
          <a class="cell-link" href={`/products/${p().id}`}>
            {p().name}
          </a>
        </span>
        <span class="cell-sub mono">
          {p().sku}
          {p().archived ? " · Archived" : ""}
        </span>
      </td>
      <td data-label="Qty change" class="num">
        <span class={`fw-semibold ${cls()}`}>
          <span class="visually-hidden">{dir()}</span>
          {fmtSignedQty(m().qty_change, p().unit)}
        </span>
      </td>
      <td data-label="Balance after" class="num">
        {fmtQty(m().balance_after, p().unit)}
      </td>
    </tr>
  );
}
