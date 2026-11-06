/**
 * Page data loading with explicit states (pair with <LoadView> from components/LoadView.tsx).
 *
 *   const products = createLoader((signal) => api.get<ProductList>(`/api/products${qs(filters())}`, signal));
 *
 * The fetcher is tracked: signals read synchronously inside it (e.g. filters()) trigger a reload
 * when they change; the previous request is aborted.
 *
 *   state():  "loading"     first load (no data yet)        → skeleton
 *             "refreshing"  reload while data is shown      → keep data (optionally dim)
 *             "ready"       data available                  → content / empty state
 *             "error"       last load failed                → ErrorState with retry
 */
import { batch, createEffect, createSignal, onCleanup } from "solid-js";
import { ApiError } from "../api/client";

export type LoadState = "loading" | "refreshing" | "ready" | "error";

export interface Loader<T> {
  state: () => LoadState;
  data: () => T | undefined;
  error: () => ApiError | Error | undefined;
  /** true while any request is in flight. */
  loading: () => boolean;
  /** Re-run the fetcher. `reset` drops current data (→ "loading" skeleton). */
  reload: (opts?: { reset?: boolean }) => Promise<void>;
  /** Replace data locally (e.g. after a successful mutation). */
  mutate: (value: T | ((prev: T | undefined) => T)) => void;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function createLoader<T>(fetcher: (signal: AbortSignal) => Promise<T>): Loader<T> {
  const [data, setData] = createSignal<T | undefined>(undefined);
  const [error, setError] = createSignal<ApiError | Error | undefined>(undefined);
  const [loading, setLoading] = createSignal(true);
  const [trigger, setTrigger] = createSignal(0);
  let controller: AbortController | null = null;
  let resolveWaiters: (() => void)[] = [];

  const settleWaiters = () => {
    const w = resolveWaiters;
    resolveWaiters = [];
    w.forEach((f) => f());
  };

  createEffect(() => {
    trigger();
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    setLoading(true);
    setError(undefined);
    let p: Promise<T>;
    try {
      p = fetcher(ctl.signal); // tracked: signals read synchronously here schedule a reload
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(
      (value) => {
        if (ctl !== controller) return;
        batch(() => {
          setData(() => value);
          setLoading(false);
        });
        settleWaiters();
      },
      (err: unknown) => {
        if (ctl !== controller || isAbort(err)) return;
        batch(() => {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        });
        settleWaiters();
      },
    );
  });
  onCleanup(() => controller?.abort());

  return {
    state: () => (error() ? "error" : data() === undefined ? "loading" : loading() ? "refreshing" : "ready"),
    data,
    error,
    loading,
    reload: (opts) =>
      new Promise<void>((resolve) => {
        resolveWaiters.push(resolve);
        if (opts?.reset) setData(undefined);
        setTrigger((n) => n + 1);
      }),
    mutate: (value) => setData((prev) => (typeof value === "function" ? (value as (p: T | undefined) => T)(prev) : value)),
  };
}
