/**
 * Read-only document view (screens/receipt.html + write-off.html, states posted / reversed / reversal)
 * with the Reverse flow: confirm (effect list) → POST …/reverse → reversal document; a reversal that would
 * make stock negative is refused (client pre-check on current stock + server 409 insufficient_stock).
 */
import { For, Show, createSignal, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { ApiError, api } from "../../api/client";
import { StatusBadge } from "../../components/Badge";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { toast } from "../../components/Toast";
import { fmtDateTime, fmtMoney, fmtQty, fmtSignedQty } from "../../lib/format";
import { DocAlert, DocHeader, MetaItem, useDocTitle } from "./DocParts";
import {
  configForKind,
  isReversal,
  pl,
  r3,
  type Doc,
  type DocLine,
  type Shortage,
} from "./docs";

interface Short {
  name: string;
  sku: string;
  unit: string;
  need: number;
  stock: number;
  short: number;
}

/** Receipt lines that can't be removed from current stock (summed per product). */
export function reversalShortfalls(lines: DocLine[]): Short[] {
  const need = new Map<number, { line: DocLine; qty: number }>();
  for (const l of lines) {
    if (!l.product || l.qty == null) continue;
    const cur = need.get(l.product.id);
    need.set(l.product.id, { line: cur?.line ?? l, qty: r3((cur?.qty ?? 0) + l.qty) });
  }
  const out: Short[] = [];
  for (const { line, qty } of need.values()) {
    const p = line.product!;
    const short = r3(qty - p.stock);
    if (short > 0) out.push({ name: p.name, sku: p.sku, unit: p.unit, need: qty, stock: p.stock, short });
  }
  return out;
}

function shortsFromApi(list: Shortage[]): Short[] {
  return list.map((s) => ({
    name: s.name,
    sku: s.sku,
    unit: s.unit,
    need: s.required,
    stock: s.available,
    short: r3(s.required - s.available),
  }));
}

export function DocView(props: { doc: Doc; onReload: () => void }): JSX.Element {
  const navigate = useNavigate();
  const d = () => props.doc;
  const cfg = configForKind(props.doc.kind);
  const isWO = cfg.type === "write_off";
  const isRev = () => isReversal(d().kind);
  const sign = () => (isRev() ? -1 : 1);
  const lines = () => d().lines ?? [];
  const original = () => d().reverses;
  const originalHref = () => (original() ? `${cfg.listPath}/${original()!.id}` : cfg.listPath);
  const reversalHref = () => (d().reversal ? `/reversals/${d().reversal!.id}` : "#");

  useDocTitle(() => `${isRev() ? "Reversal" : cfg.Noun} ${d().number}`);

  const [dialog, setDialog] = createSignal<null | "reverse" | "refused">(null);
  const [busy, setBusy] = createSignal(false);
  const [shorts, setShorts] = createSignal<Short[]>([]);

  const openReverse = () => {
    if (!isWO) {
      const s = reversalShortfalls(lines());
      if (s.length) {
        setShorts(s);
        setDialog("refused");
        return;
      }
    }
    setDialog("reverse");
  };

  const doReverse = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const rv = await api.post<Doc>(`${cfg.api}/${d().id}/reverse`, {});
      setDialog(null);
      toast({
        type: "success",
        title: `${cfg.Noun} ${d().number} reversed`,
        text: `Reversal ${rv.number} was created and posted.`,
      });
      navigate(`/reversals/${rv.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "insufficient_stock" && Array.isArray(err.raw.shortages)) {
        // Keep this view mounted (a reload would close the dialog); the server's numbers are shown.
        setShorts(shortsFromApi(err.raw.shortages as Shortage[]));
        setDialog("refused");
      } else if (err instanceof ApiError && (err.code === "already_reversed" || err.code === "document_not_draft")) {
        setDialog(null);
        toast({ type: "error", title: err.message });
        props.onReload();
      } else {
        toast({ type: "error", title: err instanceof Error ? err.message : "Something went wrong." });
      }
    } finally {
      setBusy(false);
    }
  };

  const title = () => (
    <>
      {isRev() ? "Reversal" : cfg.Noun} <span class="mono">{d().number}</span>
    </>
  );

  const subtitle = (): JSX.Element => {
    if (isRev())
      return (
        <>
          Reverses{" "}
          <a class="link" href={originalHref()}>
            {original()?.number}
          </a>{" "}
          · Posted {fmtDateTime(d().posted_at)}
        </>
      );
    if (d().status === "reversed" && d().reversal)
      return (
        <>
          Reversed by{" "}
          <a class="link" href={reversalHref()}>
            {d().reversal!.number}
          </a>{" "}
          on {fmtDateTime(d().reversal!.posted_at)}
        </>
      );
    return `Posted ${fmtDateTime(d().posted_at)}`;
  };

  const alert = (): JSX.Element => {
    if (isRev())
      return (
        <DocAlert kind="info" icon="rotate-ccw" title="Reversal document">
          <p>
            This document cancels {cfg.noun}{" "}
            <a class="link" href={originalHref()}>
              {original()?.number}
            </a>
            .{" "}
            {isWO
              ? "Its quantities are negated, so the written-off goods were returned to stock. Reversals can’t be edited or reversed."
              : "Its quantities are negated, so the received goods were removed from stock. Reversals can’t be edited or reversed."}
          </p>
        </DocAlert>
      );
    if (d().status === "reversed" && d().reversal)
      return (
        <DocAlert kind="warning" icon="rotate-ccw" title={`This ${cfg.noun} was reversed`}>
          <p>
            Its stock effect was cancelled by reversal{" "}
            <a class="link" href={reversalHref()}>
              {d().reversal!.number}
            </a>{" "}
            on {fmtDateTime(d().reversal!.posted_at)}
            {isWO
              ? ` — the goods were returned to stock. The ${cfg.noun} stays in history for reference.`
              : `. The ${cfg.noun} stays in history for reference.`}
          </p>
        </DocAlert>
      );
    return (
      <DocAlert kind="info" icon="lock">
        <p>
          Posted {cfg.nouns} can’t be edited. To correct a mistake, reverse this {cfg.noun} and enter a new one.
        </p>
      </DocAlert>
    );
  };

  const canReverse = () => !isRev() && d().status === "posted";
  const priceOf = (l: DocLine) => (isWO ? l.unit_cost : l.price);

  return (
    <>
      <DocHeader
        backHref={cfg.listPath}
        backLabel={`Back to ${cfg.nouns}`}
        title={title()}
        badge={<StatusBadge doc={d()} />}
        subtitle={subtitle()}
        actions={
          canReverse() ? (
            <button type="button" class="btn btn-secondary" data-act="reverse" onClick={openReverse}>
              <Icon name="rotate-ccw" size={18} />
              <span>Reverse</span>
            </button>
          ) : undefined
        }
      />
      {alert()}
      <div class="stack-lg">
        <section class="card" aria-labelledby="sec-details">
          <div class="card-header">
            <h2 class="card-title" id="sec-details">
              Details
            </h2>
          </div>
          <div class="card-body">
            <dl class="meta-list">
              <MetaItem label="Number">
                <span class="mono">{d().number}</span>
              </MetaItem>
              <MetaItem label="Posted">{fmtDateTime(d().posted_at)}</MetaItem>
              <Show when={isRev()}>
                <MetaItem label="Reverses">
                  <a class="link" href={originalHref()}>
                    {original()?.number}
                  </a>
                </MetaItem>
              </Show>
              <Show when={isWO} fallback={<MetaItem label="Supplier">{d().supplier || "—"}</MetaItem>}>
                <MetaItem label="Reason">{d().reason || "—"}</MetaItem>
              </Show>
              <MetaItem label="Lines">{String(lines().length)}</MetaItem>
              <MetaItem label={isWO ? "Total value" : "Total"}>{fmtMoney(sign() * d().total)}</MetaItem>
              <Show when={!isRev() && d().status === "reversed" && d().reversal}>
                <MetaItem label="Reversed by">
                  <a class="link" href={reversalHref()}>
                    {d().reversal!.number}
                  </a>{" "}
                  on {fmtDateTime(d().reversal!.posted_at)}
                </MetaItem>
              </Show>
              <Show when={d().note}>
                <MetaItem label="Note">{d().note}</MetaItem>
              </Show>
            </dl>
          </div>
        </section>
        <section class="card" aria-labelledby="sec-lines">
          <div class="card-header">
            <h2 class="card-title" id="sec-lines">
              Lines
            </h2>
            <Show when={isWO || isRev()}>
              <span class="card-subtitle">
                {isWO
                  ? `${isRev() ? "Quantities are negated · " : ""}Valued at average cost at posting`
                  : "Quantities are negated"}
              </span>
            </Show>
          </div>
          <div class="table-wrap">
            <table class="table table-cards">
              <caption class="visually-hidden">
                {isRev() ? "Reversal" : cfg.Noun} lines
              </caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Product</th>
                  <th scope="col" class="num">
                    Quantity
                  </th>
                  <th scope="col" class="num">
                    {isWO ? "Avg cost" : "Unit price"}
                  </th>
                  <th scope="col" class="num">
                    {isWO ? "Value" : "Line total"}
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={lines()}>
                  {(l, i) => (
                    <tr>
                      <td data-label="Line" class="tabular">
                        {i() + 1}
                      </td>
                      <td class="td-primary" data-label="Product">
                        <Show when={l.product} fallback={<span class="muted">—</span>}>
                          {(p) => (
                            <>
                              <a class="cell-link" href={`/products/${p().id}`}>
                                {p().name}
                              </a>
                              <span class="cell-sub mono">{p().sku}</span>
                            </>
                          )}
                        </Show>
                      </td>
                      <td class="num" data-label="Quantity">
                        {isRev() ? fmtSignedQty(-(l.qty ?? 0), l.product?.unit) : fmtQty(l.qty, l.product?.unit)}
                      </td>
                      <td class="num" data-label={isWO ? "Avg cost" : "Unit price"}>
                        {fmtMoney(priceOf(l))}
                      </td>
                      <td class="num" data-label={isWO ? "Value" : "Line total"}>
                        {fmtMoney(sign() * l.total)}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <div class="card-footer">
            <div class="totals">
              <div class="totals-row">
                <span>Lines</span>
                <span>{lines().length}</span>
              </div>
              <div class="totals-row is-grand">
                <span>{isWO ? "Total value" : "Total"}</span>
                <span>{fmtMoney(sign() * d().total)}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <Modal
        open={dialog() === "reverse"}
        onClose={() => !busy() && setDialog(null)}
        title={`Reverse ${cfg.noun} ${d().number}?`}
        confirmLabel={`Reverse ${cfg.noun}`}
        confirmVariant="danger"
        confirmBusy={busy()}
        onConfirm={() => void doReverse()}
      >
        <div class="stack">
          <p>
            A reversal document will be created and posted. It{" "}
            {isWO ? "returns these quantities to stock:" : "subtracts these quantities from stock:"}
          </p>
          <ul class="effect-list" aria-label="Stock changes">
            <For each={lines()}>
              {(l) => {
                const p = l.product!;
                const q = l.qty ?? 0;
                return (
                  <li>
                    <span>
                      {p?.name}
                      <span class="cell-sub">
                        In stock: {fmtQty(p?.stock, p?.unit)} → {fmtQty(r3((p?.stock ?? 0) + (isWO ? q : -q)), p?.unit)}
                      </span>
                    </span>
                    <span class="effect-qty">{fmtSignedQty(isWO ? q : -q, p?.unit)}</span>
                  </li>
                );
              }}
            </For>
          </ul>
          <p>
            The original {cfg.noun} stays in history, marked as <strong>Reversed</strong>. This can’t be undone.
          </p>
        </div>
      </Modal>

      <Modal
        open={dialog() === "refused"}
        onClose={() => setDialog(null)}
        title={`Can’t reverse ${d().number}`}
        size="lg"
        initialFocus="[data-im-ok]"
        footer={
          <>
            <a class="btn btn-secondary" href="/stock-counts" onClick={() => setDialog(null)}>
              Go to stock counts
            </a>
            <button type="button" class="btn btn-primary" data-im-ok onClick={() => setDialog(null)}>
              OK
            </button>
          </>
        }
      >
        <div class="stack">
          <DocAlert kind="danger" icon="alert-triangle" title="Stock would go below zero" doc={false}>
            <p>
              Some of the goods from this {cfg.noun} have already been written off or sold. Reversing it would leave{" "}
              {pl(shorts().length, "product")} with negative stock, which isn’t allowed.
            </p>
          </DocAlert>
          <div class="table-wrap">
            <table class="table table-cards table-compact">
              <caption class="visually-hidden">Products that would go below zero</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col" class="num">
                    Reversal
                  </th>
                  <th scope="col" class="num">
                    In stock
                  </th>
                  <th scope="col" class="num">
                    Shortfall
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={shorts()}>
                  {(x) => (
                    <tr>
                      <td class="td-primary" data-label="Product">
                        <span class="cell-title">{x.name}</span>
                        <span class="cell-sub mono">{x.sku}</span>
                      </td>
                      <td class="num" data-label="Reversal">
                        {fmtSignedQty(-x.need, x.unit)}
                      </td>
                      <td class="num" data-label="In stock">
                        {fmtQty(x.stock, x.unit)}
                      </td>
                      <td class="num" data-label="Shortfall">
                        <strong>{fmtQty(x.short, x.unit)}</strong>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <p class="hint">
            The {cfg.noun} stays posted. To fix wrong quantities, record the actual stock with a stock count instead.
          </p>
        </div>
      </Modal>
    </>
  );
}
