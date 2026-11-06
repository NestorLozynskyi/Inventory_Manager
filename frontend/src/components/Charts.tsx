/**
 * Charts — port of IM.chart.bars / IM.chart.hbars (app.js) producing the same SVG / HTML.
 *
 *   <BarChart title="Receipts vs write-offs" categories={["Oct 5", …]} valueFormat="money"
 *             series={[{ name: "Receipts", values: [...] }, { name: "Write-offs", values: [...] }]} />
 *   <HBarChart title="Write-offs by reason" valueFormat="money" items={[{ label: "Damaged", value: 120 }]} />
 */
import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { fmtMoney, fmtMoneyCompact, fmtNumber, fmtQty } from "../lib/format";

export const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

export type ValueFormat = "money" | "qty" | "number" | ((v: number) => string);

export function resolveFormat(f: ValueFormat | undefined): (v: number) => string {
  if (typeof f === "function") return f;
  if (f === "money") return fmtMoney;
  if (f === "qty") return (v) => fmtQty(v);
  return (v) => fmtNumber(v, 2);
}

/** "Nice" axis scale: top value and tick step for ~`ticks` ticks (1/2/2.5/5/10 × 10^n). */
export function niceScale(max: number, ticks: number): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 0.25 };
  const raw = max / ticks;
  const pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  return { top: Math.ceil(max / step) * step, step };
}

export interface BarSeries {
  name: string;
  values: number[];
  color?: string;
}

export interface BarChartProps {
  categories: string[];
  series: BarSeries[];
  valueFormat?: ValueFormat;
  axisFormat?: ValueFormat;
  height?: number;
  title?: string;
  ariaLabel?: string;
  class?: string;
  /** Initial width before measuring (tests / SSR). */
  width?: number;
}

/** Grouped bar chart (SVG + legend), re-rendered when the container width changes. */
export function BarChart(props: BarChartProps): JSX.Element {
  let el: HTMLDivElement | undefined;
  const [width, setWidth] = createSignal(props.width ?? 0);

  onMount(() => {
    if (!el) return;
    let lastW = el.clientWidth;
    if (lastW) setWidth(lastW);
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        if (el && el.clientWidth !== lastW) {
          lastW = el.clientWidth;
          setWidth(lastW);
        }
      });
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    } else {
      let t: ReturnType<typeof setTimeout> | undefined;
      const onResize = () => {
        clearTimeout(t);
        t = setTimeout(() => el && setWidth(el.clientWidth), 120);
      };
      window.addEventListener("resize", onResize);
      onCleanup(() => {
        clearTimeout(t);
        window.removeEventListener("resize", onResize);
      });
    }
  });

  const fmt = () => resolveFormat(props.valueFormat);
  const axisFmt = () =>
    props.axisFormat
      ? resolveFormat(props.axisFormat)
      : props.valueFormat === "money"
        ? fmtMoneyCompact
        : fmt();
  const color = (s: BarSeries, si: number) => s.color || PALETTE[si % PALETTE.length];
  const summary = () =>
    props.ariaLabel ||
    `${props.title || "Bar chart"}. ` +
      props.series
        .map((s) => `${s.name}: ` + props.categories.map((c, i) => `${c} ${fmt()(s.values[i] || 0)}`).join(", "))
        .join(". ") +
      ".";

  const geo = () => {
    const W = Math.max(280, Math.floor(width() || 600));
    const H = props.height || 260;
    const mL = 52;
    const mR = 8;
    const mT = 12;
    const mB = 28;
    const pw = W - mL - mR;
    const ph = H - mT - mB;
    let max = 0;
    for (const s of props.series) for (const v of s.values) if (v > max) max = v;
    const sc = niceScale(max, 4);
    const y = (v: number) => mT + ph - (v / sc.top) * ph;
    const cats = props.categories;
    const n = props.series.length;
    const band = pw / Math.max(cats.length, 1);
    const groupW = Math.min(band * 0.72, 28 * n + 8);
    const gap = n > 1 ? 2 : 0;
    const barW = Math.max(2, (groupW - gap * (n - 1)) / Math.max(n, 1));
    const labelEvery = band < 44 ? 2 : 1;
    const ticks: { t: number; yy: number }[] = [];
    for (let t = 0; t <= sc.top + 1e-9; t += sc.step) ticks.push({ t, yy: Math.round(y(t)) + 0.5 });
    return { W, H, mL, mR, mT, ph, sc, band, groupW, gap, barW, labelEvery, ticks };
  };

  return (
    <div ref={el} class={`chart${props.class ? ` ${props.class}` : ""}`}>
      <svg
        role="img"
        aria-label={summary()}
        viewBox={`0 0 ${geo().W} ${geo().H}`}
        width={geo().W}
        height={geo().H}
        preserveAspectRatio="xMinYMin meet"
      >
        <For each={geo().ticks}>
          {(tk) => (
            <>
              <line
                class={tk.t === 0 ? "chart-axis-line" : "chart-grid-line"}
                x1={geo().mL}
                x2={geo().W - geo().mR}
                y1={tk.yy}
                y2={tk.yy}
              />
              <text x={geo().mL - 8} y={tk.yy + 4} text-anchor="end">
                {axisFmt()(tk.t)}
              </text>
            </>
          )}
        </For>
        <For each={props.categories}>
          {(c, i) => {
            const g = geo;
            const gx = () => g().mL + g().band * i() + (g().band - g().groupW) / 2;
            return (
              <>
                <For each={props.series}>
                  {(s, si) => {
                    const v = () => s.values[i()] || 0;
                    const h = () => Math.max(v() > 0 ? 1 : 0, (v() / g().sc.top) * g().ph);
                    return (
                      <rect
                        x={(gx() + si() * (g().barW + g().gap)).toFixed(1)}
                        y={(g().mT + g().ph - h()).toFixed(1)}
                        width={g().barW.toFixed(1)}
                        height={h().toFixed(1)}
                        rx="2"
                        style={`fill:${color(s, si())}`}
                      >
                        <title>{`${c} · ${s.name}: ${fmt()(v())}`}</title>
                      </rect>
                    );
                  }}
                </For>
                <Show when={i() % g().labelEvery === 0}>
                  <text x={(g().mL + g().band * i() + g().band / 2).toFixed(1)} y={g().H - 8} text-anchor="middle">
                    {c}
                  </text>
                </Show>
              </>
            );
          }}
        </For>
      </svg>
      <ul class="chart-legend">
        <For each={props.series}>
          {(s, si) => (
            <li class="chart-legend-item">
              <span class="chart-swatch" style={`background:${color(s, si())}`} />
              {s.name}{" "}
              <span class="chart-legend-value">{fmt()(s.values.reduce((a, b) => a + (b || 0), 0))}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

export interface HBarItem {
  label: string;
  value: number;
  color?: string;
}

export interface HBarChartProps {
  items: HBarItem[];
  valueFormat?: ValueFormat;
  title?: string;
  ariaLabel?: string;
  class?: string;
}

/** Horizontal bars (HTML), same markup as IM.chart.hbars. */
export function HBarChart(props: HBarChartProps): JSX.Element {
  const fmt = () => resolveFormat(props.valueFormat);
  const max = () => props.items.reduce((m, it) => Math.max(m, it.value || 0), 0);
  const summary = () =>
    props.ariaLabel ||
    `${props.title || "Horizontal bar chart"}. ` +
      props.items.map((it) => `${it.label} ${fmt()(it.value || 0)}`).join(", ") +
      ".";
  return (
    <div class={`chart${props.class ? ` ${props.class}` : ""}`}>
      <div class="hbars" role="img" aria-label={summary()}>
        <For each={props.items}>
          {(it) => {
            const pct = () => {
              let p = max() > 0 ? (it.value / max()) * 100 : 0;
              if (it.value > 0 && p < 1) p = 1;
              return p;
            };
            return (
              <div class="hbars-row" title={`${it.label}: ${fmt()(it.value || 0)}`}>
                <span class="hbars-label">{it.label}</span>
                <span class="hbars-track">
                  <span class="hbars-bar" style={`width:${pct().toFixed(1)}%;${it.color ? `background:${it.color}` : ""}`} />
                </span>
                <span class="hbars-value">{fmt()(it.value || 0)}</span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
