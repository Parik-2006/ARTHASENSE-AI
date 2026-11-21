"use client";

import { useCallback, useState } from "react";

export type ChartMode = "line" | "area" | "bar";

export interface ChartPoint {
  n: number; // month number
  label: string; // e.g. "Sep 2026"
  value: number | null;
  /** Optional second line (e.g. calculated 3-month average). */
  overlay?: number | null;
  tip: string[]; // extra tooltip lines
}

const HEIGHT = 300;
const M = { l: 56, r: 16, t: 16, b: 34 };

/** Dependency-free SVG chart for one metric over months. Missing values are real gaps (never
 *  zero, never interpolated). Bar mode draws a zero line and colours negatives differently. */
export function SeriesChart({
  points,
  mode,
  name,
  yLabel,
  digits = 2,
  suffix = "",
  overlayName,
}: {
  points: ChartPoint[];
  mode: ChartMode;
  name: string;
  yLabel: string;
  digits?: number;
  suffix?: string;
  overlayName?: string;
}) {
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setWidth(Math.max(280, Math.floor(el.clientWidth)));
    const ro = new ResizeObserver(() => setWidth(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = points.filter((p) => p.value !== null);
  if (data.length < 1) return null;

  const [n0, n1] = [Math.min(...points.map((p) => p.n)), Math.max(...points.map((p) => p.n))];
  const span = n1 - n0 + 1;
  const all = [...data.map((p) => p.value as number), ...points.flatMap((p) => (p.overlay == null ? [] : [p.overlay]))];
  let [lo, hi] = [Math.min(...all), Math.max(...all)];
  if (mode === "bar") [lo, hi] = [Math.min(lo, 0), Math.max(hi, 0)];
  const pad = (hi - lo) * 0.12 || 0.5;
  const [y0, y1] = [mode === "bar" && lo === 0 ? 0 : lo - pad, mode === "bar" && hi === 0 ? 0 : hi + pad];
  const plotW = width - M.l - M.r;
  const plotH = HEIGHT - M.t - M.b;
  const slot = plotW / Math.max(span, 1);
  const sx = (n: number) => M.l + (mode === "bar" ? (n - n0 + 0.5) * slot : span === 1 ? plotW / 2 : ((n - n0) / (span - 1)) * plotW);
  const sy = (v: number) => M.t + (1 - (v - y0) / (y1 - y0 || 1)) * plotH;

  const pts = data.map((p) => ({ ...p, x: sx(p.n), y: sy(p.value as number) }));
  const segs = (get: (p: ChartPoint) => number | null | undefined) => {
    const out: { x: number; y: number }[][] = [];
    let prev: number | null = null;
    for (const p of points) {
      const v = get(p);
      if (v == null) {
        prev = null;
        continue;
      }
      const pt = { x: sx(p.n), y: sy(v) };
      if (prev !== null && p.n - prev === 1) out[out.length - 1].push(pt);
      else out.push([pt]);
      prev = p.n;
    }
    return out;
  };
  const lineSegs = segs((p) => p.value);
  const overSegs = segs((p) => p.overlay);
  const yTicks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  const step = Math.max(1, Math.ceil(span / Math.max(1, Math.floor(plotW / 64))));
  const xTicks = points.filter((p) => (p.n - n0) % step === 0);
  const fmt = (v: number) => `${v.toFixed(digits)}${suffix}`;

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
    ? [a.label, `${name} ${fmt(a.value as number)}`, ...(a.overlay != null ? [`${overlayName} ${fmt(a.overlay)}`] : []), ...a.tip]
    : [];
  const tipW = 196;
  const tipH = 12 + lines.length * 16;
  const tipX = a ? (a.x + tipW + 12 > width - M.r ? a.x - tipW - 10 : a.x + 10) : 0;
  const tipY = a ? Math.min(Math.max(a.y - 28, M.t), HEIGHT - M.b - tipH) : 0;
  const areaBase = sy(y0 <= 0 && y1 >= 0 ? 0 : y0);
  const zeroY = y0 <= 0 && y1 >= 0 ? sy(0) : null;

  return (
    <div ref={measure} className="w-full min-w-0 overflow-hidden">
      <svg
        width={width}
        height={HEIGHT}
        role="group"
        tabIndex={0}
        aria-label={`${mode === "bar" ? "Bar" : "Line"} chart of ${name}, ${points[0].label} to ${points[points.length - 1].label}. Use left and right arrow keys to read each month. The same values are in the table below.`}
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
              {v.toFixed(digits > 1 ? 1 : digits)}
            </text>
          </g>
        ))}
        {zeroY !== null && (
          <line x1={M.l} x2={width - M.r} y1={zeroY} y2={zeroY} className="stroke-ink-muted" strokeWidth={1.25} data-testid="zero-line" />
        )}
        {xTicks.map((p) => (
          <text key={p.n} x={sx(p.n)} y={HEIGHT - M.b + 18} textAnchor="middle" className="figure fill-ink-muted text-[11px]">
            {p.label}
          </text>
        ))}
        <text transform={`translate(12 ${M.t + plotH / 2}) rotate(-90)`} textAnchor="middle" className="fill-ink-muted text-[11px]">
          {yLabel}
        </text>

        {mode === "bar" &&
          pts.map((p) => {
            const base = zeroY ?? sy(y0);
            const v = p.value as number;
            return (
              <rect
                key={p.n}
                data-testid="bar"
                x={p.x - Math.max(1, slot * 0.35)}
                width={Math.max(2, slot * 0.7)}
                y={Math.min(p.y, base)}
                height={Math.max(1, Math.abs(p.y - base))}
                className={v < 0 ? "fill-warn" : "fill-accent"}
                opacity={active === null || pts[active].n === p.n ? 1 : 0.6}
              />
            );
          })}
        {mode !== "bar" &&
          lineSegs.map((seg, i) => (
            <g key={i}>
              {mode === "area" && seg.length > 1 && (
                <polygon
                  points={`${seg[0].x},${areaBase} ${seg.map((p) => `${p.x},${p.y}`).join(" ")} ${seg[seg.length - 1].x},${areaBase}`}
                  className="fill-accent"
                  opacity={0.15}
                />
              )}
              <polyline points={seg.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" />
            </g>
          ))}
        {mode !== "bar" &&
          pts.map((p, i) => (
            <circle key={p.n} cx={p.x} cy={p.y} r={active === i ? 5.5 : pts.length > 36 ? 2 : 3.5} className="fill-surface stroke-accent" strokeWidth={2} />
          ))}
        {overSegs.map((seg, i) => (
          <polyline key={`o${i}`} points={seg.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" className="stroke-warn" strokeWidth={2} strokeDasharray="5 3" />
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
      <p aria-live="polite" className="sr-only">
        {a ? lines.join(", ") : ""}
      </p>
    </div>
  );
}
