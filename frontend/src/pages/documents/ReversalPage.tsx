/**
 * Reversal document (/reversals/:id; screens/receipt.html?state=reversal, write-off.html?state=reversal).
 * Shown in the section of the original (receipts or write-offs) with a link back to it.
 */
import { Match, Switch, createMemo, type JSX } from "solid-js";
import { useParams } from "@solidjs/router";
import { ApiError, api } from "../../api/client";
import { AppShell } from "../../components/AppShell";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { SkeletonRows } from "../../components/SkeletonRows";
import { errorText } from "../../components/LoadView";
import { createLoader } from "../../lib/resource";
import { DocView } from "./DocView";
import { RECEIPT, configForKind, type Doc } from "./docs";
import "./DocPage.css";

export default function ReversalPage(): JSX.Element {
  const params = useParams();
  const doc = createLoader((signal) => api.get<Doc>(`/api/reversals/${params.id}`, signal));
  const cfg = createMemo(() => (doc.data() ? configForKind(doc.data()!.kind) : RECEIPT));
  const notFound = () => doc.error() instanceof ApiError && (doc.error() as ApiError).status === 404;
  const keyed = createMemo(() => (doc.state() === "loading" ? null : doc.data() ?? null));

  return (
    <AppShell active={doc.data() ? cfg().nav : null} title={doc.data() ? cfg().section : "Reversal"}>
      <Switch>
        <Match when={doc.state() === "error"}>
          <div class="card">
            <div class="card-body">
              <ErrorState
                title={notFound() ? "Reversal not found" : "Couldn’t load the reversal"}
                text={notFound() ? "This reversal document doesn’t exist." : errorText(doc.error())}
                onRetry={notFound() ? undefined : () => void doc.reload()}
                actions={
                  notFound() ? (
                    <a class="btn btn-secondary" href="/history">
                      <Icon name="arrow-left" size={18} />
                      <span>Go to history</span>
                    </a>
                  ) : undefined
                }
              />
            </div>
          </div>
        </Match>
        <Match when={keyed()} keyed>
          {(d) => <DocView doc={d} onReload={() => void doc.reload({ reset: true })} />}
        </Match>
        <Match when={true}>
          <div class="card">
            <div class="card-body">
              <SkeletonRows rows={5} cols={5} />
            </div>
          </div>
        </Match>
      </Switch>
    </AppShell>
  );
}
