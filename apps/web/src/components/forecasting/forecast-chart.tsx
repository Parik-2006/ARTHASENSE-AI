"use client";

import { useCallback, useState } from "react";
import { type ForecastRow, fmt, monthLabel } from "@/lib/forecasting";
import { monthNumber } from "@/lib/indicator";

const FULL_HEIGHT = 320;
const COMPACT_HEIGHT = 190;
const M = { l: 52, r: 16, t: 16, b: 34 };

export interface HistoryPoint {
  period: string;
  index: number;
}

interface Pt {
  n: number;
  x: number;
  y: number;
  period: string;
  value: number;
  forecast: boolean;
  row?: ForecastRow;
}

/** History (solid) and forecast (dashed) on one time axis, with interval bands where the model has them. */
export function ForecastChart({
  history,
  forecast,
  axisLabel,
  name,
  compact = false,
}: {
  history: HistoryPoint[];
  forecast: ForecastRow[];
  axisLabel: string;
  name: string;
  /** Small card version: shorter, same data and keyboard access. */
  compact?: boolean;
}) {
  const HEIGHT = compact ? COMPACT_HEIGHT : FULL_HEIGHT;
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setWidth(Math.max(280, Math.floor(el.clientWidth)));
    const ro = new ResizeObserver(() => setWidth(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (history.length < 2) return null;
  const hist = history.map((h) => ({ n: monthNumber(h.period), v: h.index, p: h.period }));
  const fc = forecast.map((f) => ({ n: monthNumber(f.target_date), f }));
  const all = [...hist.map((h) => h.n), ...fc.map((f) => f.n)];
  const [n0, n1] = [Math.min(...all), Math.max(...all)];
  const vals = [
    ...hist.map((h) => h.v),
    ...fc.flatMap(({ f }) => [f.forecast, f.lower_95 ?? f.lower_80 ?? f.forecast, f.upper_95 ?? f.upper_80 ?? f.forecast]),
  ];
  const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
  const pad = (hi - lo) * 0.08 || 0.5;
  const [y0, y1] = [lo - pad, hi + pad];
  const plotW = width - M.l - M.r;
  const plotH = HEIGHT - M.t - M.b;
  const sx = (n: number) => M.l + ((n - n0) / (n1 - n0 || 1)) * plotW;
  const sy = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * plotH;

  const pts: Pt[] = [
    ...hist.map((h) => ({ n: h.n, x: sx(h.n), y: sy(h.v), period: h.p, value: h.v, forecast: false })),
    ...fc.map(({ n, f }) => ({ n, x: sx(n), y: sy(f.forecast), period: f.target_date, value: f.forecast, forecast: true, row: f })),
  ];
  const last = hist[hist.length - 1];
  const histPath = hist.map((h) => `${sx(h.n)},${sy(h.v)}`).join(" ");
  const fcPath = [`${sx(last.n)},${sy(last.v)}`, ...fc.map(({ n, f }) => `${sx(n)},${sy(f.forecast)}`)].join(" ");

  const band = (lowerKey: "lower_80" | "lower_95", upperKey: "upper_80" | "upper_95") => {
    const have = fc.filter(({ f }) => f[lowerKey] !== null && f[upperKey] !== null);
    if (have.length < 1) return null;
    const upper = have.map(({ n, f }) => `${sx(n)},${sy(f[upperKey] as number)}`);
    const lower = [...have].reverse().map(({ n, f }) => `${sx(n)},${sy(f[lowerKey] as number)}`);
    return [`${sx(last.n)},${sy(last.v)}`, ...upper, ...lower].join(" ");
  };
  const b95 = band("lower_95", "upper_95");
  const b80 = band("lower_80", "upper_80");

  const yTicks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  const step = Math.max(1, Math.ceil((n1 - n0 + 1) / Math.max(1, Math.floor(plotW / 64))));
  const xTicks = pts.filter((p) => (p.n - n0) % step === 0);

  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const x = clientX - svg.getBoundingClientRect().left;
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(pts[best].x - x)) best = i;
    });
    return best;
  };
  const a = active === null ? null : pts[active];
  const lines = a
    ? [
        `${monthLabel(a.period, true)}${a.forecast ? " (forecast)" : " (observed)"}`,
        `${name} ${fmt(a.value)}`,
        ...(a.row?.lower_80 != null ? [`80% interval ${fmt(a.row.lower_80)} to ${fmt(a.row.upper_80)}`] : a.forecast ? ["no interval available"] : []),
      ]
    : [];
  const tipW = 190;
  const tipH = 16 * lines.length + 8;
  const tipX = a ? (a.x + tipW + 12 > width - M.r ? a.x - tipW - 10 : a.x + 10) : 0;
  const tipY = a ? Math.min(Math.max(a.y - 28, M.t), HEIGHT - M.b - tipH) : 0;

  return (
    <div ref={measure} className="w-full min-w-0 overflow-hidden">
      <svg
        width={width}
        height={HEIGHT}
        role="group"
        tabIndex={0}
        aria-label={`${name}: observed values from ${monthLabel(hist[0].p)} to ${monthLabel(last.p)} and ${fc.length} forecast months. Use the left and right arrow keys to read each month. The same values are in the table below.`}
        className="block touch-pan-y rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setActive((i) => Math.min(pts.length - 1, (i ?? -1) + 1));
          else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? pts.length) - 1));
          else if (e.key === "Home") setActive(0);
          else if (e.key === "End") setActive(pts.length - 1);
          else if (e.key === "Escape") setActive(null);
          else return;
          e.preventDefault();
        }}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={width - M.r} y1={sy(v)} y2={sy(v)} className="stroke-rule" strokeWidth={1} />
            <text x={M.l - 8} y={sy(v)} textAnchor="end" dominantBaseline="middle" className="figure fill-ink-muted text-[11px]">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {xTicks.map((p) => (
          <text key={p.n} x={p.x} y={HEIGHT - M.b + 18} textAnchor="middle" className="figure fill-ink-muted text-[11px]">
            {monthLabel(p.period)}
          </text>
        ))}
        <text transform={`translate(12 ${M.t + plotH / 2}) rotate(-90)`} textAnchor="middle" className="fill-ink-muted text-[11px]">
          {axisLabel}
        </text>

        {b95 && <polygon points={b95} style={{ fill: "var(--band-95)" }} />}
        {b80 && <polygon points={b80} style={{ fill: "var(--band-80)" }} />}
        <line x1={sx(last.n)} x2={sx(last.n)} y1={M.t} y2={HEIGHT - M.b} className="stroke-ink-muted" strokeDasharray="2 4" />
        <text x={sx(last.n) - 4} y={M.t + 10} textAnchor="end" className="fill-ink-muted text-[10px]">
          forecast origin
        </text>
        <polyline points={histPath} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" />
        {fc.length > 0 && (
          <polyline points={fcPath} fill="none" className="stroke-target" strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" />
        )}
        {pts.map((p, i) => (
          <circle
            key={`${p.forecast}-${p.n}`}
            cx={p.x}
            cy={p.y}
            r={active === i ? 5.5 : p.forecast ? 3.5 : 2.5}
            className={p.forecast ? "fill-surface stroke-target" : "fill-surface stroke-accent"}
            strokeWidth={2}
          />
        ))}
        {a && (
          <g pointerEvents="none">
            <line x1={a.x} x2={a.x} y1={M.t} y2={HEIGHT - M.b} className="stroke-ink-muted" strokeDasharray="3 3" />
            <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={4} className="fill-surface stroke-rule" />
            {lines.map((t, i) => (
              <text key={t} x={tipX + 8} y={tipY + 17 + i * 16} className={`${i === 1 ? "figure fill-ink" : "fill-ink-muted"} text-[11px]`}>
                {t}
              </text>
            ))}
          </g>
        )}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted" aria-label="Legend">
        <li>
          <span aria-hidden className="mr-1 inline-block h-0.5 w-5 bg-accent align-middle" /> Observed (official)
        </li>
        <li>
          <span aria-hidden className="mr-1 inline-block w-5 border-t-2 border-dashed border-target align-middle" /> Forecast
        </li>
        {b80 && (
          <li>
            <span aria-hidden className="mr-1 inline-block h-3 w-5 align-middle" style={{ background: "var(--band-80)" }} /> 80% interval
          </li>
        )}
        {b95 && (
          <li>
            <span aria-hidden className="mr-1 inline-block h-3 w-5 align-middle" style={{ background: "var(--band-95)" }} /> 95% interval
          </li>
        )}
      </ul>
      <p aria-live="polite" className="sr-only">
        {a ? lines.join(", ") : ""}
      </p>
    </div>
  );
}
