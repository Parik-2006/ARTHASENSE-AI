"use client";

import { useCallback, useMemo, useState } from "react";
import { formatPeriod } from "@/lib/indicator";

export interface ChartPoint {
  n: number; // month number (see monthNumber)
  v: number | null; // null = no value: a gap, never zero
}
export interface ChartSeries {
  key: string;
  label: string;
  stroke: string; // CSS colour, e.g. "var(--accent)"
  dash?: string;
  points: ChartPoint[];
}

const H = 280;
const M = { l: 56, r: 14, t: 14, b: 32 };

const periodOf = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`;

/** Dependency-free SVG chart (lines or diverging bars) for monthly data. Missing months are real gaps.
 *  Each chart has its own vertical scale: never plot different indicators' raw levels together. */
export function TimeChart({
  series,
  kind = "line",
  yLabel,
  unit = "",
  digits = 2,
  description,
  signed = false,
  stepMonths = 1,
  formatN,
}: {
  series: ChartSeries[];
  kind?: "line" | "bars";
  yLabel: string;
  unit?: string;
  digits?: number;
  description: string;
  signed?: boolean;
  /** Months between consecutive points: 1 for monthly data (default), 3 for quarterly data. Lines only join points exactly this far apart. */
  stepMonths?: number;
  /** Label for a point's month number (tooltip and axis); defaults to the month name. */
  formatN?: (n: number) => string;
}) {
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const set = () => setWidth(Math.max(260, Math.floor(el.clientWidth)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const ns = [...new Set(all.map((p) => p.n))].sort((a, b) => a - b);
    const vals = all.map((p) => p.v).filter((v): v is number => v !== null);
    return { ns, vals };
  }, [series]);

  if (model.vals.length === 0) return null;
  const { ns, vals } = model;
  const [n0, n1] = [ns[0], ns[ns.length - 1]];
  const span = Math.max(1, n1 - n0);
  let [lo, hi] = [Math.min(...vals), Math.max(...vals)];
  if (kind === "bars") [lo, hi] = [Math.min(lo, 0), Math.max(hi, 0)];
  const pad = (hi - lo) * 0.12 || 0.5;
  const [y0, y1] = [kind === "bars" ? lo - (lo < 0 ? pad : 0) : lo - pad, hi + pad];
  const plotW = width - M.l - M.r;
  const plotH = H - M.t - M.b;
  const unit0 = stepMonths;
  const inset = kind === "bars" ? plotW / (span / unit0 + 1) / 2 : 0;
  const sx = (n: number) => M.l + inset + ((n - n0) / span) * (plotW - 2 * inset);
  const sy = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * plotH;
  const yTicks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  const step = Math.max(1, Math.ceil((span / unit0 + 1) / Math.max(1, Math.floor(plotW / (formatN ? 84 : 58))))) * unit0;
  const xTicks = ns.filter((n) => (n - n0) % step === 0);
  const barW = Math.max(2, Math.min(28, (plotW / (span / unit0 + 1)) * 0.7));
  const fmt = (v: number) => `${signed && v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;

  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const x = clientX - svg.getBoundingClientRect().left;
    let best = 0;
    ns.forEach((n, i) => {
      if (Math.abs(sx(n) - x) < Math.abs(sx(ns[best]) - x)) best = i;
    });
    return best;
  };

  const an = active === null ? null : ns[active];
  const tip =
    an === null
      ? []
      : [
          formatN ? formatN(an) : formatPeriod(periodOf(an), true),
          ...series.map((s) => {
            const p = s.points.find((q) => q.n === an);
            return `${series.length > 1 ? `${s.label}: ` : ""}${p && p.v !== null ? fmt(p.v) : "no data"}`;
          }),
        ];
  const tipW = Math.min(width - 8, 190);
  const tipH = 10 + tip.length * 16;
  const tipX = an === null ? 0 : sx(an) + tipW + 14 > width - M.r ? sx(an) - tipW - 10 : sx(an) + 10;

  // Line segments break at null values and at non-consecutive months.
  const segs = (s: ChartSeries) => {
    const out: { n: number; v: number }[][] = [];
    let prev: number | null = null;
    for (const p of [...s.points].sort((a, b) => a.n - b.n)) {
      if (p.v === null) {
        prev = null;
        continue;
      }
      if (prev !== null && p.n - prev === stepMonths) out[out.length - 1].push({ n: p.n, v: p.v });
      else out.push([{ n: p.n, v: p.v }]);
      prev = p.n;
    }
    return out;
  };

  return (
    <div ref={measure} className="w-full">
      <svg
        width={width}
        height={H}
        role="group"
        tabIndex={0}
        aria-label={`${description} Use left and right arrow keys to read each ${stepMonths === 3 ? "quarter" : "month"}.`}
        className="block touch-pan-y rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setActive((i) => Math.min(ns.length - 1, (i ?? -1) + 1));
          else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? ns.length) - 1));
          else if (e.key === "Home") setActive(0);
          else if (e.key === "End") setActive(ns.length - 1);
          else if (e.key === "Escape") setActive(null);
          else return;
          e.preventDefault();
        }}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={width - M.r} y1={sy(v)} y2={sy(v)} stroke="var(--rule)" />
            <text x={M.l - 6} y={sy(v)} textAnchor="end" dominantBaseline="middle" className="figure fill-ink-muted text-[11px]">
              {v.toFixed(digits > 1 ? 1 : digits)}
            </text>
          </g>
        ))}
        {kind === "bars" && y0 < 0 && y1 > 0 && (
          <line x1={M.l} x2={width - M.r} y1={sy(0)} y2={sy(0)} stroke="var(--ink-muted)" strokeWidth={1.5} />
        )}
        {xTicks.map((n) => (
          <text key={n} x={sx(n)} y={H - M.b + 18} textAnchor={sx(n) > width - M.r - 26 ? "end" : "middle"} className="figure fill-ink-muted text-[11px]">
            {formatN ? formatN(n) : formatPeriod(periodOf(n))}
          </text>
        ))}
        <text transform={`translate(12 ${M.t + plotH / 2}) rotate(-90)`} textAnchor="middle" className="fill-ink-muted text-[11px]">
          {yLabel}
        </text>

        {kind === "line" &&
          series.map((s) => (
            <g key={s.key}>
              {segs(s).map((seg, i) => (
                <polyline
                  key={i}
                  points={seg.map((p) => `${sx(p.n)},${sy(p.v)}`).join(" ")}
                  fill="none"
                  stroke={s.stroke}
                  strokeDasharray={s.dash}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              ))}
              {s.points.map(
                (p) =>
                  p.v !== null && (
                    <circle key={p.n} cx={sx(p.n)} cy={sy(p.v)} r={an === p.n ? 5 : 3} fill="var(--surface)" stroke={s.stroke} strokeWidth={2} />
                  ),
              )}
            </g>
          ))}

        {kind === "bars" &&
          series[0].points.map(
            (p) =>
              p.v !== null && (
                <rect
                  key={p.n}
                  x={sx(p.n) - barW / 2}
                  width={barW}
                  y={Math.min(sy(p.v), sy(0))}
                  height={Math.max(1, Math.abs(sy(p.v) - sy(0)))}
                  fill={p.v >= 0 ? "var(--up)" : "var(--down)"}
                  opacity={an === null || an === p.n ? 1 : 0.55}
                />
              ),
          )}

        {an !== null && (
          <g pointerEvents="none">
            <line x1={sx(an)} x2={sx(an)} y1={M.t} y2={H - M.b} stroke="var(--ink-muted)" strokeDasharray="3 3" />
            <rect x={tipX} y={M.t + 4} width={tipW} height={tipH} rx={4} fill="var(--surface)" stroke="var(--rule)" />
            {tip.map((t, i) => (
              <text key={i} x={tipX + 8} y={M.t + 4 + 16 + i * 16 - 3} className={`${i === 0 ? "fill-ink-muted" : "figure fill-ink"} text-[11px]`}>
                {t}
              </text>
            ))}
          </g>
        )}
      </svg>
      {series.length > 1 && (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <svg width="26" height="8" aria-hidden>
                <line x1="0" x2="26" y1="4" y2="4" stroke={s.stroke} strokeWidth={2} strokeDasharray={s.dash} />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className="sr-only">
        {tip.join(", ")}
      </p>
    </div>
  );
}
