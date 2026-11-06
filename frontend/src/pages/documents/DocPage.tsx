/**
 * Receipt / write-off page (/receipts/new, /receipts/:id, /write-offs/new, /write-offs/:id):
 * new or draft → DocEditor; posted / reversed → DocView. Reversal ids found here redirect to /reversals/:id.
 */
import { Match, Show, Switch, createMemo, type JSX } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { ApiError, api } from "../../api/client";
import { AppShell } from "../../components/AppShell";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { SkeletonRows } from "../../components/SkeletonRows";
import { errorText } from "../../components/LoadView";
import { createLoader } from "../../lib/resource";
import { DocEditor, type Handoff } from "./DocEditor";
import { DocView } from "./DocView";
import { isReversal, type Doc, type DocConfig, type DocList, type ProductList, type ProductRef } from "./docs";
import "./DocPage.css";

/** Data passed to the next page instance after creating a draft (avoids a refetch, keeps errors). */
let handoff: Handoff | null = null;

interface PageData {
  doc: Doc | null;
  products: ProductRef[];
  suppliers: string[];
  handoff?: Handoff;
}

async function loadEditorData(cfg: DocConfig, signal: AbortSignal): Promise<Pick<PageData, "products" | "suppliers">> {
  const [products, receipts] = await Promise.all([
    api.get<ProductList>("/api/products?status=active", signal),
    cfg.type === "receipt" ? api.get<DocList>("/api/receipts", signal).catch(() => ({ items: [] }) as DocList) : null,
  ]);
  const suppliers = receipts
    ? [...new Set(receipts.items.map((d) => (d.supplier ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    : [];
  return { products: products.items, suppliers };
}

export function DocPage(props: { cfg: DocConfig }): JSX.Element {
  const cfg = props.cfg;
  const params = useParams();
  const navigate = useNavigate();
  const id = () => (params.id && params.id !== "new" ? params.id : null);

  const page = createLoader<PageData>(async (signal) => {
    const docId = id();
    if (docId == null) return { doc: null, ...(await loadEditorData(cfg, signal)) };
    const h = handoff && String(handoff.id) === docId ? handoff : null;
    handoff = null;
    const doc = h ? h.doc : await api.get<Doc>(`${cfg.api}/${docId}`, signal);
    if (isReversal(doc.kind)) {
      navigate(`/reversals/${doc.id}`, { replace: true });
      return { doc, products: [], suppliers: [] };
    }
    if (doc.status !== "draft") return { doc, products: [], suppliers: [] };
    return { doc, ...(await loadEditorData(cfg, signal)), handoff: h ?? undefined };
  });

  const goTo = (h: Handoff) => {
    handoff = h;
    navigate(`${cfg.listPath}/${h.id}`, { replace: true });
  };

  /** Re-create the editor / view when the document identity or status changes. */
  const viewKey = createMemo(() => {
    const d = page.data();
    if (!d || page.state() === "loading") return null;
    return d;
  });

  const notFound = () => page.error() instanceof ApiError && (page.error() as ApiError).status === 404;

  return (
    <AppShell active={cfg.nav} title={cfg.section}>
      <Switch>
        <Match when={page.state() === "error"}>
          <a class="link-subtle back-link" href={cfg.listPath}>
            <Icon name="arrow-left" size={18} />
            <span>Back to {cfg.nouns}</span>
          </a>
          <div class="card">
            <div class="card-body">
              <Show
                when={notFound()}
                fallback={
                  <ErrorState
                    title={`Couldn’t load the ${cfg.noun}`}
                    text={errorText(page.error())}
                    onRetry={() => void page.reload()}
                  />
                }
              >
                <ErrorState
                  title={`${cfg.Noun} not found`}
                  text={`This ${cfg.noun} doesn’t exist or was deleted.`}
                  actions={
                    <a class="btn btn-secondary" href={cfg.listPath}>
                      <Icon name="arrow-left" size={18} />
                      <span>Back to {cfg.nouns}</span>
                    </a>
                  }
                />
              </Show>
            </div>
          </div>
        </Match>
        <Match when={!viewKey()}>
          <a class="link-subtle back-link" href={cfg.listPath}>
            <Icon name="arrow-left" size={18} />
            <span>Back to {cfg.nouns}</span>
          </a>
          <div class="page-header">
            <div>
              <h1>
                <span class="skeleton is-wide" style={{ display: "inline-block", width: "220px" }} aria-hidden="true" />
              </h1>
            </div>
          </div>
          <div class="card">
            <div class="card-body">
              <SkeletonRows rows={5} cols={5} />
            </div>
          </div>
        </Match>
        <Match when={viewKey()} keyed>
          {(d) =>
            d.doc == null || d.doc.status === "draft" ? (
              <DocEditor
                cfg={cfg}
                doc={d.doc}
                products={d.products}
                suppliers={d.suppliers}
                initialError={d.handoff?.error}
                initialAction={d.handoff?.action}
                onCreated={goTo}
                onPosted={(doc, wasNew) => (wasNew ? goTo({ id: doc.id, doc }) : page.mutate({ ...d, doc }))}
                onReload={() => void page.reload({ reset: true })}
              />
            ) : (
              <DocView doc={d.doc} onReload={() => void page.reload({ reset: true })} />
            )
          }
        </Match>
      </Switch>
    </AppShell>
  );
}
