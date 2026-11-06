/**
 * Stock count draft — enter actual quantities (screens/stock-count.html, states "draft" and "confirm").
 *
 * Quantities are validated as you type (unit precision) and saved with PATCH: automatically shortly after a
 * valid change, and immediately on "Save draft" / before posting / before leaving the page. Input is never
 * overwritten by server responses; book qty and unit cost are refreshed from them (drafts are live).
 */
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack, type JSX } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { useBeforeLeave, useNavigate } from "@solidjs/router";
import { api, ApiError } from "../../api/client";
import { StatusBadge } from "../../components/Badge";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { Modal, confirm } from "../../components/Modal";
import { toast } from "../../components/Toast";
import { fmtDateTime, fmtQty, fmtSignedMoney, isFractionalUnit } from "../../lib/format";
import { useListFilters } from "../../lib/url";
import { Breadcrumb, DiffQty, DiffValue, Kpis, ProductCell } from "./parts";
import {
  calcLine,
  parseActualQty,
  pl,
  rawOf,
  scopeLabel,
  totalsOf,
  type ProductRef,
  type StockCount,
} from "./stockCount";

interface Row {
  id: number;
  product: ProductRef;
  book: number;
  unitCost: number;
  /** Input text as typed. */
  raw: string;
  /** Error returned by the server for the current raw value. */
  serverError: string | null;
  /** Actual qty stored on the server. */
  saved: number | null;
}

export const AUTOSAVE_MS = 800;
const FILTERS = ["all", "diff", "uncounted"] as const;
type Show_ = (typeof FILTERS)[number];

export function StockCountDraft(props: {
  initial: StockCount;
  onPosted: (doc: StockCount) => void;
  /** The document changed elsewhere (posted / deleted): reload it. */
  onStale: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const sc = props.initial;
  const [rows, setRows] = createStore<Row[]>(
    sc.lines.map((l) => ({
      id: l.id,
      product: l.product,
      book: l.book_qty,
      unitCost: l.unit_cost,
      raw: rawOf(l.actual_qty),
      serverError: null,
      saved: l.actual_qty,
    })),
  );
  const index = new Map(sc.lines.map((l, i) => [l.id, i]));

  const parsed = (r: Row) => parseActualQty(r.raw, r.product.unit);
  const errorOf = (r: Row): string | null => parsed(r).error ?? r.serverError;
  const calcOf = (r: Row) => calcLine(r.book, r.unitCost, parsed(r).value ?? null, !!errorOf(r));
  const isDirty = (r: Row) => !errorOf(r) && (parsed(r).value ?? null) !== r.saved;

  const totals = createMemo(() => totalsOf(rows.map((r) => ({ calc: calcOf(r), invalid: !!errorOf(r) }))));

  /* ------------------------------------------------------------ filters -- */
  const [filters, setFilters] = useListFilters(
    { show: "all" as string, q: "" },
    { enums: { show: FILTERS as unknown as string[] } },
  );
  const [query, setQuery] = createSignal(filters().q);
  let searchEl: HTMLInputElement | undefined;
  let qTimer: ReturnType<typeof setTimeout> | undefined;
  const onSearch = (v: string) => {
    setQuery(v);
    clearTimeout(qTimer);
    qTimer = setTimeout(() => setFilters({ q: v.trim() }), 250);
  };
  const isVisible = (r: Row, show: Show_, q: string) => {
    if (q) {
      const s = q.toLowerCase();
      if (!`${r.product.name} ${r.product.sku}`.toLowerCase().includes(s)) return false;
    }
    const c = calcOf(r);
    if (show === "diff") return c.counted && c.diff !== 0;
    if (show === "uncounted") return !c.counted;
    return true;
  };
  /* Visible set is recomputed only when the filter changes (rows don't vanish while typing). */
  const [visibleIds, setVisibleIds] = createSignal<Set<number>>(new Set());
  const recompute = () => {
    const f = filters();
    const show = f.show as Show_;
    const q = query().trim();
    untrack(() => setVisibleIds(new Set(rows.filter((r) => isVisible(r, show, q)).map((r) => r.id))));
  };
  createEffect(on([() => filters().show, () => query().trim()], recompute));
  const visibleRows = createMemo(() => rows.filter((r) => visibleIds().has(r.id)));
  const resetView = () => {
    clearTimeout(qTimer);
    setQuery("");
    if (searchEl) searchEl.value = "";
    setFilters({ show: "all", q: "" });
    recompute();
  };

  /* --------------------------------------------------------------- save -- */
  const [saving, setSaving] = createSignal(false);
  const [saveFailed, setSaveFailed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<boolean> | null = null;
  let gone = false; // deleted / posted / navigating away after delete

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), AUTOSAVE_MS);
  };

  type Change = { id: number; actual_qty: number | null; raw: string };

  const applyServer = (doc: StockCount, sent: Change[]) => {
    setRows(
      produce((list) => {
        for (const l of doc.lines) {
          const i = index.get(l.id);
          if (i == null) continue;
          const r = list[i];
          r.book = l.book_qty;
          r.unitCost = l.unit_cost;
          r.saved = l.actual_qty;
        }
        for (const c of sent) {
          const i = index.get(c.id);
          if (i != null && list[i].raw === c.raw) list[i].serverError = null;
        }
      }),
    );
  };

  /** Returns false when the save failed; `explicit` → toasts for every outcome. */
  const send = async (changes: Change[]): Promise<boolean> => {
    setSaving(true);
    try {
      const doc = await api.patch<StockCount>(`/api/stock-counts/${sc.id}`, {
        lines: changes.map((c) => ({ id: c.id, actual_qty: c.actual_qty })),
      });
      applyServer(doc, changes);
      setSaveFailed(false);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const fe = err.fieldErrors();
        setRows(
          produce((list) => {
            for (const [field, msg] of Object.entries(fe)) {
              const m = /^lines\.(\d+)\.(actual_qty|id)$/.exec(field);
              const c = m ? changes[Number(m[1])] : undefined;
              const i = c ? index.get(c.id) : undefined;
              if (c && i != null && list[i].raw === c.raw) list[i].serverError = msg;
            }
          }),
        );
        setSaveFailed(false);
        return false;
      }
      if (err instanceof ApiError && (err.code === "document_not_draft" || err.status === 404)) {
        gone = true;
        toast({ type: "error", title: "This stock count can’t be edited", text: err.message });
        props.onStale();
        return false;
      }
      setSaveFailed(true);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const flush = async (): Promise<boolean> => {
    clearTimeout(timer);
    for (;;) {
      if (gone) return false;
      if (inflight) {
        await inflight;
        continue;
      }
      const changes: Change[] = rows
        .filter(isDirty)
        .map((r) => ({ id: r.id, actual_qty: parsed(r).value ?? null, raw: r.raw }));
      if (!changes.length) return true;
      inflight = send(changes);
      const ok = await inflight;
      inflight = null;
      if (!ok) return false;
    }
  };

  const onInput = (r: Row, value: string) => {
    const i = index.get(r.id)!;
    setRows(i, { raw: value, serverError: null });
    if (isDirty(rows[i])) schedule();
  };

  const hasUnsaved = () => saving() || rows.some((r) => isDirty(r) || !!errorOf(r));

  onMount(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (gone || !hasUnsaved()) return;
      void flush();
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    onCleanup(() => window.removeEventListener("beforeunload", beforeUnload));
  });
  onCleanup(() => {
    clearTimeout(timer);
    clearTimeout(qTimer);
  });

  useBeforeLeave((e) => {
    if (gone || e.defaultPrevented) return;
    const invalid = totals().invalid;
    const dirty = rows.some(isDirty) || saving();
    if (!invalid && !dirty) return;
    e.preventDefault();
    void (async () => {
      const ok = await flush();
      if (ok && !totals().invalid) return e.retry(true);
      const n = totals().invalid;
      const leave = await confirm({
        title: "Leave without saving?",
        body: n
          ? `${pl(n, "quantity", "quantities")} ${n === 1 ? "has an error and isn’t" : "have errors and aren’t"} saved. Other quantities are saved.`
          : "Some quantities couldn’t be saved. Check your connection and try again, or leave and lose them.",
        confirmLabel: "Leave page",
        confirmVariant: "danger",
        cancelLabel: "Stay on page",
      });
      if (leave) {
        gone = true;
        e.retry(true);
      }
    })();
  });

  /* Book qty is live: refresh it when the tab becomes visible again. */
  onMount(() => {
    const onVis = async () => {
      if (document.visibilityState !== "visible" || gone) return;
      try {
        const doc = await api.get<StockCount>(`/api/stock-counts/${sc.id}`);
        if (doc.status !== "draft") {
          gone = true;
          props.onStale();
          return;
        }
        setRows(
          produce((list) => {
            for (const l of doc.lines) {
              const i = index.get(l.id);
              if (i == null) continue;
              list[i].book = l.book_qty;
              list[i].unitCost = l.unit_cost;
            }
          }),
        );
      } catch {
        /* keep current values */
      }
    };
    document.addEventListener("visibilitychange", onVis);
    onCleanup(() => document.removeEventListener("visibilitychange", onVis));
  });

  /* ------------------------------------------------------------ actions -- */
  let body: HTMLTableSectionElement | undefined;
  const focusInvalid = () => {
    const r = rows.find((x) => !!errorOf(x));
    if (!r) return;
    if (!visibleIds().has(r.id)) resetView();
    queueMicrotask(() => document.getElementById(`act-${r.id}`)?.focus());
  };
  const fixText = (n: number) => pl(n, "highlighted quantity", "highlighted quantities");

  const save = async () => {
    const t = totals();
    if (t.invalid) {
      toast({ type: "error", title: "Draft not saved", text: `Fix ${fixText(t.invalid)} first.` });
      focusInvalid();
      return;
    }
    const ok = await flush();
    if (ok) {
      const t2 = totals();
      toast({ type: "success", title: "Draft saved", text: `${t2.counted} of ${t2.total} items counted.` });
    } else if (totals().invalid) {
      toast({ type: "error", title: "Draft not saved", text: `Fix ${fixText(totals().invalid)} first.` });
      focusInvalid();
    } else if (!gone) {
      toast({ type: "error", title: "Draft not saved", text: "Check your connection and try again. Your entries are kept on this page." });
    }
  };

  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [posting, setPosting] = createSignal(false);
  const [postError, setPostError] = createSignal<string | null>(null);
  const [preparing, setPreparing] = createSignal(false);

  const post = async () => {
    if (totals().invalid) {
      toast({ type: "error", title: "Can’t post yet", text: `Fix ${fixText(totals().invalid)} before posting.` });
      focusInvalid();
      return;
    }
    setPreparing(true);
    const ok = await flush();
    setPreparing(false);
    if (!ok) {
      if (totals().invalid) {
        toast({ type: "error", title: "Can’t post yet", text: `Fix ${fixText(totals().invalid)} before posting.` });
        focusInvalid();
      } else if (!gone)
        toast({ type: "error", title: "Can’t post yet", text: "Quantities couldn’t be saved. Check your connection and try again." });
      return;
    }
    setPostError(null);
    setConfirmOpen(true);
  };

  const doPost = async () => {
    if (posting()) return;
    setPosting(true);
    setPostError(null);
    try {
      const posted = await api.post<StockCount>(`/api/stock-counts/${sc.id}/post`);
      gone = true;
      setConfirmOpen(false);
      const changed = posted.surplus_count + posted.shortage_count;
      toast({
        type: "success",
        title: `Stock count ${posted.number} posted`,
        text: changed ? `Stock adjusted for ${pl(changed, "product")}.` : "No differences — stock unchanged.",
      });
      props.onPosted(posted);
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const fe = err.fieldErrors();
        setPostError(fe.lines ?? Object.values(fe)[0] ?? err.message);
      } else if (err instanceof ApiError && (err.code === "document_not_draft" || err.status === 404)) {
        gone = true;
        setConfirmOpen(false);
        toast({ type: "error", title: "Can’t post this stock count", text: err.message });
        props.onStale();
      } else {
        setPostError(err instanceof Error && !(err instanceof ApiError && err.isNetworkError) ? err.message : "Couldn’t post the count. Check your connection and try again.");
      }
    } finally {
      setPosting(false);
    }
  };

  const del = async () => {
    const ok = await confirm({
      title: `Delete draft ${sc.number}?`,
      body: "The count and all entered quantities will be deleted. Stock isn’t affected.",
      confirmLabel: "Delete draft",
      confirmVariant: "danger",
      size: "sm",
      action: async () => {
        clearTimeout(timer);
        if (inflight) await inflight;
        await api.delete(`/api/stock-counts/${sc.id}`);
      },
    });
    if (!ok) return;
    gone = true;
    toast({ type: "success", title: "Draft deleted", text: `${sc.number} was deleted.` });
    navigate("/stock-counts");
  };

  const footText = () => {
    const t = totals();
    let s = `${t.counted} of ${t.total} items counted`;
    if (t.notCounted) s += ` · ${t.notCounted} not counted stay unchanged`;
    if (t.invalid) s += ` · ${pl(t.invalid, "quantity", "quantities")} to fix`;
    if (saving()) s += " · Saving…";
    else if (saveFailed()) s += " · Not saved yet — check your connection";
    return s;
  };

  const chips = () => {
    const t = totals();
    return [
      ["all", "All", t.total],
      ["diff", "Differences", t.surplusN + t.shortageN],
      ["uncounted", "Not counted", t.notCounted],
    ] as const;
  };

  const noResults = () => {
    const show = filters().show;
    const q = query().trim();
    return {
      title:
        show === "uncounted" && !q ? "Every item is counted" : show === "diff" && !q ? "No differences so far" : "No items match",
      text: q ? `Nothing matches “${q}” in this view.` : "Switch to All to see every item in this count.",
    };
  };

  const actions = (where: "head" | "foot") => (
    <>
      <button
        type="button"
        class="btn btn-secondary"
        data-act="save"
        onClick={() => void save()}
        disabled={posting()}
      >
        Save draft
      </button>
      <button
        type="button"
        class={`btn btn-primary${preparing() && where === "head" ? " is-loading" : ""}`}
        data-act="post"
        onClick={() => void post()}
        disabled={preparing() || posting()}
      >
        <Icon name="check" size={18} />
        <span>Post adjustments</span>
      </button>
    </>
  );

  return (
    <>
      <div class="page-header">
        <div>
          <Breadcrumb current={sc.number} />
          <div class="page-title-row">
            <h1>Stock count {sc.number}</h1>
            <StatusBadge doc={sc} />
          </div>
          <p class="page-subtitle">
            {scopeLabel(sc)} · Created {fmtDateTime(sc.created_at)}
            {sc.note ? ` · ${sc.note}` : ""}
          </p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-danger-ghost" data-act="delete" onClick={() => void del()}>
            <Icon name="trash" size={18} />
            <span>Delete draft</span>
          </button>
          {actions("head")}
        </div>
      </div>
      <div class="stack">
        <section class="kpi-grid" id="sc-kpis" aria-label="Count summary" aria-live="polite">
          <Kpis t={totals()} />
        </section>
        <div class="alert alert-info">
          <span class="alert-icon">
            <Icon name="info" size={20} />
          </span>
          <div class="alert-content">
            <p class="alert-title">Uncounted items stay unchanged</p>
            <p class="alert-body">
              Leave Actual qty empty for items you haven’t counted yet. When you post, only counted items with a
              difference are adjusted. Book quantity shows current stock and updates as receipts and write-offs are
              posted. Differences are fixed when you post.
            </p>
          </div>
        </div>
        <div class="toolbar" style={{ "margin-bottom": "0" }}>
          <div class="search">
            <span class="search-icon">
              <Icon name="search" size={18} />
            </span>
            <label class="visually-hidden" for="sc-search">
              Search items
            </label>
            <input
              ref={searchEl}
              class="input"
              id="sc-search"
              type="search"
              placeholder="Search by name or SKU"
              autocomplete="off"
              value={query()}
              onInput={(e) => onSearch(e.currentTarget.value)}
            />
          </div>
          <div class="toolbar-group" role="group" aria-label="Show items" id="sc-chips">
            <For each={chips()}>
              {(c) => (
                <button
                  type="button"
                  class={`chip${filters().show === c[0] ? " is-active" : ""}`}
                  aria-pressed={filters().show === c[0] ? "true" : "false"}
                  data-filter={c[0]}
                  onClick={() => {
                    setFilters({ show: c[0] });
                    recompute();
                  }}
                >
                  {c[1]} <span class="chip-count">{c[2]}</span>
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="card">
          <div class="table-wrap" hidden={visibleRows().length === 0}>
            <table class="table table-cards sc-table">
              <caption class="visually-hidden">Count lines. Enter the actual quantity for each product.</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Unit</th>
                  <th scope="col" class="num">
                    Book qty (current)
                  </th>
                  <th scope="col" class="num">
                    Actual qty
                  </th>
                  <th scope="col" class="num">
                    Difference qty
                  </th>
                  <th scope="col" class="num">
                    Difference (avg cost)
                  </th>
                </tr>
              </thead>
              <tbody id="sc-body" ref={body}>
                <For each={visibleRows()}>
                  {(r) => {
                    const err = () => errorOf(r);
                    const c = () => calcOf(r);
                    const p = r.product;
                    return (
                      <tr data-line={r.id} class={err() ? "is-invalid" : undefined}>
                        <ProductCell p={p} />
                        <td data-label="Unit">{p.unit}</td>
                        <td data-label="Book qty (current)" class="num">
                          {fmtQty(r.book, p.unit)}
                        </td>
                        <td data-label="Actual qty" class="num sc-actual">
                          <label class="visually-hidden" for={`act-${r.id}`}>
                            Actual quantity of {p.name}, in {p.unit}
                          </label>
                          <div class={`input-group sc-input${err() ? " is-invalid" : ""}`}>
                            <input
                              class="input num"
                              id={`act-${r.id}`}
                              type="text"
                              inputmode={isFractionalUnit(p.unit) ? "decimal" : "numeric"}
                              autocomplete="off"
                              placeholder="Not counted"
                              value={r.raw}
                              aria-invalid={err() ? "true" : undefined}
                              aria-describedby={err() ? `err-${r.id}` : undefined}
                              onInput={(e) => onInput(r, e.currentTarget.value)}
                              onBlur={() => {
                                if (rows.some(isDirty)) void flush();
                              }}
                            />
                            <span class="input-addon" aria-hidden="true">
                              {p.unit}
                            </span>
                          </div>
                          <Show when={err()}>
                            <p class="error-text" id={`err-${r.id}`}>
                              <Icon name="alert-circle" size={16} />
                              <span>{err()}</span>
                            </p>
                          </Show>
                        </td>
                        <td data-label="Difference qty" class="num" data-cell="diff">
                          <DiffQty counted={c().counted} diff={c().diff} unit={p.unit} />
                        </td>
                        <td data-label="Difference (avg cost)" class="num" data-cell="val">
                          <DiffValue counted={c().counted} val={c().val} />
                        </td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
          <div id="sc-noresults">
            <Show when={visibleRows().length === 0}>
              <EmptyState
                icon="search"
                compact
                title={noResults().title}
                text={noResults().text}
                actions={
                  <button type="button" class="btn btn-secondary" data-act="reset" onClick={resetView}>
                    Show all items
                  </button>
                }
              />
            </Show>
          </div>
          <div class="card-footer">
            <span class="hint" id="sc-foot" aria-live="polite">
              {footText()}
            </span>
            <div class="form-actions">{actions("foot")}</div>
          </div>
        </div>
      </div>

      <Modal
        open={confirmOpen()}
        onClose={() => !posting() && setConfirmOpen(false)}
        title={`Post stock count ${sc.number}?`}
        size="md"
        confirmLabel="Post adjustments"
        cancelLabel="Keep editing"
        confirmBusy={posting()}
        onConfirm={() => void doPost()}
      >
        <ConfirmBody t={totals()} error={postError()} />
      </Modal>
    </>
  );
}

function ConfirmBody(props: { t: ReturnType<typeof totalsOf>; error: string | null }): JSX.Element {
  const t = () => props.t;
  return (
    <>
      <Show when={props.error}>
        <div class="alert alert-danger" role="alert">
          <span class="alert-icon">
            <Icon name="alert-circle" size={20} />
          </span>
          <div class="alert-content">
            <p class="alert-title">Can’t post this count</p>
            <p class="alert-body">{props.error}</p>
          </div>
        </div>
      </Show>
      <Show when={t().notCounted}>
        <div class="alert alert-warning">
          <span class="alert-icon">
            <Icon name="alert-triangle" size={20} />
          </span>
          <div class="alert-content">
            <p class="alert-title">{pl(t().notCounted, "item")} not counted</p>
            <p class="alert-body">
              {t().notCounted === 1 ? "It keeps its" : "They keep their"} book quantity and won’t be adjusted.
            </p>
          </div>
        </div>
      </Show>
      <div class="totals sc-confirm-totals">
        <div class="totals-row">
          <span>Items with surplus</span>
          <span>
            {t().surplusN} · <span class="fw-semibold text-success">{fmtSignedMoney(t().surplusV)}</span>
          </span>
        </div>
        <div class="totals-row">
          <span>Items with shortage</span>
          <span>
            {t().shortageN} · <span class="fw-semibold text-danger">{fmtSignedMoney(t().shortageV)}</span>
          </span>
        </div>
        <div class="totals-row">
          <span>Unchanged</span>
          <span>{t().unchanged}</span>
        </div>
        <div class="totals-row">
          <span>Not counted (left unchanged)</span>
          <span>{t().notCounted}</span>
        </div>
        <div class="totals-row is-grand">
          <span>Net change</span>
          <span>{fmtSignedMoney(t().net)}</span>
        </div>
      </div>
      <p>
        Stock for each counted item will be set to the actual quantity. Differences are recorded against stock at the
        moment of posting. Uncounted items stay unchanged. Posted counts can’t be edited.
      </p>
      <p class="hint">
        <Icon name="info" size={16} /> Amounts above are at current average cost and use current stock as the book
        quantity. The change is recorded in History.
      </p>
    </>
  );
}
