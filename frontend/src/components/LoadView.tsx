/**
 * Renders a Loader's state: loading → skeleton, error → ErrorState (retry), empty → EmptyState,
 * otherwise children(data).
 *
 *   <LoadView loader={products} skeleton={<SkeletonRows cols={6} />}
 *             isEmpty={(d) => d.items.length === 0}
 *             empty={<EmptyState icon="box" title="No products yet" … />}>
 *     {(d) => <ProductsTable items={d().items} />}
 *   </LoadView>
 */
import { Match, Switch, type Accessor, type JSX } from "solid-js";
import { ApiError } from "../api/client";
import type { Loader } from "../lib/resource";
import { ErrorState } from "./ErrorState";
import { SkeletonRows } from "./SkeletonRows";

export interface LoadViewProps<T> {
  loader: Loader<T>;
  children: (data: Accessor<T>) => JSX.Element;
  /** Default: <SkeletonRows />. */
  skeleton?: JSX.Element;
  isEmpty?: (data: T) => boolean;
  empty?: JSX.Element;
  /** Show the skeleton again while reloading (e.g. filter change). Default false: keep content. */
  skeletonOnRefresh?: boolean;
  errorTitle?: string;
  compactError?: boolean;
  /** Custom error rendering. */
  error?: (err: ApiError | Error, retry: () => void) => JSX.Element;
}

/** User-facing text for a load error (network → default text, API → its message). */
export function errorText(err: ApiError | Error | undefined): string | undefined {
  if (!err) return undefined;
  if (err instanceof ApiError) return err.isNetworkError || err.status >= 500 || err.status === 0 ? undefined : err.message;
  return undefined;
}

export function LoadView<T>(props: LoadViewProps<T>): JSX.Element {
  const l = () => props.loader;
  const retry = () => void l().reload();
  const showSkeleton = () => l().state() === "loading" || (props.skeletonOnRefresh && l().state() === "refreshing");
  return (
    <Switch>
      <Match when={l().state() === "error" && l().error()}>
        {(err) =>
          props.error ? (
            props.error(err(), retry)
          ) : (
            <ErrorState title={props.errorTitle} text={errorText(err())} onRetry={retry} compact={props.compactError} />
          )
        }
      </Match>
      <Match when={showSkeleton()}>{props.skeleton ?? <SkeletonRows />}</Match>
      <Match when={props.isEmpty && l().data() !== undefined && props.isEmpty(l().data() as T)}>{props.empty}</Match>
      <Match when={l().data() !== undefined}>{props.children(() => l().data() as T)}</Match>
    </Switch>
  );
}
