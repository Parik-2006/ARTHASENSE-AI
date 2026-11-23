"use client";

import { useCallback, useId, useState } from "react";
import { type ForecastRow, fmt, monthLabel } from "@/lib/forecasting";
import { monthNumber } from "@/lib/indicator";

/** Forecasts V3 chart: official history (solid teal) and the model estimate (dashed gold) on one time axis, a
 *  labelled forecast-origin boundary, 80%/95% prediction bands, an HTML tooltip (month, value, source, range) and
 *  full keyboard access. The older ForecastChart is kept unchanged because the Overview imports it. */

export interface HistoryPoint {
  period: string;
  index: number;
}

export interface ChartPoint {
  n: number;
  period: string;
  value: number;
  forecast: boolean;
  row?: ForecastRow;
}

// Gold-tinted bands so the uncertainty reads as part of the (gold) forecast, not of the (teal) history.
const BAND_80 = "color-mix(in srgb, var(--target) 30%, transparent)";
const BAND_95 = "color-mix(in srgb, var(--target) 14%, transparent)";
const ZONE = "color-mix(in srgb, var(--target) 5%, transparent)";

/** Round, evenly spaced axis values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi === lo) return [lo];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Month numbers to label so labels never collide: a step of 1/2/3/6/12/24 months aligned to calendar months. */
export function monthTicks(n0: number, n1: number, plotWidth: number, minGap = 76): number[] {
  const room = Math.max(1, Math.floor(plotWidth / minGap));
  const step = [1, 2, 3, 6, 12, 24, 48].find((s) => Math.floor((n1 - n0) / s) + 1 <= room) ?? 48;
  const out: number[] = [];
  for (let n = Math.ceil(n0 / step) * step; n <= n1; n += step) out.push(n);
  return out;
}

/** Tooltip text for one point. Forecast lines always say they are model estimates. */
export function tooltipLines(p: ChartPoint, officialSource: string, modelName: string): { title: string; value: string; source: string; ranges: string[] } {
  const ranges: string[] = [];
  if (p.forecast) {
    const r = p.row;
    if (r?.lower_80 != null && r.upper_80 != null) ranges.push(`80% range ${fmt(r.lower_80)} – ${fmt(r.upper_80)}`);
    if (r?.lower_95 != null && r.upper_95 != null) ranges.push(`95% range ${fmt(r.lower_95)} – ${fmt(r.upper_95)}`);
    if (!ranges.length) ranges.push("No uncertainty range from this model");
  }
  return {
    title: monthLabel(p.period, true),
    value: fmt(p.value),
    source: p.forecast ? `Model estimate · ${modelName}` : `Official · ${officialSource}`,
    ranges,
  };
}

export function OutlookChart({
  history,
  forecast,
  name,
  axisLabel,
  officialSource,
  modelName,
  compact = false,
  bandsTourId,
}: {
  history: HistoryPoint[];
  forecast: ForecastRow[];
  name: string;
  axisLabel: string;
  officialSource: string;
  modelName: string;
  /** Card sparkline: shorter, no axes/legend, not interactive (the card links to the explorer). */
  compact?: boolean;
  bandsTourId?: string;
}) {
  const H = compact ? 120 : 340;
  const M = compact ? { l: 4, r: 4, t: 8, b: 8 } : { l: 48, r: 14, t: 26, b: 30 };
  const [width, setWidth] = useState(compact ? 320 : 720);
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const set = () => setWidth(Math.max(240, Math.floor(el.clientWidth)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (history.length < 2) return null;
  const hist: ChartPoint[] = history.map((h) => ({ n: monthNumber(h.period), period: h.period, value: h.index, forecast: false }));
  const fc: ChartPoint[] = forecast.map((f) => ({ n: monthNumber(f.target_date), period: f.target_date, value: f.forecast, forecast: true, row: f }));
  const pts = [...hist, ...fc];
  const n0 = hist[0].n;
  const n1 = Math.max(...pts.map((p) => p.n));
  const vals = [...hist.map((h) => h.value), ...fc.flatMap((p) => [p.value, p.row?.lower_95 ?? p.row?.lower_80 ?? p.value, p.row?.upper_95 ?? p.row?.upper_80 ?? p.value])];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 0.5;
  const yt = niceTicks(lo - pad, hi + pad, compact ? 3 : 5);
  const y0 = Math.min(lo - pad, yt[0] ?? lo);
  const y1 = Math.max(hi + pad, yt[yt.length - 1] ?? hi);
  const plotW = width - M.l - M.r;
  const plotH = H - M.t - M.b;
  const sx = (n: number) => M.l + ((n - n0) / (n1 - n0 || 1)) * plotW;
  const sy = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * plotH;
  const last = hist[hist.length - 1];
  const xo = sx(last.n);
  const line = (ps: ChartPoint[]) => ps.map((p) => `${sx(p.n).toFixed(1)},${sy(p.value).toFixed(1)}`).join(" ");
  const band = (lk: "lower_80" | "lower_95", uk: "upper_80" | "upper_95") => {
    const have = fc.filter((p) => p.row?.[lk] != null && p.row?.[uk] != null);
    if (!have.length) return null;
    const up = have.map((p) => `${sx(p.n).toFixed(1)},${sy(p.row![uk] as number).toFixed(1)}`);
    const dn = [...have].reverse().map((p) => `${sx(p.n).toFixed(1)},${sy(p.row![lk] as number).toFixed(1)}`);
    return [`${xo.toFixed(1)},${sy(last.value).toFixed(1)}`, ...up, ...dn].join(" ");
  };
  const b95 = band("lower_95", "upper_95");
  const b80 = band("lower_80", "upper_80");
  const xt = monthTicks(n0, n1, plotW);
  const fcSpan = fc.length ? `${monthLabel(fc[0].period)} to ${monthLabel(fc[fc.length - 1].period)}` : "";
  const summary = `${name}: official values from ${monthLabel(hist[0].period)} to ${monthLabel(last.period)}${fc.length ? `, then ${fc.length} ${fc.length === 1 ? "month" : "months"} of model estimates (${fcSpan})` : ""}.`;

  const svg = (
    <svg width={width} height={H} aria-hidden className="block overflow-visible">
      {!compact &&
        yt.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={width - M.r} y1={sy(v)} y2={sy(v)} className="stroke-rule" strokeWidth={1} />
            <text x={M.l - 8} y={sy(v)} textAnchor="end" dominantBaseline="middle" className="figure fill-ink-muted text-[11px]">
              {v.toFixed(v % 1 === 0 ? 0 : 1)}
            </text>
          </g>
        ))}
      {!compact &&
        xt.map((n) => (
          <text key={n} x={sx(n)} y={H - M.b + 18} textAnchor="middle" className="figure fill-ink-muted text-[11px]">
            {monthLabel(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`)}
          </text>
        ))}
      {!compact && (
        <text transform={`translate(11 ${M.t + plotH / 2}) rotate(-90)`} textAnchor="middle" className="fill-ink-muted text-[11px]">
          {axisLabel}
        </text>
      )}
      {fc.length > 0 && <rect x={xo} y={M.t} width={Math.max(0, width - M.r - xo)} height={plotH} style={{ fill: ZONE }} />}
      {b95 && <polygon points={b95} style={{ fill: BAND_95 }} />}
      {b80 && <polygon points={b80} style={{ fill: BAND_80 }} />}
      {fc.length > 0 && <line x1={xo} x2={xo} y1={M.t - (compact ? 0 : 14)} y2={H - M.b} className="stroke-ink-muted" strokeDasharray="3 3" strokeWidth={1} />}
      {!compact && fc.length > 0 &&
        (width - M.r - xo >= 72 ? (
          <>
            <text x={xo - 6} y={M.t - 6} textAnchor="end" className="fill-ink-muted text-[11px] font-medium">
              ← Official
            </text>
            <text x={xo + 6} y={M.t - 6} textAnchor="start" className="fill-target text-[11px] font-medium">
              Forecast →
            </text>
          </>
        ) : (
          // Narrow screens: the forecast strip is too thin for two labels; keep one, never clipped.
          <text x={width - M.r} y={M.t - 6} textAnchor="end" className="fill-target text-[11px] font-medium">
            Forecast ▸
          </text>
        ))}
      <polyline points={line(hist)} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {fc.length > 0 && <polyline points={line([last, ...fc])} fill="none" className="stroke-target" strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" />}
      {/* Origin marker (last official) and forecast markers: hollow gold rings set forecasts apart without colour alone. */}
      <circle cx={xo} cy={sy(last.value)} r={compact ? 3 : 4} className="fill-accent stroke-surface" strokeWidth={2} />
      {fc.map((p) => (
        <circle key={p.n} cx={sx(p.n)} cy={sy(p.value)} r={compact ? 2.5 : 3.5} className="fill-surface stroke-target" strokeWidth={2} />
      ))}
      {!compact && active !== null && (
        <g pointerEvents="none">
          <line x1={sx(pts[active].n)} x2={sx(pts[active].n)} y1={M.t} y2={H - M.b} className="stroke-ink-muted" strokeWidth={1} />
          <circle cx={sx(pts[active].n)} cy={sy(pts[active].value)} r={6} className={pts[active].forecast ? "fill-target stroke-surface" : "fill-accent stroke-surface"} strokeWidth={2} />
        </g>
      )}
    </svg>
  );

  if (compact) {
    return (
      <div ref={measure} className="w-full min-w-0 overflow-hidden" role="img" aria-label={summary}>
        {svg}
      </div>
    );
  }

  const a = active === null ? null : pts[active];
  const tip = a ? tooltipLines(a, officialSource, modelName) : null;
  const TIP_W = 210;
  const ax = a ? sx(a.n) : 0;
  const tipLeft = a ? (ax + 14 + TIP_W > width ? Math.max(0, ax - 14 - TIP_W) : ax + 14) : 0;
  const tipTop = a ? Math.min(Math.max(sy(a.value) - 40, 0), H - M.b - 96) : 0;

  const nearest = (clientX: number, el: HTMLElement) => {
    const x = clientX - el.getBoundingClientRect().left;
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.abs(sx(p.n) - x) < Math.abs(sx(pts[best].n) - x)) best = i;
    });
    return best;
  };

  return (
    <div className="min-w-0">
      <div
        ref={measure}
        role="group"
        tabIndex={0}
        aria-label={`${summary} Use the left and right arrow keys to read each month.`}
        aria-describedby={tip ? tipId : undefined}
        data-testid="outlook-chart"
        className="relative w-full min-w-0 touch-pan-y overflow-hidden rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
        onPointerDown={(e) => setActive(nearest(e.clientX, e.currentTarget))}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setActive((i) => Math.min(pts.length - 1, (i ?? hist.length - 2) + 1));
          else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? hist.length) - 1));
          else if (e.key === "Home") setActive(0);
          else if (e.key === "End") setActive(pts.length - 1);
          else if (e.key === "Escape") setActive(null);
          else return;
          e.preventDefault();
        }}
      >
        {svg}
        {tip && (
          <div
            id={tipId}
            role="status"
            data-testid="chart-tooltip"
            className="pointer-events-none absolute rounded-md border border-rule bg-surface px-3 py-2 text-xs shadow-lg"
            style={{ left: tipLeft, top: tipTop, width: TIP_W }}
          >
            <p className="font-medium text-ink">{tip.title}</p>
            <p className="figure mt-0.5 text-base text-ink">{tip.value}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-ink-muted">
              <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${a!.forecast ? "border-2 border-target" : "bg-accent"}`} />
              {tip.source}
            </p>
            {tip.ranges.map((r) => (
              <p key={r} className="figure mt-0.5 text-ink-muted">
                {r}
              </p>
            ))}
          </div>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-muted" aria-label="Chart legend">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-5 rounded bg-accent" /> Official history
        </li>
        {fc.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-5 border-t-2 border-dashed border-target" /> Model estimate
          </li>
        )}
        {(b80 || b95) && (
          <li data-tour={bandsTourId} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {b80 && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-3 w-5 rounded-sm" style={{ background: BAND_80 }} /> 80% range
              </span>
            )}
            {b95 && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-3 w-5 rounded-sm" style={{ background: BAND_95 }} /> 95% range
              </span>
            )}
          </li>
        )}
      </ul>
    </div>
  );
}
