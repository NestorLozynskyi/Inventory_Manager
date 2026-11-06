import { For, Match, Show, Switch, createSignal, type JSX } from "solid-js";
import { api, ApiError } from "../../api/client";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { LoadView } from "../../components/LoadView";
import { Modal } from "../../components/Modal";
import { SkeletonRows } from "../../components/SkeletonRows";
import { toast } from "../../components/Toast";
import { plural } from "../../lib/format";
import { createLoader } from "../../lib/resource";
import type { Category } from "../products/types";
import "./Categories.css";

export type Dialog =
  | { kind: "create" }
  | { kind: "rename"; cat: Category }
  | { kind: "delete"; cat: Category }
  | { kind: "blocked"; cat: Category; count: number; archived: number };

/** Client-side name check (mirrors the server rules; the server stays the source of truth). */
export function checkCategoryName(value: string, cats: Category[], selfId: number | null): string {
  const v = value.trim();
  if (!v) return "Enter a category name.";
  if (v.length > 60) return "Use at most 60 characters.";
  const dup = cats.find((c) => c.id !== selfId && c.name.toLowerCase() === v.toLowerCase());
  if (dup) return `A category named ‘${dup.name}’ already exists.`;
  return "";
}

export function blockedText(count: number, archived: number): string {
  return (
    `${count}${count === 1 ? " product uses" : " products use"} this category` +
    (archived ? ` (including ${archived} archived)` : "") +
    ". Move them to another category or archive them first."
  );
}

export default function Categories() {
  const cats = createLoader((signal) => api.get<Category[]>("/api/categories", signal));
  const list = () => (cats.data() ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));

  const [dialog, setDialog] = createSignal<Dialog | null>(null);
  /** Last dialog, kept while the modal animates out. */
  const [shownDialog, setShownDialog] = createSignal<Dialog | null>(null);
  const [name, setName] = createSignal("");
  const [nameError, setNameError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let newBtn: HTMLButtonElement | undefined;

  const open = (d: Dialog) => {
    setNameError("");
    setBusy(false);
    if (d.kind === "create") setName("");
    if (d.kind === "rename") setName(d.cat.name);
    setShownDialog(d);
    setDialog(d);
  };
  const close = () => {
    if (!busy()) setDialog(null);
  };

  const openDelete = (c: Category) => {
    if (c.product_count > 0)
      open({ kind: "blocked", cat: c, count: c.product_count, archived: c.product_count - c.active_product_count });
    else open({ kind: "delete", cat: c });
  };

  const focusName = () =>
    queueMicrotask(() => {
      const i = document.getElementById("cat-name") as HTMLInputElement | null;
      i?.focus();
      i?.select();
    });

  const saveName = async () => {
    const d = dialog();
    if (!d || busy() || (d.kind !== "create" && d.kind !== "rename")) return;
    const selfId = d.kind === "rename" ? d.cat.id : null;
    const err = checkCategoryName(name(), cats.data() ?? [], selfId);
    if (err) {
      setNameError(err);
      focusName();
      return;
    }
    const v = name().trim();
    if (d.kind === "rename" && v === d.cat.name) {
      setDialog(null);
      return;
    }
    setBusy(true);
    try {
      if (d.kind === "create") {
        await api.post<Category>("/api/categories", { name: v });
        toast({ type: "success", title: "Category created", text: `‘${v}’ is ready to use in products.` });
      } else {
        await api.patch<Category>(`/api/categories/${d.cat.id}`, { name: v });
        toast({ type: "success", title: "Category renamed", text: `‘${d.cat.name}’ is now ‘${v}’.` });
      }
      setBusy(false);
      setDialog(null);
      void cats.reload();
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && (e.fieldErrors().name || e.code === "duplicate_name")) {
        setNameError(e.fieldErrors().name ?? e.message);
        focusName();
      } else {
        toast({
          type: "error",
          title: d.kind === "create" ? "Couldn’t create the category" : "Couldn’t rename the category",
          text: e instanceof ApiError ? e.message : undefined,
        });
      }
    }
  };

  const doDelete = async () => {
    const d = dialog();
    if (!d || d.kind !== "delete" || busy()) return;
    setBusy(true);
    try {
      await api.delete(`/api/categories/${d.cat.id}`);
      setBusy(false);
      setDialog(null);
      toast({ type: "success", title: "Category deleted", text: `‘${d.cat.name}’ was deleted.` });
      await cats.reload();
      newBtn?.focus();
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.code === "category_in_use") {
        const count = Number(e.raw.product_count) || 1;
        open({ kind: "blocked", cat: d.cat, count, archived: 0 });
        void cats.reload();
      } else {
        toast({ type: "error", title: "Couldn’t delete the category", text: e instanceof ApiError ? e.message : undefined });
      }
    }
  };

  const nameForm = (): JSX.Element => (
    <form
      id="cat-form"
      novalidate
      onSubmit={(e) => {
        e.preventDefault();
        void saveName();
      }}
    >
      <div class={`field${nameError() ? " is-invalid" : ""}`}>
        <label for="cat-name">Name</label>
        <input
          class="input"
          id="cat-name"
          type="text"
          maxlength="60"
          autocomplete="off"
          value={name()}
          aria-describedby="cat-name-hint cat-name-error"
          aria-invalid={nameError() ? "true" : undefined}
          onInput={(e) => {
            setName(e.currentTarget.value);
            const d = dialog();
            const selfId = d?.kind === "rename" ? d.cat.id : null;
            if (nameError() && !checkCategoryName(e.currentTarget.value, cats.data() ?? [], selfId)) setNameError("");
          }}
          onBlur={(e) => {
            const d = dialog();
            if (!d || (d.kind !== "create" && d.kind !== "rename")) return;
            if (e.currentTarget.value.trim())
              setNameError(checkCategoryName(e.currentTarget.value, cats.data() ?? [], d.kind === "rename" ? d.cat.id : null));
          }}
          ref={(el) => {
            if (dialog()?.kind === "rename") queueMicrotask(() => el.select());
          }}
        />
        <p class="hint" id="cat-name-hint">
          Up to 60 characters. Names must be unique.
        </p>
        <p class="error-text" id="cat-name-error" hidden={!nameError()}>
          <Show when={nameError()}>
            <Icon name="alert-circle" size={16} />
            <span>{nameError()}</span>
          </Show>
        </p>
      </div>
    </form>
  );

  const modalTitle = () => {
    const d = shownDialog();
    if (!d) return "";
    switch (d.kind) {
      case "create":
        return "New category";
      case "rename":
        return "Rename category";
      case "delete":
        return `Delete category ‘${d.cat.name}’?`;
      case "blocked":
        return `Can’t delete ‘${d.cat.name}’`;
    }
  };

  const modalFooter = (): JSX.Element => {
    const d = shownDialog();
    if (!d) return undefined;
    if (d.kind === "blocked")
      return (
        <>
          <button type="button" class="btn btn-secondary" data-im-cancel onClick={close}>
            Close
          </button>
          <a
            class="btn btn-primary"
            href={`/products?category_id=${d.cat.id}&status=all`}
            onClick={() => setDialog(null)}
          >
            <Icon name="box" size={18} />
            <span>View products</span>
          </a>
        </>
      );
    const danger = d.kind === "delete";
    return (
      <>
        <button type="button" class="btn btn-secondary" data-im-cancel onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          class={`btn ${danger ? "btn-danger" : "btn-primary"}${busy() ? " is-loading" : ""}`}
          data-im-confirm
          disabled={busy()}
          aria-busy={busy() ? "true" : undefined}
          onClick={() => void (danger ? doDelete() : saveName())}
        >
          {d.kind === "create" ? "Create category" : d.kind === "rename" ? "Save name" : "Delete category"}
        </button>
      </>
    );
  };

  return (
    <AppShell active="categories" title="Categories">
      <div class="page-header">
        <div>
          <h1>Categories</h1>
          <p class="page-subtitle">Group products to filter the catalogue and reports. One level, no subcategories.</p>
        </div>
        <div class="page-actions">
          <button ref={newBtn} type="button" class="btn btn-primary" onClick={() => open({ kind: "create" })}>
            <Icon name="plus" size={18} />
            <span>New category</span>
          </button>
        </div>
      </div>
      <div class="cat-wrap">
        <LoadView
          loader={cats}
          skeleton={
            <div class="card">
              <div class="card-body">
                <SkeletonRows rows={6} cols={3} />
              </div>
            </div>
          }
          isEmpty={(d) => d.length === 0}
          empty={
            <div class="card">
              <div class="card-body">
                <EmptyState
                  icon="tag"
                  title="No categories yet"
                  text="Categories help you filter products and reports, for example “Fasteners” or “Paint & Coatings”. They’re optional."
                  actions={
                    <button type="button" class="btn btn-primary" onClick={() => open({ kind: "create" })}>
                      <Icon name="plus" size={18} />
                      <span>New category</span>
                    </button>
                  }
                />
              </div>
            </div>
          }
        >
          {() => (
            <>
              <div class="result-line">
                <span role="status" aria-live="polite">
                  <strong class="fw-semibold" style={{ color: "var(--text)" }}>
                    {list().length}
                  </strong>{" "}
                  {plural(list().length, "category", "categories")}
                </span>
                <span class="usage-note">
                  <Icon name="info" size={16} />A category can be deleted only when no products use it.
                </span>
              </div>
              <div class="table-wrap">
                <table class="table table-cards">
                  <caption class="visually-hidden">Categories with product counts</caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col" class="num">
                        Products
                      </th>
                      <th scope="col" class="td-actions">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={list()}>
                      {(c) => {
                        const archived = c.product_count - c.active_product_count;
                        return (
                          <tr>
                            <td class="td-primary" data-label="Name">
                              <span class="cell-title">{c.name}</span>
                            </td>
                            <td class="num" data-label="Products">
                              <Show when={c.product_count > 0} fallback={<span class="muted">Not used</span>}>
                                <a
                                  class="link"
                                  href={`/products?category_id=${c.id}${c.active_product_count ? "" : "&status=archived"}`}
                                >
                                  {c.active_product_count} {plural(c.active_product_count, "product")}
                                </a>
                                <Show when={archived > 0}>
                                  <span class="cell-sub">+ {archived} archived</span>
                                </Show>
                              </Show>
                            </td>
                            <td class="td-actions">
                              <span class="row-actions">
                                <button
                                  type="button"
                                  class="btn btn-secondary btn-sm"
                                  aria-label={`Rename ${c.name}`}
                                  onClick={() => open({ kind: "rename", cat: c })}
                                >
                                  <Icon name="pencil" size={16} />
                                  <span>Rename</span>
                                </button>
                                <button
                                  type="button"
                                  class="btn btn-secondary btn-sm btn-row-delete"
                                  aria-label={`Delete ${c.name}${c.product_count ? " (in use)" : ""}`}
                                  onClick={() => openDelete(c)}
                                >
                                  <Icon name="trash" size={16} />
                                  <span>Delete</span>
                                </button>
                              </span>
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </LoadView>
      </div>

      <Modal
        open={!!dialog()}
        onClose={close}
        onClosed={() => setShownDialog(null)}
        title={modalTitle()}
        size="sm"
        initialFocus={
          shownDialog()?.kind === "create" || shownDialog()?.kind === "rename" ? "#cat-name"
            : shownDialog()?.kind === "delete"
              ? "[data-im-cancel]"
              : undefined
        }
        footer={modalFooter()}
      >
        <Switch>
          <Match when={shownDialog()?.kind === "create"}>{nameForm()}</Match>
          <Match when={shownDialog()?.kind === "rename" && (shownDialog() as Extract<Dialog, { kind: "rename" }>)}>
            {(d) => (
              <>
                {nameForm()}
                <p class="text-sm muted">
                  {d().cat.product_count
                    ? `The new name will show on all ${d().cat.product_count} products in this category.`
                    : "No products use this category yet."}
                </p>
              </>
            )}
          </Match>
          <Match when={shownDialog()?.kind === "delete"}>
            <p>This can’t be undone. No products use this category.</p>
          </Match>
          <Match when={shownDialog()?.kind === "blocked" && (shownDialog() as Extract<Dialog, { kind: "blocked" }>)}>
            {(d) => (
              <>
                <p>{blockedText(d().count, d().archived)}</p>
                <p class="text-sm muted">
                  Archived products keep their category, so a category used only by archived products can’t be deleted
                  either.
                </p>
              </>
            )}
          </Match>
        </Switch>
      </Modal>
    </AppShell>
  );
}
