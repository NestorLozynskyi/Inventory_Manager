import { For, Match, Show, Switch, createEffect, createSignal, type JSX } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { useNavigate, useParams } from "@solidjs/router";
import { api, ApiError } from "../../api/client";
import { AppShell } from "../../components/AppShell";
import { errorText } from "../../components/LoadView";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { SkeletonRows } from "../../components/SkeletonRows";
import { toast } from "../../components/Toast";
import { UNITS } from "../../lib/format";
import { createLoader } from "../../lib/resource";
import {
  EMPTY_VALUES,
  FIELD_META,
  FIELD_ORDER,
  LIMITS,
  mapServerErrors,
  summaryTitle,
  toPayload,
  validateField,
  valuesFromProduct,
  type FieldError,
  type FieldKey,
  type FormValues,
} from "./productFormLogic";
import type { Category, Product, ProductListResponse } from "./types";
import "./ProductForm.css";

type ErrMap = Partial<Record<FieldKey, FieldError>>;

/** Find the product that already uses `sku` (for the duplicate-SKU message); null if not found. */
async function findSkuOwner(sku: string, selfId: number | null): Promise<Product | null> {
  try {
    const res = await api.get<ProductListResponse>(`/api/products?status=all&search=${encodeURIComponent(sku)}`);
    return res.items.find((p) => p.sku.toLowerCase() === sku.toLowerCase() && p.id !== selfId) ?? null;
  } catch {
    return null;
  }
}

export default function ProductForm() {
  const params = useParams();
  const navigate = useNavigate();
  const editId = () => (params.id ? Number(params.id) : null);
  const isEdit = () => editId() != null;

  const product = createLoader((signal) =>
    editId() != null ? api.get<Product>(`/api/products/${editId()}`, signal) : Promise.resolve(null),
  );
  const categories = createLoader((signal) => api.get<Category[]>("/api/categories", signal));

  const [values, setValues] = createStore<FormValues>({ ...EMPTY_VALUES });
  const [shown, setShown] = createSignal<ErrMap>({});
  const [serverErr, setServerErr] = createSignal<ErrMap>({});
  const [submitted, setSubmitted] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const touched = new Set<FieldKey>();
  let summaryEl: HTMLDivElement | undefined;

  // Fill the form once the product is loaded (edit).
  let filledFor: number | null = null;
  createEffect(() => {
    const p = product.data();
    if (p && filledFor !== p.id) {
      filledFor = p.id;
      setValues(reconcile(valuesFromProduct(p)));
    }
  });

  const unitLocked = () => {
    const p = product.data();
    return !!p && (p.has_movements || p.stock !== 0);
  };

  /** Current error of a field: client rule first, then the last server error (until the field changes). */
  const currentError = (k: FieldKey): FieldError | null => validateField(k, values) ?? serverErr()[k] ?? null;
  const errorsList = () =>
    FIELD_ORDER.map((k) => ({ key: k, err: currentError(k) })).filter(
      (x): x is { key: FieldKey; err: FieldError } => !!x.err,
    );

  const setShownFor = (k: FieldKey, e: FieldError | null) =>
    setShown((m) => {
      const next = { ...m };
      if (e) next[k] = e;
      else delete next[k];
      return next;
    });

  const onInput = (k: FieldKey, v: string) => {
    setValues(k, v);
    touched.add(k);
    if (serverErr()[k])
      setServerErr((m) => {
        const next = { ...m };
        delete next[k];
        return next;
      });
    if (shown()[k] && !currentError(k)) setShownFor(k, null);
    // Unit change re-checks the minimum stock precision.
    if (k === "unit" && (shown().min || submitted())) setShownFor("min", currentError("min"));
  };
  const onBlur = (k: FieldKey) => {
    if (!touched.has(k) && !submitted()) return;
    setShownFor(k, currentError(k));
  };

  const focusField = (k: FieldKey) => {
    const el = document.getElementById(FIELD_META[k].input);
    el?.focus();
    el?.scrollIntoView?.({ block: "center" });
  };
  const showSummary = () => {
    queueMicrotask(() => {
      summaryEl?.focus();
      summaryEl?.scrollIntoView?.({ block: "start" });
    });
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (saving()) return;
    setSubmitted(true);
    setServerErr({});
    const errs = errorsList();
    setShown(Object.fromEntries(errs.map((x) => [x.key, x.err])) as ErrMap);
    if (errs.length) {
      showSummary();
      return;
    }
    setSaving(true);
    try {
      const body = toPayload(values);
      const saved = isEdit()
        ? await api.put<Product>(`/api/products/${editId()}`, body)
        : await api.post<Product>("/api/products", body);
      toast(
        isEdit()
          ? { type: "success", title: "Product saved", text: `Changes to ${saved.name} are saved.` }
          : {
              type: "success",
              title: "Product created",
              text: `${saved.name} was added to your catalogue. Create a receipt to bring it into stock.`,
            },
      );
      navigate(`/products/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors()).length) {
        const { fields, general } = mapServerErrors(err.fieldErrors());
        if (err.code === "duplicate_sku") {
          const sku = values.sku.trim();
          const owner = await findSkuOwner(sku, editId());
          if (owner)
            fields.sku = {
              msg: `SKU ${owner.sku} is already used by ‘${owner.name}’. SKUs must be unique in your account.`,
              link: { href: `/products/${owner.id}`, label: `View ${owner.name}` },
              summary: `SKU ${owner.sku} is already used`,
            };
        }
        setServerErr(fields);
        setShown((m) => ({ ...m, ...fields }));
        general.forEach((g) => toast({ type: "error", title: g }));
        showSummary();
      } else {
        toast({
          type: "error",
          title: "Couldn’t save the product",
          text: err instanceof ApiError ? err.message : undefined,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const errorBox = (k: FieldKey): JSX.Element => (
    <p class="error-text" id={`${FIELD_META[k].input}-error`} hidden={!shown()[k]}>
      <Show when={shown()[k]}>
        {(e) => (
          <>
            <Icon name="alert-circle" size={16} />
            <span>
              {e().msg}
              <Show when={e().link}>
                {(l) => (
                  <>
                    {" "}
                    <a class="link" href={l().href}>
                      {l().label}
                    </a>
                  </>
                )}
              </Show>
            </span>
          </>
        )}
      </Show>
    </p>
  );
  const fieldCls = (k: FieldKey) => `field${shown()[k] ? " is-invalid" : ""}`;
  const invalid = (k: FieldKey) => (shown()[k] ? "true" : undefined);

  const title = () => (isEdit() ? (product.data() ? `Edit ${product.data()!.name}` : "Edit product") : "New product");
  const summary = () => (submitted() ? errorsList() : []);

  const form = (): JSX.Element => (
    <div class="form-wrap stack">
      <div
        ref={summaryEl}
        class="alert alert-danger error-summary"
        role="alert"
        tabindex="-1"
        hidden={summary().length === 0}
      >
        <span class="alert-icon">
          <Icon name="alert-circle" />
        </span>
        <div class="alert-content">
          <p class="alert-title">{summaryTitle(summary().length)}</p>
          <div class="alert-body">
            <ul>
              <For each={summary()}>
                {(x) => (
                  <li>
                    <a
                      href={`#${FIELD_META[x.key].input}`}
                      onClick={(e) => {
                        e.preventDefault();
                        focusField(x.key);
                      }}
                    >
                      {FIELD_META[x.key].label}: {x.err.summary ?? x.err.msg}
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </div>
      </div>

      <form class="card" id="product-form" novalidate aria-labelledby="page-title" onSubmit={submit}>
        <div class="card-body stack-lg">
          <div class="stack">
            <h2 class="form-section-title">Basic details</h2>
            <div class="form-grid">
              <div class={fieldCls("sku")}>
                <label for="f-sku">SKU</label>
                <input
                  class="input mono"
                  id="f-sku"
                  name="sku"
                  type="text"
                  autocomplete="off"
                  spellcheck={false}
                  maxlength={LIMITS.sku}
                  aria-describedby="f-sku-hint f-sku-error"
                  aria-invalid={invalid("sku")}
                  required
                  value={values.sku}
                  onInput={(e) => onInput("sku", e.currentTarget.value)}
                  onBlur={() => onBlur("sku")}
                />
                <p class="hint" id="f-sku-hint">
                  Your internal code, unique in your account. For example FST-0040.
                </p>
                {errorBox("sku")}
              </div>
              <div class={fieldCls("name")}>
                <label for="f-name">Name</label>
                <input
                  class="input"
                  id="f-name"
                  name="name"
                  type="text"
                  autocomplete="off"
                  maxlength={LIMITS.name}
                  aria-describedby="f-name-error"
                  aria-invalid={invalid("name")}
                  required
                  value={values.name}
                  onInput={(e) => onInput("name", e.currentTarget.value)}
                  onBlur={() => onBlur("name")}
                />
                {errorBox("name")}
              </div>
              <div class={fieldCls("category")}>
                <div class="field-note">
                  <label for="f-category" class="field-label">
                    Category <span class="optional">(optional)</span>
                  </label>
                  <a class="link-subtle text-sm" href="/categories">
                    Manage categories
                  </a>
                </div>
                <select
                  class="select"
                  id="f-category"
                  name="category"
                  aria-describedby="f-category-error"
                  aria-invalid={invalid("category")}
                  value={values.category}
                  onChange={(e) => onInput("category", e.currentTarget.value)}
                >
                  <option value="">No category</option>
                  <For each={categories.data() ?? []}>{(c) => <option value={String(c.id)}>{c.name}</option>}</For>
                  <Show
                    when={
                      values.category &&
                      !categories.data()?.some((c) => String(c.id) === values.category) &&
                      product.data()?.category_id != null
                    }
                  >
                    <option value={values.category}>{product.data()?.category_name ?? "Current category"}</option>
                  </Show>
                </select>
                {errorBox("category")}
              </div>
              <div class={fieldCls("unit")}>
                <label for="f-unit">Unit of measure</label>
                <select
                  class="select"
                  id="f-unit"
                  name="unit"
                  aria-describedby={unitLocked() ? "f-unit-hint f-unit-error" : "f-unit-error"}
                  aria-invalid={invalid("unit")}
                  required
                  disabled={unitLocked()}
                  value={values.unit}
                  onChange={(e) => onInput("unit", e.currentTarget.value)}
                  onBlur={() => onBlur("unit")}
                >
                  <option value="">Select a unit</option>
                  <For each={UNITS}>{(u) => <option value={u}>{u}</option>}</For>
                </select>
                <Show when={unitLocked()}>
                  <p class="hint" id="f-unit-hint">
                    The unit can’t be changed after stock movements are recorded.
                  </p>
                </Show>
                {errorBox("unit")}
              </div>
            </div>
          </div>

          <hr class="divider" style={{ margin: "0" }} />

          <div class="stack">
            <h2 class="form-section-title">Prices and stock level</h2>
            <div class="form-grid">
              <div class={fieldCls("purchase")}>
                <label for="f-purchase">Purchase price</label>
                <div class="input-group">
                  <span class="input-addon" aria-hidden="true">
                    $
                  </span>
                  <input
                    class="input num"
                    id="f-purchase"
                    name="purchasePrice"
                    type="text"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="0.00"
                    aria-describedby="f-purchase-hint f-purchase-error"
                    aria-invalid={invalid("purchase")}
                    required
                    value={values.purchase}
                    onInput={(e) => onInput("purchase", e.currentTarget.value)}
                    onBlur={() => onBlur("purchase")}
                  />
                </div>
                <p class="hint" id="f-purchase-hint">
                  Reference price per unit, in USD. Pre-filled in new receipt lines; stock is valued at average cost.
                </p>
                {errorBox("purchase")}
              </div>
              <div class={fieldCls("sale")}>
                <label for="f-sale">Sale price</label>
                <div class="input-group">
                  <span class="input-addon" aria-hidden="true">
                    $
                  </span>
                  <input
                    class="input num"
                    id="f-sale"
                    name="salePrice"
                    type="text"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="0.00"
                    aria-describedby="f-sale-hint f-sale-error"
                    aria-invalid={invalid("sale")}
                    required
                    value={values.sale}
                    onInput={(e) => onInput("sale", e.currentTarget.value)}
                    onBlur={() => onBlur("sale")}
                  />
                </div>
                <p class="hint" id="f-sale-hint">
                  Per unit, in USD.
                </p>
                {errorBox("sale")}
              </div>
              <div class={fieldCls("min")}>
                <label for="f-min">
                  Minimum stock <span class="optional">(optional)</span>
                </label>
                <div class="input-group">
                  <input
                    class="input num"
                    id="f-min"
                    name="minStock"
                    type="text"
                    inputmode="decimal"
                    autocomplete="off"
                    aria-describedby="f-min-hint f-min-error"
                    aria-invalid={invalid("min")}
                    value={values.min}
                    onInput={(e) => onInput("min", e.currentTarget.value)}
                    onBlur={() => onBlur("min")}
                  />
                  <span class="input-addon" id="f-min-unit">
                    {values.unit || "unit"}
                  </span>
                </div>
                <p class="hint" id="f-min-hint">
                  You’ll see a low-stock alert when stock is at or below this level. Leave empty to turn off.
                </p>
                {errorBox("min")}
              </div>
              <Show when={product.data()}>
                {(p) => (
                  <div class="field">
                    <label for="f-avg">Average cost</label>
                    <div class="input-group">
                      <span class="input-addon" aria-hidden="true">
                        $
                      </span>
                      <input
                        class="input num"
                        id="f-avg"
                        type="text"
                        readonly
                        aria-describedby="f-avg-hint"
                        value={p().avg_cost.toFixed(2)}
                      />
                    </div>
                    <p class="hint" id="f-avg-hint">
                      Calculated from posted receipts. Read-only.
                    </p>
                  </div>
                )}
              </Show>
            </div>
          </div>

          <hr class="divider" style={{ margin: "0" }} />

          <div class={fieldCls("desc")}>
            <label for="f-desc">
              Description <span class="optional">(optional)</span>
            </label>
            <textarea
              class="textarea"
              id="f-desc"
              name="description"
              rows="4"
              maxlength={LIMITS.desc}
              aria-describedby="f-desc-hint f-desc-error"
              aria-invalid={invalid("desc")}
              value={values.desc}
              onInput={(e) => onInput("desc", e.currentTarget.value)}
              onBlur={() => onBlur("desc")}
            />
            <p class="hint" id="f-desc-hint">
              Size, material or any note that helps tell similar products apart. Up to {LIMITS.desc} characters.
            </p>
            {errorBox("desc")}
          </div>
        </div>
        <div class="card-footer form-footer">
          <p class="hint">All fields are required unless marked optional.</p>
          <div class="form-actions">
            <a class="btn btn-secondary" href={isEdit() ? `/products/${editId()}` : "/products"}>
              Cancel
            </a>
            <button
              type="submit"
              class={`btn btn-primary${saving() ? " is-loading" : ""}`}
              disabled={saving()}
              aria-busy={saving() ? "true" : undefined}
            >
              <Icon name="check" size={18} />
              <span>Save product</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );

  return (
    <AppShell active="products" title={title()}>
      <div class="page-header">
        <div>
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li>
                <a href="/products">Products</a>
              </li>
              <Show when={isEdit()} fallback={<li aria-current="page">New product</li>}>
                <Show when={product.data()}>
                  {(p) => (
                    <li>
                      <a href={`/products/${p().id}`}>{p().name}</a>
                    </li>
                  )}
                </Show>
                <li aria-current="page">Edit</li>
              </Show>
            </ol>
          </nav>
          <h1 id="page-title">{isEdit() ? "Edit product" : "New product"}</h1>
          <p class="page-subtitle">
            {isEdit()
              ? product.data()
                ? `${product.data()!.name} · ${product.data()!.sku}`
                : " "
              : "Add a product to your catalogue. Stock is added later with a receipt."}
          </p>
        </div>
      </div>

      <Switch>
        <Match when={isEdit() && product.state() === "error"}>
          <div class="form-wrap">
            <div class="card">
              <div class="card-body">
                <ErrorState
                  title={product.error() instanceof ApiError && (product.error() as ApiError).status === 404
                    ? "Product not found"
                    : "Couldn’t load the product"}
                  text={errorText(product.error())}
                  onRetry={() => void product.reload()}
                />
              </div>
            </div>
          </div>
        </Match>
        <Match when={isEdit() && product.state() === "loading"}>
          <div class="form-wrap">
            <div class="card">
              <div class="card-body">
                <SkeletonRows rows={6} cols={2} />
              </div>
            </div>
          </div>
        </Match>
        <Match when={true}>{form()}</Match>
      </Switch>
    </AppShell>
  );
}
