"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Help } from "@/components/artha/help";
import { type ChartMode, type ChartPoint, SeriesChart } from "@/components/indicators/series-chart";
import {
  type AnalysisRow,
  checkCustomRange,
  type CustomRange,
  type FilterState,
  heatmapRows,
  METRIC_LABEL,
  type MetricKey,
  metricValue,
  movingAverage3,
  parseFilters,
  presetShortfall,
  RANGE_KEYS,
  type RangeKey,
  resolveWindow,
  seedCustom,
  serializeFilters,
} from "@/lib/analysis";
import { formatPeriod, missingMonths, monthNumber } from "@/lib/indicator";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const chip = (on: boolean) =>
  `rounded border px-3 py-1 text-sm ${focusRing} ${on ? "border-accent bg-accent text-accent-ink" : "border-rule hover:bg-bg"}`;

/** Filter state kept in the URL (?range=&metric=&from=&to=) so refresh, Back/Forward and shared
 *  links reproduce the same view. Invalid values fall back to defaults. */
export function useFilterState(allowedMetrics: MetricKey[]): [FilterState, (patch: Partial<FilterState>) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = useMemo(
    () => parseFilters((k) => params?.get(k) ?? null, allowedMetrics),
    [params, allowedMetrics],
  );
  const set = useCallback(
    (patch: Partial<FilterState>) => {
      const next = { ...state, ...patch };
      // Keep unrelated parameters (e.g. ?base= for the chosen series); only the filter keys are rewritten.
      const merged = new URLSearchParams(params?.toString() ?? "");
      for (const k of ["range", "metric", "from", "to"]) merged.delete(k);
      serializeFilters(next).forEach((v, k) => merged.set(k, v));
      const qs = merged.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      // A new preset/metric is a navigation step (Back undoes it); typing month values only refines the current step.
      const refine = patch.custom !== undefined && patch.range === undefined;
      if (refine) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [state, router, pathname, params],
  );
  return [state, set];
}

export function FilterBar({
  filters,
  onChange,
  metrics,
  rows,
  mode,
  onMode,
  modes,
  lastMonth,
}: {
  filters: FilterState;
  onChange: (p: Partial<FilterState>) => void;
  metrics: MetricKey[];
  rows: AnalysisRow[];
  mode: ChartMode;
  onMode: (m: ChartMode) => void;
  modes: ChartMode[];
  lastMonth: string | null; // "YYYY-MM"
}) {
  const fromUrl: CustomRange = filters.custom ?? { start: "", end: "" };
  // Local draft so two quick edits (start, then end) never overwrite each other while the URL catches up.
  const [draft, setDraft] = useState<CustomRange>(fromUrl);
  const [seen, setSeen] = useState(JSON.stringify(fromUrl));
  if (JSON.stringify(fromUrl) !== seen) {
    setSeen(JSON.stringify(fromUrl)); // URL changed (Back/Forward, link): follow it
    setDraft(fromUrl);
  }
  const custom = draft;
  const edit = (patch: Partial<CustomRange>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange({ custom: next });
  };
  const check = filters.range === "Custom" ? checkCustomRange(filters.custom, rows) : null;
  return (
    <div className="mb-4 space-y-3">
      <div role="group" aria-label="Time range" className="flex flex-wrap items-center gap-2">
        {RANGE_KEYS.map((k: RangeKey) => (
          <button
            key={k}
            type="button"
            aria-pressed={filters.range === k}
            onClick={() => onChange({ range: k, custom: k === "Custom" ? (filters.custom ?? seedCustom(rows)) : null })}
            className={chip(filters.range === k)}
          >
            {k === "All" ? "All available" : k}
          </button>
        ))}
        <Help topic="range" />
      </div>
      {filters.range === "Custom" && (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">Start month</span>
            <input
              type="month"
              value={custom.start}
              max={lastMonth ?? undefined}
              onChange={(e) => edit({ start: e.target.value })}
              className={`rounded border border-rule bg-surface px-2 py-1 ${focusRing}`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">End month</span>
            <input
              type="month"
              value={custom.end}
              max={lastMonth ?? undefined}
              onChange={(e) => edit({ end: e.target.value })}
              className={`rounded border border-rule bg-surface px-2 py-1 ${focusRing}`}
            />
          </label>
          {check && !check.ok && (
            <p role="alert" className="text-xs text-warn">
              {check.error}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {metrics.length > 1 && (
        <div role="group" aria-label="Metric" className="flex flex-wrap items-center gap-2">
          {metrics.map((m) => (
            <button key={m} type="button" aria-pressed={filters.metric === m} onClick={() => onChange({ metric: m })} className={chip(filters.metric === m)}>
              {METRIC_LABEL[m]}
            </button>
          ))}
          <Help topic={filters.metric === "index" ? "index" : filters.metric === "mom" ? "mom" : filters.metric === "yoy" ? "yoy" : "official"} />
        </div>
        )}
        {modes.length > 1 && (
          <div role="group" aria-label="Chart type" className="flex items-center gap-2">
            {modes.map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)} className={chip(mode === m)}>
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Chart modes that are mathematically sensible per metric. Bars for index levels would hide the
 *  truncated axis, so they are not offered. */
export function modesFor(metric: MetricKey): ChartMode[] {
  return metric === "index" ? ["line", "area"] : ["bar", "line"];
}

export function metricMeta(metric: MetricKey, shortName: string, baseYear: string) {
  if (metric === "index") return { digits: 2, suffix: "", yLabel: `${shortName} index (${baseYear} = 100)`, name: `${shortName} index` };
  const word = metric === "mom" ? "Month-over-month" : metric === "yoy" ? "Year-over-year" : "Official year-on-year";
  return { digits: 2, suffix: "%", yLabel: `${word} change (%)`, name: `${word} %` };
}

export function ExplorerChart({
  rows,
  filters,
  mode,
  shortName,
  baseYear,
  showAverage,
}: {
  rows: AnalysisRow[]; // already windowed
  filters: FilterState;
  mode: ChartMode;
  shortName: string;
  baseYear: string;
  showAverage: boolean;
}) {
  const meta = metricMeta(filters.metric, shortName, baseYear);
  const ma = useMemo(() => (showAverage ? movingAverage3(rows, filters.metric) : null), [rows, filters.metric, showAverage]);
  const points: ChartPoint[] = rows.map((r, i) => ({
    n: monthNumber(r.period),
    label: formatPeriod(r.period),
    value: metricValue(r, filters.metric),
    overlay: ma ? ma[i] : undefined,
    tip: [`Base ${baseYear}`],
  }));
  const plottable = points.filter((p) => p.value !== null).length;
  if (plottable === 0) {
    return (
      <p className="rounded border border-dashed border-rule px-4 py-10 text-center text-sm text-ink-muted">
        {filters.metric === "index"
          ? "No observations in this range."
          : `No ${METRIC_LABEL[filters.metric]} values are available in this range. They need the reference month (previous month, or the same month a year earlier) to be stored.`}
      </p>
    );
  }
  if (mode !== "bar" && plottable < 2 && filters.metric === "index") {
    return (
      <p className="rounded border border-dashed border-rule px-4 py-10 text-center text-sm text-ink-muted">
        Not enough observations in this range to draw a trend ({plottable} stored). Choose a longer range.
      </p>
    );
  }
  return (
    <SeriesChart
      points={points}
      mode={mode}
      name={meta.name}
      yLabel={meta.yLabel}
      digits={meta.digits}
      suffix={meta.suffix}
      overlayName="3-month avg (calc.)"
    />
  );
}

/** Year x month grid. Colour strength = |value| relative to the largest |value| shown; hue =
 *  sign (teal up, amber down) and the number is printed in the cell, so colour is never the only cue. */
export function Heatmap({ rows, metric }: { rows: AnalysisRow[]; metric: Exclude<MetricKey, "index"> }) {
  const { years, cells } = useMemo(() => heatmapRows(rows, metric), [rows, metric]);
  const max = Math.max(0.0001, ...cells.flat().map((c) => (c.value === null ? 0 : Math.abs(c.value))));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!years.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-separate border-spacing-0.5 text-center text-[11px]">
        <caption className="sr-only">
          Heatmap of {METRIC_LABEL[metric]} by year and month. Empty cells are months with no available value.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-12" />
            {MONTHS.map((m) => (
              <th key={m} scope="col" className="font-medium text-ink-muted">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.map((row, i) => (
            <tr key={years[i]}>
              <th scope="row" className="text-left font-medium text-ink-muted">
                {years[i]}
              </th>
              {row.map((c) => {
                const v = c.value;
                const alpha = v === null ? 0 : 0.12 + 0.7 * (Math.abs(v) / max);
                return (
                  <td
                    key={c.month}
                    tabIndex={v === null ? undefined : 0}
                    title={v === null ? `${MONTHS[c.month]} ${c.year}: not available` : `${MONTHS[c.month]} ${c.year}: ${v.toFixed(2)}%`}
                    aria-label={v === null ? `${MONTHS[c.month]} ${c.year}: not available` : `${MONTHS[c.month]} ${c.year}: ${v.toFixed(2)} percent`}
                    className={`figure h-8 rounded-sm ${v === null ? "border border-dashed border-rule text-ink-muted" : "text-ink"} ${focusRing}`}
                    style={v === null ? undefined : { backgroundColor: `color-mix(in srgb, var(${v < 0 ? "--warn" : "--accent"}) ${Math.round(alpha * 100)}%, transparent)` }}
                  >
                    {v === null ? "·" : v.toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-muted">
        Legend: stronger colour = larger absolute change within this view (max {max.toFixed(2)}%). Teal = rise,
        amber = fall. Dotted cell = month not available (not zero).
      </p>
    </div>
  );
}

export function RangeNotes({
  rows,
  windowRows,
  range,
  metric,
  isIip,
}: {
  rows: AnalysisRow[];
  windowRows: AnalysisRow[];
  range: RangeKey;
  metric: MetricKey;
  isIip: boolean;
}) {
  const gaps = missingMonths(windowRows);
  const short = presetShortfall(rows, range);
  const win = resolveWindow(rows, range);
  return (
    <div className="mt-3 space-y-1 text-xs">
      {win && windowRows.length > 0 && (
        <p className="text-ink-muted">
          Showing {windowRows.length} stored {windowRows.length === 1 ? "month" : "months"}:{" "}
          {formatPeriod(windowRows[0].period)} – {formatPeriod(windowRows[windowRows.length - 1].period)}.
          Presets end at this series&apos; own latest stored month.
        </p>
      )}
      {short > 0 && (
        <p className="text-warn">
          {range} was requested but only {rows.length} stored months exist ({short} months short). The full stored
          history is shown.
        </p>
      )}
      {gaps.length > 0 && (
        <p className="text-warn">
          No stored observation for: {gaps.join(", ")}. These months are left blank, not estimated.
        </p>
      )}
      {isIip && metric === "mom" && (
        <p role="note" className="rounded border border-warn px-2 py-1 text-warn">
          Seasonality warning: IIP is not seasonally adjusted, so many month-to-month swings are seasonal rather than
          real changes in output. Prefer the official year-on-year growth. This calculated value is not official
          industrial growth.
        </p>
      )}
    </div>
  );
}
