/** Stock count — screens/stock-count.html: new (scope), draft (enter actual quantities), confirm, posted. */
import { Show, createMemo, createSignal, type JSX } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { AppShell } from "../../components/AppShell";
import { api, ApiError } from "../../api/client";
import { createLoader } from "../../lib/resource";
import { LoadView, errorText } from "../../components/LoadView";
import { ErrorState } from "../../components/ErrorState";
import { SkeletonRows } from "../../components/SkeletonRows";
import { Icon } from "../../components/Icon";
import { Breadcrumb } from "./parts";
import { StockCountDraft } from "./StockCountDraft";
import { StockCountPosted } from "./StockCountPosted";
import { pl, type StockCount } from "./stockCount";
import "./StockCountPage.css";

interface Category {
  id: number;
  name: string;
  product_count: number;
  active_product_count: number;
}

/* ===================================================================== NEW */

export function NewStockCount(): JSX.Element {
  const navigate = useNavigate();
  const setup = createLoader(async (signal) => {
    const [cats, products] = await Promise.all([
      api.get<Category[]>("/api/categories", signal),
      api.get<{ counts: { active: number } }>("/api/products?status=active", signal),
    ]);
    return { cats: [...cats].sort((a, b) => a.name.localeCompare(b.name)), active: products.counts.active };
  });

  const [scope, setScope] = createSignal<"all" | "category">("all");
  const [catId, setCatId] = createSignal("");
  const [note, setNote] = createSignal("");
  const [catError, setCatError] = createSignal<string | null>(null);
  const [scopeError, setScopeError] = createSignal<string | null>(null);
  const [noteError, setNoteError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  let sel: HTMLSelectElement | undefined;
  let noteEl: HTMLTextAreaElement | undefined;

  const selectedCat = createMemo(() => setup.data()?.cats.find((c) => String(c.id) === catId()));
  const summary = () => {
    const d = setup.data();
    if (!d) return "";
    if (scope() === "all") return `${d.active} products will be added to this count`;
    const c = selectedCat();
    if (c) return `${pl(c.active_product_count, "product")} from ${c.name} will be added to this count`;
    return "Choose a category to see how many products will be counted";
  };

  const chooseScope = (s: "all" | "category") => {
    setScope(s);
    setScopeError(null);
    if (s === "all") setCatError(null);
    else queueMicrotask(() => sel?.focus());
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    setScopeError(null);
    setNoteError(null);
    if (scope() === "category" && !catId()) {
      setCatError("Choose a category to count.");
      sel?.focus();
      return;
    }
    setBusy(true);
    try {
      const doc = await api.post<StockCount>("/api/stock-counts", {
        category_id: scope() === "category" ? Number(catId()) : null,
        note: note().trim(),
      });
      navigate(`/stock-counts/${doc.id}`, { replace: true });
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 422) {
        const fe = err.fieldErrors();
        if (fe.category_id) {
          if (scope() === "category") {
            setCatError(fe.category_id);
            sel?.focus();
          } else setScopeError(fe.category_id);
        }
        if (fe.note) {
          setNoteError(fe.note);
          if (!fe.category_id) noteEl?.focus();
        }
        if (fe.category_id || fe.note) return;
      }
      setScopeError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  };

  return (
    <AppShell active="stock-counts" title="Stock counts">
      <div class="page-header">
        <div>
          <Breadcrumb current="New stock count" />
          <h1>New stock count</h1>
          <p class="page-subtitle">
            Choose which products to count. You’ll enter actual quantities after the count is created.
          </p>
        </div>
      </div>
      <LoadView loader={setup} skeleton={<div class="card sc-narrow"><SkeletonRows rows={5} cols={3} /></div>}>
        {(d) => (
          <form class="card sc-narrow" id="sc-new" novalidate onSubmit={submit}>
            <div class="card-body stack-lg">
              <fieldset class="sc-fieldset" id="sc-scope-set" aria-describedby={scopeError() ? "sc-scope-err" : undefined}>
                <legend class="field-label">Products to count</legend>
                <label class="radio">
                  <input
                    type="radio"
                    name="scope"
                    value="all"
                    checked={scope() === "all"}
                    onChange={() => chooseScope("all")}
                  />
                  <span>
                    All active products <span class="sc-option-sub">({d().active})</span>
                  </span>
                </label>
                <label class="radio">
                  <input
                    type="radio"
                    name="scope"
                    value="category"
                    checked={scope() === "category"}
                    onChange={() => chooseScope("category")}
                  />
                  <span>One category</span>
                </label>
                <div class={`field sc-cat${catError() ? " is-invalid" : ""}`} id="sc-cat-field">
                  <label for="sc-cat">Category</label>
                  <select
                    ref={sel}
                    class="select"
                    id="sc-cat"
                    disabled={scope() !== "category"}
                    aria-invalid={catError() ? "true" : undefined}
                    aria-describedby={catError() ? "sc-cat-err sc-cat-hint" : "sc-cat-hint"}
                    value={catId()}
                    onChange={(e) => {
                      setCatId(e.currentTarget.value);
                      if (e.currentTarget.value) setCatError(null);
                    }}
                  >
                    <option value="">Choose a category</option>
                    {d().cats.map((c) => (
                      <option value={String(c.id)} disabled={!c.active_product_count}>
                        {c.name} ({pl(c.active_product_count, "product")})
                      </option>
                    ))}
                  </select>
                  <p class="hint" id="sc-cat-hint">
                    Only active products in the category are included.
                  </p>
                  <Show when={catError()}>
                    <p class="error-text" id="sc-cat-err">
                      <Icon name="alert-circle" size={16} />
                      <span>{catError()}</span>
                    </p>
                  </Show>
                </div>
                <Show when={scopeError()}>
                  <p class="error-text" id="sc-scope-err" role="alert">
                    <Icon name="alert-circle" size={16} />
                    <span>{scopeError()}</span>
                  </p>
                </Show>
              </fieldset>
              <div class="form-grid">
                <div class={`field span-2${noteError() ? " is-invalid" : ""}`}>
                  <label for="sc-note">
                    Note <span class="optional">(optional)</span>
                  </label>
                  <textarea
                    ref={noteEl}
                    class="textarea"
                    id="sc-note"
                    maxlength="500"
                    placeholder="e.g. Month-end count, aisles 1–4"
                    value={note()}
                    aria-invalid={noteError() ? "true" : undefined}
                    aria-describedby={noteError() ? "sc-note-err" : undefined}
                    onInput={(e) => {
                      setNote(e.currentTarget.value);
                      setNoteError(null);
                    }}
                  />
                  <Show when={noteError()}>
                    <p class="error-text" id="sc-note-err">
                      <Icon name="alert-circle" size={16} />
                      <span>{noteError()}</span>
                    </p>
                  </Show>
                </div>
              </div>
              <div class="alert alert-info" role="status" aria-live="polite">
                <span class="alert-icon">
                  <Icon name="info" size={20} />
                </span>
                <div class="alert-content">
                  <p class="alert-title" id="sc-summary">
                    {summary()}
                  </p>
                  <p class="alert-body">
                    Book quantity shows current stock until you post, and differences are fixed at posting. The count
                    is dated automatically when it’s created and when it’s posted. Archived products aren’t included.
                  </p>
                </div>
              </div>
            </div>
            <div class="card-footer">
              <span class="hint">Nothing changes in stock until you post the count.</span>
              <div class="form-actions">
                <a class="btn btn-secondary" href="/stock-counts">
                  Cancel
                </a>
                <button
                  class={`btn btn-primary${busy() ? " is-loading" : ""}`}
                  type="submit"
                  id="sc-create"
                  disabled={busy()}
                  aria-busy={busy() ? "true" : undefined}
                >
                  <span>Create stock count</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </LoadView>
    </AppShell>
  );
}

/* ============================================================ DRAFT/POSTED */

function CountDocument(props: { id: string }): JSX.Element {
  const doc = createLoader((signal) => api.get<StockCount>(`/api/stock-counts/${encodeURIComponent(props.id)}`, signal));
  return (
    <LoadView
      loader={doc}
      skeleton={
        <AppShell active="stock-counts" title="Stock counts">
          <div class="page-header">
            <div>
              <Breadcrumb current="Stock count" />
              <h1>Stock count</h1>
            </div>
          </div>
          <div class="card">
            <SkeletonRows rows={8} cols={6} />
          </div>
        </AppShell>
      }
      error={(err, retry) => (
        <AppShell active="stock-counts" title="Stock counts">
          <ErrorPage err={err} retry={retry} />
        </AppShell>
      )}
    >
      {(d) => (
        <AppShell active="stock-counts" title="Stock counts">
          <Show
            when={d().status === "draft"}
            fallback={<StockCountPosted doc={d()} />}
          >
            <StockCountDraft
              initial={d()}
              onPosted={(posted) => doc.mutate(posted)}
              onStale={() => void doc.reload()}
            />
          </Show>
        </AppShell>
      )}
    </LoadView>
  );
}

function ErrorPage(props: { err: Error; retry: () => void }): JSX.Element {
  const notFound = () => props.err instanceof ApiError && props.err.status === 404;
  return (
    <>
      <div class="page-header">
        <div>
          <Breadcrumb current="Stock count" />
          <h1>Stock count</h1>
        </div>
      </div>
      <div class="card">
        <Show
          when={notFound()}
          fallback={
            <ErrorState title="Couldn’t load this stock count" text={errorText(props.err)} onRetry={() => props.retry()} />
          }
        >
          <div class="empty-state">
            <span class="empty-state-icon">
              <Icon name="clipboard-check" size={24} />
            </span>
            <h2 class="empty-state-title">Stock count not found</h2>
            <p class="empty-state-text">It may have been deleted, or the link is wrong.</p>
            <div class="empty-state-actions">
              <a class="btn btn-secondary" href="/stock-counts">
                <Icon name="arrow-left" size={18} />
                <span>Back to stock counts</span>
              </a>
            </div>
          </div>
        </Show>
      </div>
    </>
  );
}

export default function StockCountPage(): JSX.Element {
  const params = useParams();
  return (
    <Show when={params.id} keyed fallback={<NewStockCount />}>
      {(id) => <CountDocument id={id} />}
    </Show>
  );
}
