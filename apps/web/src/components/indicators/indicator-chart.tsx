"use client";

import { useCallback, useState } from "react";
import { formatIndex, formatPercent, formatPeriod, monthNumber, type Row } from "@/lib/indicator";

const HEIGHT = 300;
const M = { l: 52, r: 16, t: 16, b: 34 };

interface Pt {
  x: number;
  y: number;
  row: Row;
  n: number;
}

/** Dependency-free SVG line chart. Months with no stored observation are left as real gaps. */
export function IndicatorChart({
  rows,
  axisLabel,
  name,
}: {
  rows: Row[];
  axisLabel: string;
  name: string;
}) {
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  // Callback ref: measure the container and follow resizes.
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setWidth(Math.max(280, Math.floor(el.clientWidth)));
    const ro = new ResizeObserver(() => setWidth(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = rows.filter((r) => r.index !== null);
  if (data.length < 2) return null; // the parent shows an explanatory message instead

  const ns = data.map((r) => monthNumber(r.period));
  const [n0, n1] = [Math.min(...ns), Math.max(...ns)];
  const vals = data.map((r) => r.index as number);
  const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
  const pad = (hi - lo) * 0.15 || 0.5;
  const [y0, y1] = [lo - pad, hi + pad];

  const plotW = width - M.l - M.r;
  const plotH = HEIGHT - M.t - M.b;
  const sx = (n: number) => M.l + ((n - n0) / (n1 - n0)) * plotW;
  const sy = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * plotH;

  const pts: Pt[] = data.map((row, i) => ({ x: sx(ns[i]), y: sy(row.index as number), row, n: ns[i] }));
  const segments: Pt[][] = [];
  for (const p of pts) {
    const last = segments[segments.length - 1];
    if (last && p.n - last[last.length - 1].n === 1) last.push(p);
    else segments.push([p]);
  }

  const yTicks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  const span = n1 - n0 + 1;
  const step = Math.max(1, Math.ceil(span / Math.max(1, Math.floor(plotW / 64))));
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
        formatPeriod(a.row.period, true),
        `${name} ${formatIndex(a.row.index)}`,
        `MoM ${a.row.mom === null ? "n/a" : formatPercent(a.row.mom, true)} (calc.)`,
      ]
    : [];
  const tipW = 168;
  const tipX = a ? (a.x + tipW + 12 > width - M.r ? a.x - tipW - 10 : a.x + 10) : 0;
  const tipY = a ? Math.min(Math.max(a.y - 28, M.t), HEIGHT - M.b - 56) : 0;

  return (
    <div ref={measure} className="w-full">
      <svg
        width={width}
        height={HEIGHT}
        role="group"
        tabIndex={0}
        aria-label={`Line chart of the ${name}, ${formatPeriod(data[0].period)} to ${formatPeriod(
          data[data.length - 1].period,
        )}. Use left and right arrow keys to read each month. The same values are in the table below.`}
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
            {formatPeriod(p.row.period)}
          </text>
        ))}
        <text transform={`translate(12 ${M.t + plotH / 2}) rotate(-90)`} textAnchor="middle" className="fill-ink-muted text-[11px]">
          {axisLabel}
        </text>

        {segments.map((seg, i) => (
          <polyline
            key={i}
            points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            className="stroke-accent"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {pts.map((p, i) => (
          <circle key={p.n} cx={p.x} cy={p.y} r={active === i ? 5.5 : 3.5} className="fill-surface stroke-accent" strokeWidth={2} />
        ))}

        {a && (
          <g pointerEvents="none">
            <line x1={a.x} x2={a.x} y1={M.t} y2={HEIGHT - M.b} className="stroke-ink-muted" strokeDasharray="3 3" />
            <rect x={tipX} y={tipY} width={tipW} height={56} rx={4} className="fill-surface stroke-rule" />
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
