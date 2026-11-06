/**
 * List filters stored in the URL query string (reload / back keep the filters).
 *
 *   const [filters, setFilters, resetFilters] = useListFilters(
 *     { search: "", status: "active", category_id: "", low_stock: false, sort: "name", order: "asc" },
 *     { enums: { status: ["active", "archived", "all"], order: ["asc", "desc"] } },
 *   );
 *   filters().status                     // typed, defaults applied, invalid values → default
 *   setFilters({ status: "archived" })   // replaces history entry; default values are removed from the URL
 *   api.get(`/api/products${qs(filters())}`)
 *
 * Value types follow the defaults: string, number or boolean ("1"/"true" → true).
 */
import { createMemo, type Accessor } from "solid-js";
import { useSearchParams } from "@solidjs/router";

export type FilterValue = string | number | boolean;
export type Filters = Record<string, FilterValue>;
export type RawQuery = Record<string, string | string[] | undefined>;

export interface FilterOptions<T extends Filters> {
  /** Allowed values per string key; anything else falls back to the default. */
  enums?: { [K in keyof T]?: readonly string[] };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse query values into typed filters using `defaults` for types and fallbacks. */
export function parseFilters<T extends Filters>(query: RawQuery, defaults: T, opts: FilterOptions<T> = {}): T {
  const out = { ...defaults } as Record<string, FilterValue>;
  for (const key of Object.keys(defaults)) {
    const raw = first(query[key]);
    if (raw === undefined || raw === "") continue;
    const def = defaults[key];
    if (typeof def === "number") {
      const n = Number(raw);
      if (Number.isFinite(n)) out[key] = n;
    } else if (typeof def === "boolean") {
      out[key] = raw === "1" || raw === "true";
    } else {
      const allowed = opts.enums?.[key as keyof T];
      if (!allowed || allowed.includes(raw)) out[key] = raw;
    }
  }
  return out as T;
}

/** Query patch for setSearchParams: default / empty values → null (removed from the URL). */
export function filtersToQuery<T extends Filters>(values: Partial<T>, defaults: T): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, v] of Object.entries(values)) {
    if (v === undefined) continue;
    if (v === defaults[key] || v === "") out[key] = null;
    else if (typeof v === "boolean") out[key] = v ? "1" : "0";
    else out[key] = String(v);
  }
  return out;
}

export function useListFilters<T extends Filters>(
  defaults: T,
  opts: FilterOptions<T> = {},
): [Accessor<T>, (patch: Partial<T>, o?: { push?: boolean }) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const filters = createMemo(() => parseFilters(params as RawQuery, defaults, opts), undefined, {
    equals: (a, b) => Object.keys(defaults).every((k) => a[k] === b[k]),
  });
  const set = (patch: Partial<T>, o: { push?: boolean } = {}) =>
    setParams(filtersToQuery(patch, defaults), { replace: !o.push });
  const reset = () => set({ ...defaults });
  return [filters, set, reset];
}
