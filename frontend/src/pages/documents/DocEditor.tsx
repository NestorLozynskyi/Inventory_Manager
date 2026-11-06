/**
 * Draft editor for receipts and write-offs (screens/receipt.html + write-off.html, states draft / new /
 * validation / post-confirm / delete-draft / insufficient-stock).
 *
 * Nothing is created on the server until "Save draft" or "Post" (new documents). Post = save (POST/PUT)
 * then POST …/post. Client-side validation mirrors the API; API field errors (422 lines.N.*, 409
 * product_archived) and 409 insufficient_stock (shortages) are shown inline with an error summary.
 */
import { For, Show, batch, createMemo, createSignal, type JSX } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { useNavigate } from "@solidjs/router";
import { ApiError, api } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { toast } from "../../components/Toast";
import { fmtDateTime, fmtMoney, fmtQty, WRITE_OFF_REASONS } from "../../lib/format";
import { DocAlert, DocHeader, MetaItem, useActionBarChrome, useDocTitle } from "./DocParts";
import {
  groupProducts,
  issuesFromShortages,
  mkLine,
  modelFromDoc,
  pl,
  price2,
  productLabel,
  r2,
  receiptLineTotal,
  requestBody,
  stockIssues,
  stockMessage,
  validateModel,
  validationFromFieldErrors,
  writeOffLineValue,
  type Doc,
  type DocConfig,
  type EditModel,
  type LineErrors,
  type ProductRef,
  type Shortage,
  type StockIssue,
  type Validation,
} from "./docs";

export interface Handoff {
  id: number;
  doc: Doc;
  error?: ApiError;
  /** Which action failed ("post" → summary "to post", "save" → "to save this draft"). */
  action?: "post" | "save";
}

export interface DocEditorProps {
  cfg: DocConfig;
  /** null → new document (not saved yet). */
  doc: Doc | null;
  /** Active products (GET /api/products?status=active). */
  products: ProductRef[];
  /** Supplier suggestions (receipts). */
  suppliers?: string[];
  /** Error to show right away (e.g. post failed after the new draft was created). */
  initialError?: ApiError;
  initialAction?: "post" | "save";
  /** A new draft was created → the page navigates to its URL (with the handoff). */
  onCreated: (h: Handoff) => void;
  /** Posted → show the posted document. */
  onPosted: (doc: Doc, wasNew: boolean) => void;
  /** Document changed elsewhere (e.g. 409 document_not_draft) → reload. */
  onReload: () => void;
}

const EMPTY: Validation = { lines: {}, list: [] };

export function DocEditor(props: DocEditorProps): JSX.Element {
  const cfg = props.cfg;
  const isWO = cfg.type === "write_off";
  const navigate = useNavigate();
  const [docRef, setDocRef] = createSignal<Doc | null>(props.doc);
  const isNew = () => !docRef();
  const [model, setModel] = createStore<EditModel>(modelFromDoc(props.doc, cfg));

  /* products: active ones + products already on the draft (may be archived since) */
  const productMap = createMemo(() => {
    const m = new Map<number, ProductRef>();
    for (const p of props.products) m.set(p.id, p);
    for (const l of props.doc?.lines ?? []) if (l.product && !m.has(l.product.id)) m.set(l.product.id, l.product);
    return m;
  });
  /** Stock reported by the server (409 shortages) overrides the loaded value. */
  const [stockOverride, setStockOverride] = createStore<Record<number, number>>({});
  const productOf = (id: number | null): ProductRef | undefined => {
    if (id == null) return undefined;
    const p = productMap().get(id);
    if (!p) return undefined;
    const s = stockOverride[id];
    return s == null ? p : { ...p, stock: s };
  };
  const groups = createMemo(() => groupProducts(props.products));
  const extraOptions = createMemo(() =>
    (props.doc?.lines ?? [])
      .map((l) => l.product)
      .filter((p, i, a): p is ProductRef => !!p && !props.products.some((x) => x.id === p.id) && a.findIndex((y) => y?.id === p.id) === i),
  );

  /* errors */
  const [showErrors, setShowErrors] = createSignal(false);
  const [serverErrs, setServerErrs] = createSignal<Validation | null>(null);
  const [serverStock, setServerStock] = createSignal<Shortage[] | null>(null);
  const [failedAction, setFailedAction] = createSignal<"post" | "save">("post");
  const clientErrs = createMemo(() => (showErrors() ? validateModel(model, cfg, productOf) : EMPTY));

  /** Combined field errors: server errors (until the field changes) + client validation. */
  const errs = createMemo<Validation>(() => {
    const c = clientErrs();
    const s = serverErrs();
    if (!s) return c;
    const lines: Record<string, LineErrors> = {};
    for (const k of new Set([...Object.keys(c.lines), ...Object.keys(s.lines)])) lines[k] = { ...c.lines[k], ...s.lines[k] };
    const seen = new Set<string>();
    const list = [...s.list, ...c.list].filter((it) => {
      const key = it.id || it.text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const order = (id: string) => {
      if (id === "f-reason") return -1;
      const i = model.lines.findIndex((l) => id.startsWith(`${l.key}-`));
      return i < 0 ? 1e6 : i * 3 + (id.endsWith("-p") ? 0 : id.endsWith("-q") ? 1 : 2);
    };
    list.sort((a, b) => order(a.id) - order(b.id));
    return { reason: s.reason ?? c.reason, lines, list };
  });

  const stock = createMemo<StockIssue[]>(() => {
    if (!isWO || !showErrors() || errs().list.length) return [];
    const ss = serverStock();
    if (ss) return issuesFromShortages(ss, model).filter((x) => x.keys.length);
    return stockIssues(model, productOf);
  });
  const stockByKey = createMemo(() => {
    const m: Record<string, string> = {};
    for (const x of stock()) for (const k of x.keys) m[k] = stockMessage(x);
    return m;
  });

  const clearServer = (key: string, which: keyof LineErrors | "reason") => {
    const s = serverErrs();
    if (!s) return;
    const lines = { ...s.lines };
    if (which !== "reason" && lines[key]) {
      lines[key] = { ...lines[key], [which]: undefined };
    }
    const suffix = which === "product" ? "-p" : which === "qty" ? "-q" : which === "price" ? "-c" : "";
    const list = s.list.filter((it) => (which === "reason" ? it.id !== "f-reason" : it.id !== `${key}${suffix}`));
    setServerErrs({ reason: which === "reason" ? undefined : s.reason, lines, list });
  };

  /* totals */
  const lineTotal = (i: number) => {
    const l = model.lines[i];
    return isWO ? writeOffLineValue(l, productOf(l.productId)) : receiptLineTotal(l);
  };
  const total = createMemo(() => r2(model.lines.reduce((s, _l, i) => s + lineTotal(i), 0)));
  const canPost = () => model.lines.some((l) => !!l.productId);
  const productCount = () => new Set(model.lines.map((l) => l.productId).filter((x) => x != null)).size;

  /* chrome */
  useActionBarChrome();
  useDocTitle(() => (isNew() ? `New ${cfg.noun}` : `${cfg.Noun} ${docRef()!.number}`));

  const [srText, setSrText] = createSignal("");
  const say = (t: string) => {
    setSrText("");
    setTimeout(() => setSrText(t), 30);
  };

  const focusSummary = () => queueMicrotask(() => document.getElementById("error-summary")?.focus());
  const focusId = (id: string) => queueMicrotask(() => document.getElementById(id)?.focus());

  /* -------------------------------------------------------------- edits -- */
  const setProduct = (i: number, value: string) => {
    const id = value ? Number(value) : null;
    const key = model.lines[i].key;
    batch(() => {
      setModel("lines", i, "productId", id);
      const p = productOf(id);
      if (!isWO && p) setModel("lines", i, "price", price2(p.purchase_price));
      setServerStock(null);
      clearServer(key, "product");
      if (!isWO && p) clearServer(key, "price");
    });
  };
  const setField = (i: number, f: "qty" | "price", v: string) => {
    const key = model.lines[i].key;
    batch(() => {
      setModel("lines", i, f, v);
      if (f === "qty") setServerStock(null);
      clearServer(key, f);
    });
  };
  const addLine = () => {
    const l = mkLine();
    setModel("lines", (ls) => [...ls, l]);
    focusId(`${l.key}-p`);
    say(`Line ${model.lines.length} added.`);
  };
  const removeLine = (key: string) => {
    if (model.lines.length < 2) return;
    const idx = model.lines.findIndex((l) => l.key === key);
    setModel(produce((m) => void m.lines.splice(idx, 1)));
    setServerErrs(null);
    setServerStock(null);
    if (model.lines.length > 1) focusId(`${model.lines[Math.min(idx, model.lines.length - 1)].key}-p`);
    else focusId("add-line");
    say(`Line ${idx + 1} removed.`);
  };

  /* ------------------------------------------------------------ errors -- */
  const applyApiError = (err: unknown, action: "post" | "save"): boolean => {
    if (!(err instanceof ApiError)) return false;
    if (err.code === "insufficient_stock" && Array.isArray(err.raw.shortages)) {
      const shortages = err.raw.shortages as Shortage[];
      batch(() => {
        for (const s of shortages) setStockOverride(s.product_id, s.available);
        setServerErrs(null);
        setServerStock(shortages);
        setFailedAction(action);
        setShowErrors(true);
      });
      focusSummary();
      return true;
    }
    if (err.code === "validation_error" || err.code === "product_archived") {
      const v = validationFromFieldErrors(err.fieldErrors(), model, err.generalErrors());
      if (!v.list.length) v.list.push({ id: "", text: err.message });
      batch(() => {
        setServerErrs(v);
        setServerStock(null);
        setFailedAction(action);
        setShowErrors(action === "post");
      });
      focusSummary();
      return true;
    }
    if (err.code === "document_not_draft" || err.code === "not_found") {
      toast({ type: "error", title: err.message });
      props.onReload();
      return true;
    }
    return false;
  };

  if (props.initialError) applyApiError(props.initialError, props.initialAction ?? "post");

  /* ----------------------------------------------------------- actions -- */
  const [busy, setBusy] = createSignal<null | "save" | "post" | "delete">(null);
  const [dialog, setDialog] = createSignal<null | "post" | "delete">(null);

  /** Create (POST) or update (PUT) the draft; returns the saved document. */
  const persist = async (): Promise<{ doc: Doc; created: boolean }> => {
    const body = requestBody(model, cfg);
    const cur = docRef();
    if (cur) return { doc: await api.put<Doc>(`${cfg.api}/${cur.id}`, body), created: false };
    return { doc: await api.post<Doc>(cfg.api, body), created: true };
  };

  const saveDraft = async () => {
    if (busy()) return;
    setBusy("save");
    try {
      const { doc, created } = await persist();
      batch(() => {
        setServerErrs(null);
        setServerStock(null);
      });
      toast({
        type: "success",
        title: "Draft saved",
        text: `${doc.number} · ${pl(doc.line_count, "line")} · ${fmtMoney(doc.total)}. Stock isn’t affected until you post.`,
      });
      if (created) props.onCreated({ id: doc.id, doc });
      else setDocRef(doc);
    } catch (err) {
      if (!applyApiError(err, "save")) toast({ type: "error", title: err instanceof Error ? err.message : "Couldn’t save the draft." });
    } finally {
      setBusy(null);
    }
  };

  const attemptPost = () => {
    batch(() => {
      setServerStock(null);
      setFailedAction("post");
      setShowErrors(true);
    });
    if (errs().list.length || stock().length) {
      focusSummary();
      return;
    }
    setDialog("post");
  };

  const confirmPost = async () => {
    if (busy()) return;
    setBusy("post");
    let created: Doc | null = null;
    try {
      const saved = await persist();
      if (saved.created) created = saved.doc;
      else setDocRef(saved.doc);
      const posted = await api.post<Doc>(`${cfg.api}/${saved.doc.id}/post`);
      setDialog(null);
      const n = new Set((posted.lines ?? []).map((l) => l.product?.id)).size || productCount();
      toast({
        type: "success",
        title: `${cfg.Noun} ${posted.number} posted`,
        text: `Stock ${isWO ? "decreased" : "increased"} for ${pl(n, "product")}.`,
      });
      props.onPosted(posted, !!created);
    } catch (err) {
      setDialog(null);
      if (created && err instanceof ApiError) {
        // The draft exists now: continue on its own URL with the error shown there.
        props.onCreated({ id: created.id, doc: created, error: err, action: "post" });
      } else if (!applyApiError(err, "post")) {
        toast({ type: "error", title: err instanceof Error ? err.message : "Couldn’t post." });
        if (created) props.onCreated({ id: created.id, doc: created });
      }
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    const cur = docRef();
    if (!cur) {
      setDialog(null);
      navigate(cfg.listPath);
      return;
    }
    if (busy()) return;
    setBusy("delete");
    try {
      await api.delete(`${cfg.api}/${cur.id}`);
      setDialog(null);
      toast({ type: "success", title: "Draft deleted", text: `${cur.number} was deleted. Stock wasn’t affected.` });
      navigate(cfg.listPath);
    } catch (err) {
      setDialog(null);
      if (!applyApiError(err, "save")) toast({ type: "error", title: err instanceof Error ? err.message : "Couldn’t delete the draft." });
    } finally {
      setBusy(null);
    }
  };

  /* ------------------------------------------------------------- render -- */
  const errIcon = () => <Icon name="alert-circle" size={16} />;
  const ErrorText = (p: { id: string; msg?: string }) => (
    <Show when={p.msg}>
      <span class="error-text" id={p.id}>
        {errIcon()}
        <span>{p.msg}</span>
      </span>
    </Show>
  );
  const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

  const summaryTitle = () =>
    failedAction() === "save" && !showErrors()
      ? `Fix ${pl(errs().list.length, "problem")} to save this draft`
      : `Fix ${pl(errs().list.length, "problem")} to post this ${cfg.noun}`;

  const summary = () => (
    <Show
      when={errs().list.length > 0}
      fallback={
        <Show when={stock().length > 0}>
          <DocAlert
            kind="danger"
            icon="alert-triangle"
            id="error-summary"
            tabindex="-1"
            labelledby="error-summary-t"
            title={<span id="error-summary-t">Can’t post: not enough stock for {pl(stock().length, "item")}</span>}
          >
            <p>Stock can’t go below zero. Reduce the quantities or remove these lines, then post again.</p>
            <div class="table-wrap">
              <table class="table table-cards table-compact">
                <caption class="visually-hidden">Items with insufficient stock</caption>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col" class="num">
                      Requested
                    </th>
                    <th scope="col" class="num">
                      Available
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={stock()}>
                    {(x) => (
                      <tr>
                        <td class="td-primary" data-label="Product">
                          <a
                            class="cell-link"
                            href={`#${x.keys[0]}-q`}
                            onClick={(e) => {
                              e.preventDefault();
                              document.getElementById(`${x.keys[0]}-q`)?.focus();
                            }}
                          >
                            {x.name}
                          </a>
                          <span class="cell-sub mono">{x.sku}</span>
                        </td>
                        <td class="num" data-label="Requested">
                          {fmtQty(x.requested, x.unit)}
                        </td>
                        <td class="num" data-label="Available">
                          <strong>{fmtQty(x.available, x.unit)}</strong>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </DocAlert>
        </Show>
      }
    >
      <DocAlert
        kind="danger"
        icon="alert-circle"
        id="error-summary"
        tabindex="-1"
        labelledby="error-summary-t"
        title={<span id="error-summary-t">{summaryTitle()}</span>}
      >
        <ul>
          <For each={errs().list}>
            {(it) => (
              <li>
                <Show when={it.id} fallback={it.text}>
                  <a
                    class="link"
                    href={`#${it.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(it.id)?.focus();
                    }}
                  >
                    {it.text}
                  </a>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </DocAlert>
    </Show>
  );

  const productSelect = (i: () => number, key: string) => {
    const l = () => model.lines[i()];
    const err = () => errs().lines[key]?.product;
    return (
      <select
        class="select"
        id={`${key}-p`}
        data-f="product"
        aria-label={`Product, line ${i() + 1}`}
        aria-invalid={err() ? "true" : undefined}
        aria-describedby={describedBy(err() && `${key}-pe`)}
        onChange={(e) => setProduct(i(), e.currentTarget.value)}
      >
        <option value="" selected={!l().productId}>
          Choose a product…
        </option>
        <For each={groups()}>
          {(g) => (
            <optgroup label={g.label}>
              <For each={g.items}>
                {(p) => (
                  <option value={p.id} selected={p.id === l().productId}>
                    {productLabel(p)}
                  </option>
                )}
              </For>
            </optgroup>
          )}
        </For>
        <Show when={extraOptions().length}>
          <optgroup label="Archived">
            <For each={extraOptions()}>
              {(p) => (
                <option value={p.id} selected={p.id === l().productId}>
                  {productLabel({ ...p, archived: true })}
                </option>
              )}
            </For>
          </optgroup>
        </Show>
      </select>
    );
  };

  const lineRow = (key: string, i: () => number) => {
    const l = () => model.lines[i()];
    const p = () => productOf(l().productId);
    const le = () => errs().lines[key] ?? {};
    const qtyMsg = () => le().qty ?? stockByKey()[key];
    const invalid = () => !!(le().product || qtyMsg() || le().price);
    const n = () => i() + 1;
    return (
      <tr data-key={key} class={invalid() ? "is-invalid" : undefined}>
        <td class="dl-index">{n()}</td>
        <td class="dl-product">
          <label class="dl-label" for={`${key}-p`}>
            Product
          </label>
          {productSelect(i, key)}
          <ErrorText id={`${key}-pe`} msg={le().product} />
        </td>
        <td class="dl-qty">
          <label class="dl-label" for={`${key}-q`}>
            Quantity
          </label>
          <div class={`input-group${qtyMsg() ? " is-invalid" : ""}`}>
            <input
              class="input num"
              id={`${key}-q`}
              data-f="qty"
              inputmode="decimal"
              autocomplete="off"
              aria-label={`Quantity, line ${n()}${p() ? `, in ${p()!.unit}` : ""}`}
              aria-invalid={qtyMsg() ? "true" : undefined}
              aria-describedby={describedBy(isWO && !!p() && `${key}-sh`, !!qtyMsg() && `${key}-qe`)}
              value={l().qty}
              onInput={(e) => setField(i(), "qty", e.currentTarget.value)}
            />
            <span class="input-addon" aria-hidden="true">
              {p()?.unit ?? "—"}
            </span>
          </div>
          <Show when={isWO && p()}>
            <span class="hint" id={`${key}-sh`}>
              In stock: {fmtQty(p()!.stock, p()!.unit)}
            </span>
          </Show>
          <ErrorText id={`${key}-qe`} msg={qtyMsg()} />
        </td>
        <Show
          when={isWO}
          fallback={
            <td class="dl-price">
              <label class="dl-label" for={`${key}-c`}>
                Unit price
              </label>
              <div class={`input-group${le().price ? " is-invalid" : ""}`}>
                <span class="input-addon" aria-hidden="true">
                  $
                </span>
                <input
                  class="input num"
                  id={`${key}-c`}
                  data-f="price"
                  inputmode="decimal"
                  autocomplete="off"
                  aria-label={`Unit price in dollars, line ${n()}`}
                  aria-invalid={le().price ? "true" : undefined}
                  aria-describedby={describedBy(!!le().price && `${key}-ce`)}
                  value={l().price}
                  onInput={(e) => setField(i(), "price", e.currentTarget.value)}
                />
              </div>
              <Show when={n() === 1}>
                <span class="hint">Pre-filled from the product’s purchase price</span>
              </Show>
              <ErrorText id={`${key}-ce`} msg={le().price} />
            </td>
          }
        >
          <td class="dl-price">
            <span class="dl-label">Avg cost</span>
            <span class="dl-static">{p() ? `${fmtMoney(p()!.avg_cost)} / ${p()!.unit}` : "—"}</span>
          </td>
        </Show>
        <td class="dl-total" data-total>
          {fmtMoney(lineTotal(i()))}
        </td>
        <td class="dl-actions">
          <button
            type="button"
            class="btn btn-ghost btn-icon"
            data-act="remove"
            aria-label={`Remove line ${n()}${p() ? ` (${p()!.name})` : ""}`}
            disabled={model.lines.length < 2}
            onClick={() => removeLine(key)}
          >
            <Icon name="trash" size={18} />
          </button>
        </td>
      </tr>
    );
  };

  const createdLabel = () => (isNew() ? "Not saved yet" : `Created ${fmtDateTime(docRef()!.created_at)}`);
  const postDisabled = () => !canPost() || busy() !== null;

  return (
    <div id="doc-root" class={isWO ? "is-write-off" : undefined}>
      <DocHeader
        backHref={cfg.listPath}
        backLabel={`Back to ${cfg.nouns}`}
        title={
          isNew() ? (
            `New ${cfg.noun}`
          ) : (
            <>
              {cfg.Noun} <span class="mono">{docRef()!.number}</span>
            </>
          )
        }
        badge={<Badge kind="draft" />}
        subtitle={
          isNew()
            ? "Not saved yet · stock isn’t affected until you post"
            : `Draft · created ${fmtDateTime(docRef()!.created_at)} · stock isn’t affected until you post`
        }
        actions={
          <>
            <button type="button" class="btn btn-danger-ghost" data-act="delete" onClick={() => setDialog("delete")}>
              <Icon name="trash" size={18} />
              <span>{isNew() ? "Discard" : "Delete draft"}</span>
            </button>
            <button
              type="button"
              class={`btn btn-secondary is-bar-dup${busy() === "save" ? " is-loading" : ""}`}
              data-act="save"
              disabled={busy() !== null}
              onClick={() => void saveDraft()}
            >
              Save draft
            </button>
            <button type="button" class="btn btn-primary is-bar-dup" data-act="post" disabled={postDisabled()} onClick={attemptPost}>
              <Icon name="check" size={18} />
              <span>Post {cfg.noun}</span>
            </button>
          </>
        }
      />
      <div id="error-slot">{summary()}</div>
      <form id="doc-form" class="stack-lg" novalidate onSubmit={(e) => e.preventDefault()}>
        <section class="card" aria-labelledby="sec-details">
          <div class="card-header">
            <h2 class="card-title" id="sec-details">
              Details
            </h2>
          </div>
          <div class="card-body">
            <div class="form-grid">
              <Show
                when={isWO}
                fallback={
                  <div class="field" id="fld-supplier">
                    <label for="f-supplier">
                      Supplier <span class="optional">(optional)</span>
                    </label>
                    <input
                      class="input"
                      id="f-supplier"
                      list="supplier-list"
                      autocomplete="off"
                      placeholder="e.g. Builders Depot Ltd"
                      maxlength="120"
                      value={model.supplier}
                      onInput={(e) => setModel("supplier", e.currentTarget.value)}
                    />
                    <datalist id="supplier-list">
                      <For each={props.suppliers ?? []}>{(s) => <option value={s} />}</For>
                    </datalist>
                  </div>
                }
              >
                <div class={`field${errs().reason ? " is-invalid" : ""}`} id="fld-reason">
                  <label for="f-reason">Reason</label>
                  <select
                    class="select"
                    id="f-reason"
                    aria-required="true"
                    aria-invalid={errs().reason ? "true" : undefined}
                    aria-describedby={describedBy(!!errs().reason && "f-reason-e")}
                    onChange={(e) => {
                      setModel("reason", e.currentTarget.value);
                      clearServer("", "reason");
                    }}
                  >
                    <option value="" selected={!model.reason}>
                      Choose a reason…
                    </option>
                    <For each={WRITE_OFF_REASONS}>
                      {(r) => (
                        <option value={r} selected={r === model.reason}>
                          {r}
                        </option>
                      )}
                    </For>
                  </select>
                  <ErrorText id="f-reason-e" msg={errs().reason} />
                </div>
              </Show>
              <div class="field" id="fld-date">
                <span class="field-label" id="f-date-l">
                  Date
                </span>
                <p class="readonly-value" id="f-date">
                  <Icon name="clock" size={18} />
                  <span>{createdLabel()}</span>
                </p>
                <span class="hint">Set automatically. When you post, the posting date and time are used.</span>
              </div>
              <div class="field span-2">
                <label for="f-note">
                  Note <span class="optional">(optional)</span>
                </label>
                <textarea
                  class="textarea"
                  id="f-note"
                  rows="2"
                  placeholder={isWO ? "e.g. order number or what happened" : "e.g. invoice number or delivery details"}
                  value={model.note}
                  onInput={(e) => setModel("note", e.currentTarget.value)}
                />
              </div>
            </div>
          </div>
        </section>
        <section class="card" aria-labelledby="sec-lines">
          <div class="card-header">
            <div>
              <h2 class="card-title" id="sec-lines">
                Lines
              </h2>
              <p class="card-subtitle">
                {isWO
                  ? "Valued at average cost. Quantities can’t exceed stock on hand. Archived products aren’t listed."
                  : "Unit price is pre-filled from the product’s purchase price and can be changed — it’s fixed when the receipt is posted. Archived products aren’t listed."}
              </p>
            </div>
          </div>
          <div class="card-body doc-card-body">
            <div class="doc-lines-scroll">
              <table class="doc-lines">
                <caption class="visually-hidden">{cfg.Noun} lines</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Product</th>
                    <th scope="col" class="num">
                      Quantity
                    </th>
                    <th scope="col" class="num">
                      {isWO ? "Avg cost" : "Unit price"}
                      <span class="th-hint">{isWO ? "Valued at average cost" : "Pre-filled from the product’s purchase price"}</span>
                    </th>
                    <th scope="col" class="num">
                      {isWO ? "Value" : "Line total"}
                    </th>
                    <th scope="col">
                      <span class="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody id="lines-body">
                  <For each={model.lines.map((l) => l.key)}>{(key, i) => lineRow(key, i)}</For>
                </tbody>
              </table>
            </div>
            <div class="doc-lines-footer">
              <button type="button" class="btn btn-secondary" id="add-line" data-act="add" onClick={addLine}>
                <Icon name="plus" size={18} />
                <span>Add line</span>
              </button>
              <div class="totals" id="totals" aria-live="polite">
                <div class="totals-row">
                  <span>Lines</span>
                  <span>{model.lines.length}</span>
                </div>
                <div class="totals-row is-grand">
                  <span>{isWO ? "Total value" : "Total"}</span>
                  <span>{fmtMoney(total())}</span>
                </div>
              </div>
            </div>
            <p class="hint post-hint" id="post-hint" hidden={canPost()}>
              Add at least one product to post this {cfg.noun}.
            </p>
          </div>
        </section>
      </form>
      <div class="doc-actionbar" role="region" aria-label={`${cfg.Noun} actions`}>
        <button
          type="button"
          class={`btn btn-secondary${busy() === "save" ? " is-loading" : ""}`}
          data-act="save"
          disabled={busy() !== null}
          onClick={() => void saveDraft()}
        >
          Save draft
        </button>
        <button type="button" class="btn btn-primary" data-act="post" disabled={postDisabled()} onClick={attemptPost}>
          Post {cfg.noun}
        </button>
      </div>
      <p class="visually-hidden" role="status" aria-live="polite" id="sr-status">
        {srText()}
      </p>

      <Modal
        open={dialog() === "post"}
        onClose={() => busy() !== "post" && setDialog(null)}
        title={isNew() ? `Post new ${cfg.noun}?` : `Post ${cfg.noun} ${docRef()!.number}?`}
        confirmLabel={`Post ${cfg.noun}`}
        confirmBusy={busy() === "post"}
        onConfirm={() => void confirmPost()}
      >
        <div class="stack">
          <dl class="meta-list">
            <Show when={isWO} fallback={<MetaItem label="Supplier">{model.supplier.trim() || "—"}</MetaItem>}>
              <MetaItem label="Reason">{model.reason}</MetaItem>
            </Show>
            <MetaItem label="Lines">{String(model.lines.length)}</MetaItem>
            <MetaItem label={isWO ? "Total value" : "Total"}>{fmtMoney(total())}</MetaItem>
          </dl>
          <p>
            {isWO
              ? `Stock will decrease for ${pl(productCount(), "product")}. Lines are valued at the average cost at the moment of posting. Posted write-offs can’t be edited — to correct mistakes, reverse them.`
              : `Stock will increase for ${pl(productCount(), "product")}. Posted receipts can’t be edited — to correct mistakes, reverse them.`}
          </p>
          <p class="hint">The posting date and time are set automatically.</p>
        </div>
      </Modal>

      <Modal
        open={dialog() === "delete"}
        onClose={() => busy() !== "delete" && setDialog(null)}
        title={isNew() ? `Discard new ${cfg.noun}?` : `Delete draft ${docRef()!.number}?`}
        size="sm"
        confirmLabel={isNew() ? "Discard" : "Delete draft"}
        confirmVariant="danger"
        confirmBusy={busy() === "delete"}
        onConfirm={() => void confirmDelete()}
      >
        <p>
          {isNew()
            ? `This ${cfg.noun} hasn’t been saved. Everything you entered will be lost.`
            : `This draft and its ${pl(model.lines.length, "line")} will be permanently deleted. Stock isn’t affected because the draft was never posted.`}
        </p>
      </Modal>
    </div>
  );
}
