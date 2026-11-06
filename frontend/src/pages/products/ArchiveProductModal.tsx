/**
 * "Archive product?" confirmation (screens/product.html + products.html archive dialogs).
 * Shows the stock warning when the product still has stock (stock ≠ 0). Calls the API itself.
 */
import { Show, createSignal, type JSX } from "solid-js";
import { api, ApiError } from "../../api/client";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { toast } from "../../components/Toast";
import { fmtMoney, fmtQty } from "../../lib/format";
import type { Product } from "./types";

export interface ArchiveProductModalProps {
  product: Product | null;
  onClose: () => void;
  onArchived: (p: Product) => void;
  /** "details": title "Archive product?" + name line + write-off link (product page); "list": short variant. */
  variant?: "details" | "list";
}

export async function archiveProduct(p: Product): Promise<Product> {
  const updated = await api.post<Product>(`/api/products/${p.id}/archive`);
  toast({ type: "success", title: "Product archived", text: `${updated.name} is hidden from new documents.` });
  return updated;
}

export async function restoreProduct(p: Product): Promise<Product> {
  const updated = await api.post<Product>(`/api/products/${p.id}/restore`);
  toast({ type: "success", title: "Product restored", text: `${updated.name} is available in new documents again.` });
  return updated;
}

export function ArchiveProductModal(props: ArchiveProductModalProps): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const details = () => props.variant !== "list";
  // Keep the last product while the dialog animates out.
  let last: Product | null = null;
  const p = () => (props.product ? (last = props.product) : last);

  const confirm = async () => {
    const cur = props.product;
    if (!cur || busy()) return;
    setBusy(true);
    try {
      const updated = await archiveProduct(cur);
      setBusy(false);
      props.onArchived(updated);
    } catch (err) {
      setBusy(false);
      toast({ type: "error", title: err instanceof ApiError ? err.message : "Couldn’t archive the product." });
    }
  };

  return (
    <Modal
      open={!!props.product}
      onClose={() => !busy() && props.onClose()}
      title={details() ? "Archive product?" : `Archive “${p()?.name ?? ""}”?`}
      size="sm"
      confirmLabel="Archive product"
      confirmVariant="primary"
      confirmBusy={busy()}
      onConfirm={confirm}
    >
      <Show when={p()}>
        {(prod) => (
          <>
            <Show when={details()}>
              <p>
                <strong>{prod().name}</strong> <span class="mono muted">{prod().sku}</span>
              </p>
            </Show>
            <p>
              Archived products are hidden from new receipts, write-offs and stock counts. They stay in history and
              reports, and you can restore them at any time.
            </p>
            <Show when={prod().stock !== 0}>
              <div class="alert alert-warning" role="note">
                <span class="alert-icon">
                  <Icon name="alert-triangle" />
                </span>
                <div class="alert-content">
                  <p class="alert-body">
                    This product still has <strong>{fmtQty(prod().stock, prod().unit)}</strong> in stock (
                    {fmtMoney(prod().stock_value)}). Archiving won’t change stock; consider writing it off first.
                  </p>
                  <Show when={details()}>
                    <div class="alert-actions">
                      <a class="btn btn-secondary btn-sm" href="/write-offs/new" onClick={() => props.onClose()}>
                        <Icon name="arrow-up-from-line" size={16} />
                        <span>Create write-off</span>
                      </a>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>
          </>
        )}
      </Show>
    </Modal>
  );
}
