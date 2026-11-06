/**
 * Receipts / write-offs list (screens/receipts.html, screens/write-offs.html).
 * Receipts and their reversals (or write-offs and theirs) newest first; search, period (presets + custom
 * range), status and — for write-offs — reason filters, all kept in the URL.
 */
import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { api, qs } from "../../api/client";
import { AppShell } from "../../components/AppShell";
import { Badge } from "../../components/Badge";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { SkeletonRows } from "../../components/SkeletonRows";
import { errorText } from "../../components/LoadView";
import { createLoader } from "../../lib/resource";
import { useListFilters } from "../../lib/url";
import { fmtDate, fmtDateTime, fmtMoney, toIsoDate, WRITE_OFF_REASONS } from "../../lib/format";
import {
  PERIOD_LABEL,
  PERIOD_OPTIONS,
  STATUS_LABEL,
  STATUS_OPTIONS,
  docDate,
  docUrl,
  isReversal,
  periodRange,
  type Doc,
  type DocConfig,
  type DocList as DocListData,
} from "./docs";
import "./DocList.css";

const DEFAULTS = { search: "", period: "all", from: "", to: "", status: "all", reason: "all" };

interface ListData {
  items: Doc[];
  /** Number of documents without filters. */
  total: number;
}

export interface ListTexts {
  subtitle: string;
  searchLabel: string;
  searchPlaceholder: string;
  emptyIcon: "arrow-down-to-line" | "arrow-up-from-line";
  emptyTitle: string;
  emptyText: string;
  noResultsText: string;
}

export function DocListPage(props: { cfg: DocConfig; texts: ListTexts }): JSX.Element {
  const cfg = props.cfg;
  const isWO = cfg.type === "write_off";
  const navigate = useNavigate();
  const [filters, setFilters] = useListFilters(DEFAULTS, {
    enums: {
      period: PERIOD_OPTIONS.map((o) => o[0]),
      status: STATUS_OPTIONS.map((o) => o[0]),
      reason: ["all", ...WRITE_OFF_REASONS],
    },
  });
  const f = () => filters();
  const range = () => periodRange(f().period, f().from, f().to);
  const hasFilters = () =>
    !!f().search.trim() || f().period !== "all" || f().status !== "all" || (isWO && f().reason !== "all");

  const params = () => {
    const r = range();
    return {
      search: f().search.trim(),
      status: f().status === "all" ? "" : f().status,
      from: r.from,
      to: r.to,
      reason: isWO && f().reason !== "all" ? f().reason : "",
    };
  };

  const list = createLoader<ListData>(async (signal) => {
    const p = params();
    const filtered = hasFilters();
    const [res, all] = await Promise.all([
      api.get<DocListData>(`${cfg.api}${qs(p)}`, signal),
      filtered ? api.get<DocListData>(cfg.api, signal) : Promise.resolve(null),
    ]);
    return { items: res.items, total: all ? all.items.length : res.items.length };
  });

  /* search: local input value, debounced into the URL */
  const [q, setQ] = createSignal(f().search);
  let qTimer: ReturnType<typeof setTimeout> | undefined;
  const onSearch = (v: string) => {
    setQ(v);
    clearTimeout(qTimer);
    qTimer = setTimeout(() => setFilters({ search: v }), 250);
  };
  onCleanup(() => clearTimeout(qTimer));
  createEffect(on(() => f().search, (s) => { if (s.trim() !== q().trim()) setQ(s); }, { defer: true }));

  let qInput: HTMLInputElement | undefined;
  let fromInput: HTMLInputElement | undefined;

  const chips = (): { key: string; label: string }[] => {
    const out: { key: string; label: string }[] = [];
    if (f().search.trim()) out.push({ key: "search", label: `Search: “${f().search.trim()}”` });
    if (f().period !== "all") {
      const r = range();
      const span = `${r.from ? fmtDate(r.from) : "Any date"} – ${r.to ? fmtDate(r.to) : "today"}`;
      out.push({ key: "period", label: `Period: ${PERIOD_LABEL[f().period]} (${span})` });
    }
    if (f().status !== "all") out.push({ key: "status", label: `Status: ${STATUS_LABEL[f().status]}` });
    if (isWO && f().reason !== "all") out.push({ key: "reason", label: `Reason: ${f().reason}` });
    return out;
  };

  const removeFilter = (key: string) => {
    clearTimeout(qTimer);
    if (key === "search" || key === "all") setQ("");
    if (key === "all") setFilters({ ...DEFAULTS });
    else if (key === "period") setFilters({ period: "all", from: "", to: "" });
    else setFilters({ [key]: key === "search" ? "" : "all" } as Partial<typeof DEFAULTS>);
    qInput?.focus();
  };

  const today = toIsoDate();

  const toolbar = () => (
    <div class="toolbar" role="search" aria-label={`Filter ${cfg.nouns}`}>
      <div class="search">
        <span class="search-icon">
          <Icon name="search" size={18} />
        </span>
        <label class="visually-hidden" for="f-q">
          {props.texts.searchLabel}
        </label>
        <input
          ref={qInput}
          class="input"
          id="f-q"
          type="search"
          placeholder={props.texts.searchPlaceholder}
          autocomplete="off"
          value={q()}
          onInput={(e) => onSearch(e.currentTarget.value)}
        />
      </div>
      <label class="visually-hidden" for="f-period">
        Period
      </label>
      <select
        class="select"
        id="f-period"
        value={f().period}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setFilters(v === "custom" ? { period: v } : { period: v, from: "", to: "" });
          if (v === "custom" && !f().from && !f().to) queueMicrotask(() => fromInput?.focus());
        }}
      >
        <For each={PERIOD_OPTIONS}>{([v, label]) => <option value={v} selected={v === f().period}>{label}</option>}</For>
      </select>
      <div class="date-range" id="f-custom" hidden={f().period !== "custom"}>
        <label class="visually-hidden" for="f-from">
          From date
        </label>
        <input
          ref={fromInput}
          class="input"
          type="date"
          id="f-from"
          value={f().from}
          max={today}
          onChange={(e) => setFilters({ from: e.currentTarget.value })}
        />
        <span class="date-range-sep" aria-hidden="true">
          –
        </span>
        <label class="visually-hidden" for="f-to">
          To date
        </label>
        <input
          class="input"
          type="date"
          id="f-to"
          value={f().to}
          min={f().from || undefined}
          onChange={(e) => setFilters({ to: e.currentTarget.value })}
        />
      </div>
      <label class="visually-hidden" for="f-status">
        Status
      </label>
      <select class="select" id="f-status" value={f().status} onChange={(e) => setFilters({ status: e.currentTarget.value })}>
        <For each={STATUS_OPTIONS}>{([v, label]) => <option value={v} selected={v === f().status}>{label}</option>}</For>
      </select>
      <Show when={isWO}>
        <label class="visually-hidden" for="f-reason">
          Reason
        </label>
        <select class="select" id="f-reason" value={f().reason} onChange={(e) => setFilters({ reason: e.currentTarget.value })}>
          <option value="all" selected={f().reason === "all"}>
            All reasons
          </option>
          <For each={WRITE_OFF_REASONS}>{(r) => <option value={r} selected={r === f().reason}>{r}</option>}</For>
        </select>
      </Show>
    </div>
  );

  const loadingToolbar = () => (
    <div class="toolbar" aria-hidden="true">
      <div class="search">
        <span class="search-icon">
          <Icon name="search" size={18} />
        </span>
        <input class="input" type="search" placeholder={props.texts.searchPlaceholder} disabled tabindex="-1" />
      </div>
      <select class="select" disabled tabindex="-1">
        <option>All time</option>
      </select>
      <select class="select" disabled tabindex="-1">
        <option>All statuses</option>
      </select>
      <Show when={isWO}>
        <select class="select" disabled tabindex="-1">
          <option>All reasons</option>
        </select>
      </Show>
    </div>
  );

  const go = (e: MouseEvent, href: string) => {
    const t = e.target as HTMLElement;
    if (t.closest("a, button, input, select, textarea, label")) return;
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
    else navigate(href);
  };

  const row = (d: Doc) => {
    const url = docUrl(d);
    const rev = isReversal(d.kind);
    const sub = rev && d.reverses ? `Reverses ${d.reverses.number}` : d.status === "reversed" && d.reversal ? `Reversed by ${d.reversal.number}` : "";
    return (
      <tr class="row-link" data-href={url} onClick={(e) => go(e, url)}>
        <td class="td-primary" data-label="Number">
          <a class="cell-link mono" href={url}>
            {d.number}
          </a>
          <Show when={sub}>
            <span class="cell-sub">{sub}</span>
          </Show>
        </td>
        <td data-label="Date" class="nowrap">
          <Show when={d.status === "draft"} fallback={fmtDateTime(docDate(d))}>
            <span class="muted">Created {fmtDateTime(d.created_at)}</span>
          </Show>
        </td>
        <Show
          when={isWO}
          fallback={
            <td data-label="Supplier">
              <Show when={d.supplier} fallback={<span class="muted">—</span>}>
                {d.supplier}
              </Show>
            </td>
          }
        >
          <td data-label="Reason">
            {d.reason}
            <Show when={d.note}>
              <span class="cell-sub">{d.note}</span>
            </Show>
          </td>
        </Show>
        <td class="num" data-label="Lines">
          {d.line_count}
        </td>
        <td class="num" data-label={isWO ? "Value" : "Total"}>
          {fmtMoney(rev ? -d.total : d.total)}
        </td>
        <td data-label="Status">
          <Badge kind={rev ? "reversal" : d.status} />
        </td>
      </tr>
    );
  };

  const newHref = `${cfg.listPath}/new`;
  const newButton = (
    <a class="btn btn-primary" href={newHref}>
      <Icon name="plus" size={18} />
      <span>New {cfg.noun}</span>
    </a>
  );

  return (
    <AppShell active={cfg.nav} title={cfg.section}>
      <div class="page-header">
        <div>
          <h1>{cfg.section}</h1>
          <p class="page-subtitle">{props.texts.subtitle}</p>
        </div>
        <div class="page-actions">{newButton}</div>
      </div>
      <div id="list-root">
        <Switch>
          <Match when={list.state() === "loading"}>
            {loadingToolbar()}
            <div class="card">
              <div class="card-body">
                <SkeletonRows rows={8} cols={6} />
              </div>
            </div>
          </Match>
          <Match when={list.state() === "error" && !list.data()}>
            <div class="card">
              <div class="card-body">
                <ErrorState
                  title={`Couldn’t load ${cfg.nouns}`}
                  text={errorText(list.error())}
                  onRetry={() => void list.reload()}
                />
              </div>
            </div>
          </Match>
          <Match when={list.data()?.total === 0}>
            <div class="card">
              <EmptyState
                icon={props.texts.emptyIcon}
                title={props.texts.emptyTitle}
                text={props.texts.emptyText}
                actions={
                  <a class="btn btn-primary" href={newHref}>
                    <Icon name="plus" size={18} />
                    <span>New {cfg.noun}</span>
                  </a>
                }
              />
            </div>
          </Match>
          <Match when={list.data()}>
            {(d) => (
              <>
                {toolbar()}
                <Show when={chips().length > 0}>
                  <div class="filter-bar" id="f-chips" aria-label="Active filters" role="group">
                    <For each={chips()}>
                      {(c) => (
                        <span class="chip is-active">
                          {c.label}
                          <button
                            class="chip-remove"
                            type="button"
                            aria-label={`Remove filter ${c.label}`}
                            onClick={() => removeFilter(c.key)}
                          >
                            <Icon name="x" size={14} />
                          </button>
                        </span>
                      )}
                    </For>
                    <button type="button" class="btn btn-ghost btn-sm" onClick={() => removeFilter("all")}>
                      Clear filters
                    </button>
                  </div>
                </Show>
                <p class="hint results-meta" id="f-meta" role="status" aria-live="polite">
                  {chips().length
                    ? `Showing ${d().items.length} of ${d().total} documents`
                    : `${d().total} documents`}
                </p>
                <div id="f-results" aria-busy={list.loading() ? "true" : undefined}>
                  <Switch>
                    <Match when={list.state() === "error"}>
                      <div class="card">
                        <div class="card-body">
                          <ErrorState
                            title={`Couldn’t load ${cfg.nouns}`}
                            text={errorText(list.error())}
                            onRetry={() => void list.reload()}
                            compact
                          />
                        </div>
                      </div>
                    </Match>
                    <Match when={d().items.length === 0}>
                      <div class="card">
                        <EmptyState
                          icon="search"
                          compact
                          title={`No ${cfg.nouns} match your filters`}
                          text={props.texts.noResultsText}
                          actions={
                            <button type="button" class="btn btn-secondary" onClick={() => removeFilter("all")}>
                              Clear filters
                            </button>
                          }
                        />
                      </div>
                    </Match>
                    <Match when={true}>
                      <div class="card">
                        <div class="table-wrap">
                          <table class="table table-cards">
                            <caption class="visually-hidden">
                              {cfg.section}
                              {chips().length ? " (filtered)" : ""}
                            </caption>
                            <thead>
                              <tr>
                                <th scope="col">Number</th>
                                <th scope="col">Date</th>
                                <th scope="col">{isWO ? "Reason" : "Supplier"}</th>
                                <th scope="col" class="num">
                                  Lines
                                </th>
                                <th scope="col" class="num">
                                  <Show when={isWO} fallback="Total">
                                    Value <span class="visually-hidden">at average cost</span>
                                  </Show>
                                </th>
                                <th scope="col">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              <For each={d().items}>{row}</For>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </Match>
                  </Switch>
                </div>
              </>
            )}
          </Match>
        </Switch>
      </div>
    </AppShell>
  );
}
