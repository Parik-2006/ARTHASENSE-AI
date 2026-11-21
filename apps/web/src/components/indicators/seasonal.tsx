"use client";

import { useState } from "react";
import { type AnalysisRow, METRIC_LABEL, type MetricKey, seasonalLines } from "@/lib/analysis";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STYLE = [
  { c: "var(--accent)", d: undefined },
  { c: "var(--target)", d: "6 3" },
  { c: "var(--down)", d: "2 3" },
  { c: "var(--up)", d: "8 3 2 3" },
  { c: "var(--ok)", d: "1 3" },
  { c: "var(--demo)", d: "10 4" },
];
const W = 640;
const H = 260;
const M = { l: 48, r: 28, t: 12, b: 28 };

/** January-December overlay, one line per year, from a single series (one base year). Each year
 *  has its own dash pattern and an end label, so colour is never the only cue. */
export function SeasonalOverlay({ rows, metric, name }: { rows: AnalysisRow[]; metric: MetricKey; name: string }) {
  const lines = seasonalLines(rows, metric);
  const [active, setActive] = useState<{ year: number; month: number } | null>(null);
  const withData = lines.filter((l) => l.values.some((v) => v !== null));
  if (withData.length < 2) {
    return (
      <p className="rounded border border-dashed border-rule px-4 py-8 text-center text-sm text-ink-muted">
        A year-by-year overlay needs at least two calendar years with values for this metric. Choose a longer range or a
        different metric.
      </p>
    );
  }
  const all = withData.flatMap((l) => l.values.filter((v): v is number => v !== null));
  const [lo, hi] = [Math.min(...all), Math.max(...all)];
  const pad = (hi - lo) * 0.1 || 0.5;
  const [y0, y1] = [lo - pad, hi + pad];
  const sx = (m: number) => M.l + (m / 11) * (W - M.l - M.r);
  const sy = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * (H - M.t - M.b);
  const digits = metric === "index" ? 1 : 2;
  const ticks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  const info = active ? withData.find((l) => l.year === active.year)?.values[active.month] : null;
  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="group"
        aria-label={`${name} by calendar month, one line per year ${withData[0].year} to ${withData[withData.length - 1].year}`}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} className="stroke-rule" />
            <text x={M.l - 6} y={sy(v)} textAnchor="end" dominantBaseline="middle" className="figure fill-ink-muted text-[10px]">
              {v.toFixed(digits)}
            </text>
          </g>
        ))}
        {MONTHS.map((m, i) => (
          <text key={m} x={sx(i)} y={H - 8} textAnchor="middle" className="fill-ink-muted text-[10px]">
            {m}
          </text>
        ))}
        {withData.map((l, k) => {
          const st = STYLE[k % STYLE.length];
          const segs: [number, number][][] = [];
          l.values.forEach((v, m) => {
            if (v === null) return;
            const pt: [number, number] = [sx(m), sy(v)];
            if (m > 0 && l.values[m - 1] !== null) segs[segs.length - 1].push(pt);
            else segs.push([pt]);
          });
          const lastM = l.values.map((v) => v !== null).lastIndexOf(true);
          return (
            <g key={l.year}>
              {segs.map((s, i) => (
                <polyline key={i} points={s.map((p) => p.join(",")).join(" ")} fill="none" stroke={st.c} strokeWidth={2} strokeDasharray={st.d} />
              ))}
              {l.values.map((v, m) =>
                v === null ? null : (
                  <circle
                    key={m}
                    data-testid="season-point"
                    cx={sx(m)}
                    cy={sy(v)}
                    r={active?.year === l.year && active.month === m ? 5 : 3}
                    fill="var(--surface)"
                    stroke={st.c}
                    strokeWidth={1.5}
                    tabIndex={0}
                    aria-label={`${l.year} ${MONTHS[m]}: ${v.toFixed(digits)}`}
                    onPointerEnter={() => setActive({ year: l.year, month: m })}
                    onFocus={() => setActive({ year: l.year, month: m })}
                    onPointerLeave={() => setActive(null)}
                    onBlur={() => setActive(null)}
                  />
                ),
              )}
              <text x={sx(lastM) + 5} y={sy(l.values[lastM] as number) - 5} className="figure text-[10px]" fill={st.c}>
                {l.year}
              </text>
            </g>
          );
        })}
      </svg>
      <p aria-live="polite" className="mt-1 min-h-4 text-xs text-ink-muted">
        {active && info != null
          ? `${active.year} ${MONTHS[active.month]}: ${info.toFixed(digits)} (${METRIC_LABEL[metric]})`
          : "Hover or focus a point to read it."}
      </p>
    </div>
  );
}
