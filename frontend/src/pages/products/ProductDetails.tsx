import { For, Match, Show, Switch, createEffect, createSignal, on, type JSX } from "solid-js";
import { useParams } from "@solidjs/router";
import { api, ApiError } from "../../api/client";
import { AppShell } from "../../components/AppShell";
import { Badge } from "../../components/Badge";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { errorText } from "../../components/LoadView";
import { SkeletonRows } from "../../components/SkeletonRows";
import { toast } from "../../components/Toast";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, fmtSignedQty, plural, fmtNumber } from "../../lib/format";
import { createLoader } from "../../lib/resource";
import { ArchiveProductModal, restoreProduct } from "./ArchiveProductModal";
import {
  categoryLabel,
  docHref,
  isLow,
  movementTypeLabel,
  type Movement,
  type MovementPage,
  type Product,
} from "./types";
import "./ProductDetails.css";

export const MOVEMENTS_PAGE = 20;

export default function ProductDetails() {
  const params = useParams();
  const id = () => Number(params.id);

  const product = createLoader((signal) => api.get<Product>(`/api/products/${id()}`, signal));
  const movements = createLoader((signal) =>
    api.get<MovementPage>(`/api/products/${id()}/movements?limit=${MOVEMENTS_PAGE}&offset=0`, signal),
  );
  /** Movements loaded with "Show more" (beyond the first page). */
  const [more, setMore] = createSignal<Movement[]>([]);
  const [moreTotal, setMoreTotal] = createSignal<number | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);
  createEffect(on(id, () => {
    setMore([]);
    setMoreTotal(null);
  }));
  const allMovements = () => [...(movements.data()?.items ?? []), ...more()];
  const totalMovements = () => moreTotal() ?? movements.data()?.total ?? 0;

  const showMore = async () => {
    if (loadingMore()) return;
    setLoadingMore(true);
    try {
      const res = await api.get<MovementPage>(
        `/api/products/${id()}/movements?limit=${MOVEMENTS_PAGE}&offset=${allMovements().length}`,
      );
      setMore((m) => [...m, ...res.items]);
      setMoreTotal(res.total);
    } catch (err) {
      toast({ type: "error", title: "Couldn’t load more movements", text: err instanceof ApiError ? err.message : undefined });
    } finally {
      setLoadingMore(false);
    }
  };

  let h1: HTMLHeadingElement | undefined;
  const focusTitle = () => queueMicrotask(() => h1?.focus());

  const [archiveOpen, setArchiveOpen] = createSignal(false);
  const [restoring, setRestoring] = createSignal(false);
  const restore = async () => {
    const p = product.data();
    if (!p || restoring()) return;
    setRestoring(true);
    try {
      product.mutate(await restoreProduct(p));
      focusTitle();
    } catch (err) {
      toast({ type: "error", title: err instanceof ApiError ? err.message : "Couldn’t restore the product." });
    } finally {
      setRestoring(false);
    }
  };

  const title = () => product.data()?.name ?? "Product";

  const notFound = () => {
    const e = product.error();
    return e instanceof ApiError && e.status === 404;
  };

  const qtyChange = (m: Movement, unit: string): JSX.Element => (
    <span class={`fw-semibold ${m.qty_change > 0 ? "text-success" : m.qty_change < 0 ? "text-danger" : ""}`}>
      {fmtSignedQty(m.qty_change, unit)}
    </span>
  );

  const view = (p: () => Product): JSX.Element => {
    const low = () => isLow(p());
    const editHref = () => `/products/${p().id}/edit`;
    return (
      <>
        <div class="page-header">
          <div>
            <nav class="breadcrumb" aria-label="Breadcrumb">
              <ol>
                <li>
                  <a href={p().archived ? "/products?status=archived" : "/products"}>Products</a>
                </li>
                <li aria-current="page">{p().name}</li>
              </ol>
            </nav>
            <div class="page-title-row">
              <h1 ref={h1} tabindex="-1">
                {p().name}
              </h1>
              <Switch fallback={<Badge kind="active" />}>
                <Match when={p().archived}>
                  <Badge kind="archived" />
                </Match>
                <Match when={low()}>
                  <Badge kind="low" />
                </Match>
              </Switch>
            </div>
            <p class="page-subtitle">
              <span class="pd-sku">{p().sku}</span> · {categoryLabel(p())}
            </p>
          </div>
          <div class="page-actions">
            <Show
              when={!p().archived}
              fallback={
                <>
                  <button
                    type="button"
                    class={`btn btn-primary${restoring() ? " is-loading" : ""}`}
                    disabled={restoring()}
                    aria-busy={restoring() ? "true" : undefined}
                    onClick={() => void restore()}
                  >
                    <Icon name="archive-restore" size={18} />
                    <span>Restore</span>
                  </button>
                  <a class="btn btn-secondary" href={editHref()}>
                    <Icon name="pencil" size={18} />
                    <span>Edit</span>
                  </a>
                </>
              }
            >
              <a class="btn btn-primary" href="/receipts/new">
                <Icon name="arrow-down-to-line" size={18} />
                <span>New receipt</span>
              </a>
              <a class="btn btn-secondary" href="/write-offs/new">
                <Icon name="arrow-up-from-line" size={18} />
                <span>New write-off</span>
              </a>
              <a class="btn btn-secondary" href={editHref()}>
                <Icon name="pencil" size={18} />
                <span>Edit</span>
              </a>
              <button type="button" class="btn btn-ghost" onClick={() => setArchiveOpen(true)}>
                <Icon name="archive" size={18} />
                <span>Archive</span>
              </button>
            </Show>
          </div>
        </div>

        <div class="stack-lg">
          <Switch>
            <Match when={p().archived}>
              <div class="alert alert-info" role="note">
                <span class="alert-icon">
                  <Icon name="info" />
                </span>
                <div class="alert-content">
                  <p class="alert-title">This product is archived. It isn’t offered in new documents.</p>
                  <p class="alert-body">
                    Its movements stay in history and reports.
                    {p().stock !== 0 ? ` Remaining stock: ${fmtQty(p().stock, p().unit)}.` : ""}
                  </p>
                  <div class="alert-actions">
                    <button
                      type="button"
                      class={`btn btn-secondary btn-sm${restoring() ? " is-loading" : ""}`}
                      disabled={restoring()}
                      onClick={() => void restore()}
                    >
                      <Icon name="archive-restore" size={16} />
                      <span>Restore product</span>
                    </button>
                  </div>
                </div>
              </div>
            </Match>
            <Match when={low()}>
              <div class="alert alert-warning" role="note">
                <span class="alert-icon">
                  <Icon name="alert-triangle" />
                </span>
                <div class="alert-content">
                  <p class="alert-title">Low stock</p>
                  <p class="alert-body">
                    Stock is at or below the minimum of {fmtQty(p().min_stock, p().unit)}. Consider creating a receipt.
                  </p>
                  <div class="alert-actions">
                    <a class="btn btn-secondary btn-sm" href="/receipts/new">
                      <Icon name="arrow-down-to-line" size={16} />
                      <span>Create receipt</span>
                    </a>
                  </div>
                </div>
              </div>
            </Match>
          </Switch>

          <div class="pd-grid">
            <div class="stack">
              <section class="card" aria-labelledby="stock-h">
                <div class="card-header">
                  <h2 class="card-title" id="stock-h">
                    Stock
                  </h2>
                </div>
                <div class="card-body pd-stock">
                  <div class="pd-stat">
                    <span class="pd-stat-label">Current stock</span>
                    <span class="pd-big">{fmtQty(p().stock, p().unit)}</span>
                    <Show when={low()}>
                      <span>
                        <Badge kind="low" />
                      </span>
                    </Show>
                  </div>
                  <div class="pd-stat-row">
                    <div class="pd-stat">
                      <span class="pd-stat-label">Stock value</span>
                      <span class="pd-stat-value">{fmtMoney(p().stock_value)}</span>
                      <span class="text-xs muted">At average cost</span>
                    </div>
                    <div class="pd-stat">
                      <span class="pd-stat-label">Average cost</span>
                      <span class="pd-stat-value">
                        {fmtMoney(p().avg_cost)} <span class="muted text-sm">/ {p().unit}</span>
                      </span>
                      <span class="text-xs muted">Weighted average, updated by each posted receipt</span>
                    </div>
                    <div class="pd-stat">
                      <span class="pd-stat-label">Minimum stock</span>
                      <span class="pd-stat-value">
                        {p().min_stock == null ? "Not set" : fmtQty(p().min_stock, p().unit)}
                      </span>
                      <Show when={p().min_stock == null}>
                        <span class="text-xs muted">No low-stock alert</span>
                      </Show>
                    </div>
                  </div>
                </div>
              </section>
            </div>
            <div class="stack">
              <section class="card" aria-labelledby="det-h">
                <div class="card-header">
                  <h2 class="card-title" id="det-h">
                    Details
                  </h2>
                  <div class="card-actions">
                    <a class="link-subtle text-sm" href={editHref()}>
                      Edit details
                    </a>
                  </div>
                </div>
                <div class="card-body">
                  <dl class="meta-list">
                    <div>
                      <dt>SKU</dt>
                      <dd class="mono">{p().sku}</dd>
                    </div>
                    <div>
                      <dt>Category</dt>
                      <dd>
                        <Show when={p().category_id != null} fallback="No category">
                          <a class="link" href={`/products?category_id=${p().category_id}`}>
                            {p().category_name}
                          </a>
                        </Show>
                      </dd>
                    </div>
                    <div>
                      <dt>Unit of measure</dt>
                      <dd>{p().unit}</dd>
                    </div>
                    <div>
                      <dt>Purchase price (reference)</dt>
                      <dd>
                        {fmtMoney(p().purchase_price)} <span class="muted text-sm">/ {p().unit}</span>
                        <span class="text-xs muted" style={{ display: "block" }}>
                          Default price for new receipt lines
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Average cost</dt>
                      <dd>
                        {fmtMoney(p().avg_cost)} <span class="muted text-sm">/ {p().unit}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Sale price</dt>
                      <dd>
                        {fmtMoney(p().sale_price)} <span class="muted text-sm">/ {p().unit}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Added</dt>
                      <dd>{fmtDate(p().created_at)}</dd>
                    </div>
                  </dl>
                  <div class="pd-stat" style={{ "margin-top": "var(--sp-5)" }}>
                    <span class="pd-stat-label">Description</span>
                    <p>{p().description ? p().description : <span class="muted">No description</span>}</p>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <section class="card" aria-labelledby="hist-h">
            <div class="card-header">
              <div>
                <h2 class="card-title" id="hist-h">
                  Movement history
                </h2>
                <p class="card-subtitle">Every stock change for this product, newest first</p>
              </div>
            </div>
            <Switch>
              <Match when={movements.state() === "error"}>
                <div class="card-body">
                  <ErrorState
                    compact
                    title="Couldn’t load movements"
                    text={errorText(movements.error())}
                    onRetry={() => void movements.reload()}
                  />
                </div>
              </Match>
              <Match when={movements.state() === "loading"}>
                <div class="card-body">
                  <SkeletonRows rows={4} cols={5} />
                </div>
              </Match>
              <Match when={allMovements().length === 0}>
                <div class="card-body">
                  <EmptyState
                    compact
                    icon="history"
                    title="No movements yet"
                    text="Receipts, write-offs and stock count adjustments for this product will appear here."
                  />
                </div>
              </Match>
              <Match when={true}>
                <div class="table-wrap">
                  <table class="table table-cards">
                    <caption class="visually-hidden">Movement history for {p().name}, newest first</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Type</th>
                        <th scope="col">Document</th>
                        <th scope="col" class="num">
                          Change
                        </th>
                        <th scope="col" class="num">
                          Balance after
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={allMovements()}>
                        {(m) => (
                          <tr>
                            <td class="td-primary nowrap" data-label="Date">
                              {fmtDateTime(m.at)}
                            </td>
                            <td data-label="Type">{movementTypeLabel(m.type)}</td>
                            <td data-label="Document">
                              <a class="link mono" href={docHref(m.document.kind, m.document.id)}>
                                {m.document.number}
                              </a>
                            </td>
                            <td data-label="Change" class="num">
                              {qtyChange(m, p().unit)}
                            </td>
                            <td data-label="Balance after" class="num">
                              {fmtQty(m.balance_after, p().unit)}
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
                <div class="card-footer">
                  <span class="text-sm muted">
                    {allMovements().length < totalMovements()
                      ? `Showing ${fmtNumber(allMovements().length)} of ${fmtNumber(totalMovements())} movements`
                      : `${fmtNumber(totalMovements())} ${plural(totalMovements(), "movement")}`}
                  </span>
                  <Show when={allMovements().length < totalMovements()}>
                    <button
                      type="button"
                      class={`btn btn-secondary btn-sm${loadingMore() ? " is-loading" : ""}`}
                      disabled={loadingMore()}
                      aria-busy={loadingMore() ? "true" : undefined}
                      onClick={() => void showMore()}
                    >
                      <span>Show more</span>
                    </button>
                  </Show>
                  <a class="link-subtle text-sm" href={`/history?product=${p().id}`}>
                    View full history
                  </a>
                </div>
              </Match>
            </Switch>
          </section>
        </div>

        <ArchiveProductModal
          variant="details"
          product={archiveOpen() ? p() : null}
          onClose={() => setArchiveOpen(false)}
          onArchived={(updated) => {
            setArchiveOpen(false);
            product.mutate(updated);
            focusTitle();
          }}
        />
      </>
    );
  };

  return (
    <AppShell active="products" title={title()}>
      <Switch>
        <Match when={product.state() === "error"}>
          <div class="page-header">
            <div>
              <nav class="breadcrumb" aria-label="Breadcrumb">
                <ol>
                  <li>
                    <a href="/products">Products</a>
                  </li>
                  <li aria-current="page">{notFound() ? "Not found" : "Product"}</li>
                </ol>
              </nav>
              <h1>{notFound() ? "Product not found" : "Product"}</h1>
            </div>
          </div>
          <div class="card">
            <div class="card-body">
              <Show
                when={notFound()}
                fallback={
                  <ErrorState
                    title="Couldn’t load the product"
                    text={errorText(product.error())}
                    onRetry={() => void product.reload()}
                  />
                }
              >
                <EmptyState
                  icon="box"
                  title="This product doesn’t exist"
                  text="It may have been removed, or the link is wrong."
                  actions={
                    <a class="btn btn-secondary" href="/products">
                      <Icon name="arrow-left" size={18} />
                      <span>Back to products</span>
                    </a>
                  }
                />
              </Show>
            </div>
          </div>
        </Match>
        <Match when={product.state() === "loading"}>
          <div class="page-header" aria-hidden="true">
            <div>
              <span class="skeleton skeleton-text is-short" style={{ width: "120px" }} />
              <span class="skeleton skeleton-text" style={{ width: "280px", height: "28px", "margin-top": "8px" }} />
            </div>
          </div>
          <div class="card">
            <div class="card-body">
              <SkeletonRows rows={6} cols={4} />
            </div>
          </div>
        </Match>
        <Match when={product.data()}>{(p) => view(p)}</Match>
      </Switch>
    </AppShell>
  );
}
