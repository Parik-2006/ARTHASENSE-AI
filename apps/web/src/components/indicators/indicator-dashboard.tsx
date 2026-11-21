"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState, useTransition } from "react";
import { Help } from "@/components/artha/help";
import { SourceAttribution } from "@/components/source/source-attribution";
import { ExplorerChart, FilterBar, Heatmap, modesFor, RangeNotes, useFilterState } from "@/components/indicators/explorer";
import { SeasonalOverlay } from "@/components/indicators/seasonal";
import { IndicatorChart } from "@/components/indicators/indicator-chart";
import type { ChartMode } from "@/components/indicators/series-chart";
import { Panel } from "@/components/ui/primitives";
import { type AnalysisRow, inWindow, type MetricKey, METRIC_KEYS, METRIC_LABEL, resolveWindow, toCsvV2, withDerived } from "@/lib/analysis";
import { toForecastQuery } from "@/lib/forecast-v2";
import { FORMULA, seriesIds, sourceFor } from "@/lib/source";
import {
  distinctSnapshots,
  filterRange,
  formatIndex,
  formatPercent,
  formatPeriod,
  formatTimestamp,
  type IndicatorResult,
  lastRetrievedAt,
  latestObservation,
  latestRate,
  missingMonths,
  RANGES,
  type RangeKey,
  type Row,
} from "@/lib/indicator";
import type { IndicatorConfig } from "@/lib/indicators";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
export const buttonClass = `rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg ${focusRing}`;

function useRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return { pending, refresh: () => start(() => router.refresh()) };
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  const missing = value === "Not available";
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-rule bg-surface p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`figure font-medium tracking-tight ${missing ? "text-xl text-ink-muted" : "text-3xl"}`}>
        {value}
      </p>
      <p className="text-xs text-ink-muted">{sub}</p>
    </div>
  );
}

export function IndicatorSkeleton() {
  return (
    <div role="status" aria-label="Loading data" className="animate-pulse space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-md border border-rule bg-surface" />
        ))}
      </div>
      <div className="h-80 rounded-md border border-rule bg-surface" />
      <div className="h-64 rounded-md border border-rule bg-surface" />
    </div>
  );
}

/** Time-range buttons + chart (or an honest "not enough data" message) + gap notice. */
export function TrendChart({
  rows,
  axisLabel,
  name,
  range: controlledRange,
  onRangeChange,
}: {
  rows: Row[];
  axisLabel: string;
  name: string;
  /** Pass both to control the range from outside (so a table can follow the chart). */
  range?: RangeKey;
  onRangeChange?: (r: RangeKey) => void;
}) {
  const [innerRange, setInnerRange] = useState<RangeKey>("All");
  const range = controlledRange ?? innerRange;
  const setRange = onRangeChange ?? setInnerRange;
  const visible = useMemo(() => filterRange(rows, range), [rows, range]);
  const plottable = visible.filter((r) => r.index !== null).length;
  const gaps = missingMonths(visible);
  return (
    <>
      <div role="group" aria-label="Time range" className="mb-4 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={range === r.key}
            onClick={() => setRange(r.key)}
            className={`rounded border px-3 py-1 text-sm ${focusRing} ${
              range === r.key ? "border-accent bg-accent text-accent-ink" : "border-rule hover:bg-bg"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {plottable < 2 ? (
        <p className="rounded border border-dashed border-rule px-4 py-10 text-center text-sm text-ink-muted">
          Not enough observations in this range to draw a trend ({plottable} stored). Choose a longer range.
        </p>
      ) : (
        <IndicatorChart rows={visible} axisLabel={axisLabel} name={name} />
      )}
      {gaps.length > 0 && (
        <p className="mt-3 text-xs text-warn">
          No stored observation for: {gaps.join(", ")}. These months are left blank, not estimated.
        </p>
      )}
      {rows.length < 12 && range !== "All" && (
        <p className="mt-2 text-xs text-ink-muted">Only {rows.length} months are stored in total.</p>
      )}
    </>
  );
}

type TableSort = "period" | "index" | "mom" | "yoy" | "rate";

/** Stable sort; missing values always go last, whatever the direction. */
function sortAnalysis(rows: AnalysisRow[], key: TableSort, dir: "asc" | "desc"): AnalysisRow[] {
  const val = (r: AnalysisRow) => (key === "period" ? r.period : key === "index" ? r.index : key === "mom" ? r.mom : key === "yoy" ? r.yoy : r.rate);
  return [...rows].sort((a, b) => {
    const [x, y] = [val(a), val(b)];
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * (dir === "asc" ? 1 : -1);
  });
}

export function IndicatorDashboard({
  config,
  result,
  children,
}: {
  config: IndicatorConfig;
  result: IndicatorResult;
  /** Extra panels (e.g. IIP sector breakdown) shown between the chart and the table. */
  children?: ReactNode;
}) {
  const { pending, refresh } = useRefresh();
  const hasOfficial = config.rateColumn !== null;
  const metrics = useMemo<MetricKey[]>(() => (hasOfficial ? METRIC_KEYS : METRIC_KEYS.filter((m) => m !== "official")), [hasOfficial]);
  const [filters, setFilters] = useFilterState(metrics);
  const [chartMode, setChartMode] = useState<ChartMode | null>(null);
  const [average, setAverage] = useState(false);
  const [heatMetric, setHeatMetric] = useState<"mom" | "yoy">("yoy");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: TableSort; dir: "asc" | "desc" }>({ key: "period", dir: "desc" });

  // Derived metrics are computed on the FULL stored series, then cut to the window (lookback).
  const rows = useMemo(() => (result.ok ? withDerived(result.data.observations) : []), [result]);
  const window = useMemo(() => resolveWindow(rows, filters.range, filters.custom), [rows, filters.range, filters.custom]);
  const visible = useMemo(() => inWindow(rows, window), [rows, window]);
  const modes = modesFor(filters.metric);
  const mode: ChartMode = chartMode && modes.includes(chartMode) ? chartMode : modes[0];
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? visible.filter((r) => formatPeriod(r.period, true).toLowerCase().includes(q) || r.period.includes(q)) : visible;
    return sortAnalysis(filtered, sort.key, sort.dir);
  }, [visible, search, sort]);

  if (!result.ok) {
    return (
      <div role="alert" className="rounded-md border border-up bg-surface px-6 py-10 text-center">
        <p className="font-serif text-xl font-semibold">Unable to load {config.shortName} data. Please check the API connection.</p>
        <p className="figure mt-2 text-xs text-ink-muted">{result.error}</p>
        <button type="button" onClick={refresh} disabled={pending} className={`${buttonClass} mt-5`}>
          {pending ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }

  const { data } = result;
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-rule bg-surface px-6 py-10 text-center">
        <p className="font-serif text-xl font-semibold">{config.empty}</p>
        <p className="mt-2 text-sm text-ink-muted">Once data is imported it will appear here automatically.</p>
        <button type="button" onClick={refresh} disabled={pending} className={`${buttonClass} mt-5`}>
          {pending ? "Checking…" : "Check again"}
        </button>
      </div>
    );
  }

  const latest = latestObservation(rows);
  const latestRow = rows.find((r) => r.period === latest?.period);
  const rate = latestRate(rows);
  const retrieved = lastRetrievedAt(rows);
  const snapshots = distinctSnapshots(rows);
  const cards: Record<"index" | "mom" | "rate" | "period", { label: string; value: string; sub: string }> = {
    index: {
      label: config.indexCard,
      value: formatIndex(latest?.index ?? null),
      sub: `Base ${data.baseYear} = 100 · Source: ${config.sourceShort}`,
    },
    mom: {
      label: "Month-over-Month Change",
      value: formatPercent(latestRow?.mom ?? null, true),
      sub:
        latestRow?.mom == null
          ? "Needs the previous calendar month; it is missing from the stored data."
          : "Calculated from consecutive index values. Not an official rate.",
    },
    rate: {
      label: config.rateCard ?? "Official year-over-year rate",
      value: rate ? formatPercent(rate.rate, config.rateSigned) : "Not available",
      sub: rate ? `Official figure for ${formatPeriod(rate.period, true)}` : config.rateMissingText,
    },
    period: {
      label: "Latest Observation Period",
      value: latest ? formatPeriod(latest.period, true) : "Not available",
      sub: `${rows.length} monthly observations stored · base year ${data.baseYear}`,
    },
  };

  const src = sourceFor(config, data);
  const span = visible.length ? `${formatPeriod(visible[0].period)} – ${formatPeriod(visible[visible.length - 1].period)}` : "no observations";
  const attribution = (metric: MetricKey, ma: boolean) => {
    const calc = ma || metric === "mom" || metric === "yoy";
    const method = ma ? FORMULA.ma3 : metric === "mom" ? FORMULA.mom : metric === "yoy" ? FORMULA.yoy : undefined;
    return (
      <SourceAttribution
        cls={calc ? "calculated" : "official"}
        sources={[src]}
        period={span}
        units={metric === "index" ? `Index, base ${data.baseYear} = 100` : metric === "official" ? "% year-on-year, as published" : "% change (calculated from the index)"}
        method={method}
        note={calc ? "Calculated from the official index values listed above. It is not an official rate." : undefined}
      />
    );
  };

  const sortBtn = (key: TableSort, label: string) => {
    const on = sort.key === key;
    return (
      <button
        type="button"
        className={`inline-flex items-center gap-1 font-semibold ${focusRing}`}
        onClick={() => setSort({ key, dir: on && sort.dir === "desc" ? "asc" : "desc" })}
      >
        {label}
        <span aria-hidden className="text-ink-muted">
          {on ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    );
  };
  const ariaSort = (key: string) => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none");

  const download = () => {
    const csv = toCsvV2(sorted, {
      source: config.sourceShort,
      indexColumn: config.indexCsvColumn,
      officialColumn: config.rateCsvColumn,
      baseYear: data.baseYear,
      seriesId: seriesIds(config.key, data.baseYear)[0],
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `india-${config.key}-${data.baseYear}-${filters.range.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
        <p>
          Data last retrieved:{" "}
          <span className="figure text-ink">{retrieved ? formatTimestamp(retrieved) : "Unknown"}</span>{" "}
          <span className="text-xs">(our download time, not the official publication time)</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/forecasting/${config.key}${toForecastQuery({ range: filters.range, custom: filters.custom })}`} className={`${buttonClass} text-accent`}>
            {config.shortName} forecasts →
          </Link>
          <button type="button" onClick={refresh} disabled={pending} className={buttonClass}>
            {pending ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <section aria-label={`${config.shortName} overview`} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {config.cardOrder.map((k) => (
          <Card key={k} {...cards[k]} />
        ))}
      </section>

      <Panel title={config.chartTitle} footnote={attribution(filters.metric, average)}>
        <p className="-mt-1 mb-3 text-sm text-ink-muted">
          {data.coverage} · Base {data.baseYear} <Help topic="baseYear" />
        </p>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          metrics={metrics}
          rows={rows}
          mode={mode}
          onMode={setChartMode}
          modes={modes}
          lastMonth={latest ? latest.period.slice(0, 7) : null}
        />
        {filters.range === "Custom" && !window ? (
          <p className="rounded border border-dashed border-rule px-4 py-10 text-center text-sm text-ink-muted">
            Choose a valid start and end month to see this range.
          </p>
        ) : (
          <ExplorerChart rows={visible} filters={filters} mode={mode} shortName={config.shortName} baseYear={data.baseYear} showAverage={average} />
        )}
        <label className="mt-3 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={average} onChange={(e) => setAverage(e.target.checked)} />
          Show 3-month moving average (calculated)
          <Help topic="movingAverage" />
        </label>
        {filters.metric === "index" && (
          <p className="mt-2 text-xs text-ink-muted">The vertical axis does not start at zero. Gaps in the line are months with no stored observation.</p>
        )}
        <RangeNotes rows={rows} windowRows={visible} range={filters.range} metric={filters.metric} isIip={config.key === "iip"} />
      </Panel>

      {children}

      <Panel
        title={`Monthly heatmap · ${config.shortName}`}
        footnote={attribution(heatMetric, false)}
      >
        <div role="group" aria-label="Heatmap metric" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {(["yoy", "mom"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={heatMetric === m} onClick={() => setHeatMetric(m)}
              className={`rounded border px-3 py-1 ${heatMetric === m ? "border-accent bg-accent text-accent-ink" : "border-rule hover:bg-bg"}`}>
              {m === "yoy" ? "Year-over-year % (calculated)" : "Month-over-month % (calculated)"}
            </button>
          ))}
          <Help topic="heatmap" />
        </div>
        <Heatmap rows={visible} metric={heatMetric} />
      </Panel>

      <Panel title={`Year-by-year overlay · ${config.shortName}`} footnote={attribution(filters.metric, false)}>
        <p className="-mt-1 mb-3 text-sm text-ink-muted">
          Each line is one calendar year, January to December, for the metric chosen above ({METRIC_LABEL[filters.metric]}). All lines
          come from the same series and base year ({data.baseYear}). <Help topic="seasonal" />
        </p>
        <SeasonalOverlay rows={visible} metric={filters.metric} name={`${config.shortName} ${METRIC_LABEL[filters.metric]}`} />
        {config.key === "iip" && (
          <p className="mt-2 text-xs text-warn">
            IIP is not seasonally adjusted: repeating month-by-month patterns here are partly seasonal, not real changes in output.
          </p>
        )}
      </Panel>

      <Panel title="Observations">
        <div className="-mt-1 mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">
            {sorted.length} {sorted.length === 1 ? "month" : "months"} shown (follows the chart range; the CSV contains exactly these rows). MoM and YoY are calculated
            {hasOfficial ? "; the year-on-year column is official where available." : "."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="month-search">Search by reporting month</label>
            <input
              id="month-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search month, e.g. Mar 2025"
              className={`rounded border border-rule bg-surface px-2 py-1.5 text-sm ${focusRing}`}
            />
            <button type="button" onClick={download} className={buttonClass}>
              Download CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">
              Monthly {config.indexName} observations, {data.coverage}, base {data.baseYear}
            </caption>
            <thead>
              <tr className="border-b border-rule text-left text-xs">
                <th scope="col" aria-sort={ariaSort("period")} className="py-2 pr-4">
                  {sortBtn("period", "Period")}
                </th>
                <th scope="col" aria-sort={ariaSort("index")} className="py-2 pr-4 text-right">
                  {sortBtn("index", config.indexName)}
                </th>
                <th scope="col" aria-sort={ariaSort("mom")} className="py-2 pr-4 text-right">
                  {sortBtn("mom", "MoM change (calc.)")}
                </th>
                <th scope="col" aria-sort={ariaSort("yoy")} className="py-2 pr-4 text-right">
                  {sortBtn("yoy", "YoY change (calc.)")}
                </th>
                {hasOfficial && (
                  <th scope="col" aria-sort={ariaSort("rate")} className="py-2 pr-4 text-right">
                    {sortBtn("rate", config.rateColumn ?? "")}
                  </th>
                )}
                <th scope="col" className="py-2 font-semibold">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.period} className="border-b border-rule last:border-b-0">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">
                    {formatPeriod(r.period, true)}
                  </th>
                  <td className="figure py-2 pr-4 text-right">{formatIndex(r.index)}</td>
                  <td className="figure py-2 pr-4 text-right">
                    {r.mom === null ? (
                      <span className="text-ink-muted" title="Previous month not stored">
                        —
                      </span>
                    ) : (
                      formatPercent(r.mom, true)
                    )}
                  </td>
                  <td className="figure py-2 pr-4 text-right">
                    {r.yoy === null ? (
                      <span className="text-ink-muted" title="Same month one year earlier is not stored">
                        —
                      </span>
                    ) : (
                      formatPercent(r.yoy, true)
                    )}
                  </td>
                  {hasOfficial && (
                    <td className="figure py-2 pr-4 text-right">
                      {r.rate === null ? (
                        <span className="text-ink-muted" title="Not provided by the source">
                          —
                        </span>
                      ) : (
                        formatPercent(r.rate, config.rateSigned)
                      )}
                    </td>
                  )}
                  <td className="py-2 text-ink-muted">
                    {config.sourceShort} · base {data.baseYear}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasOfficial && sorted.every((r) => r.rate === null) && (
          <p className="mt-3 text-xs text-ink-muted">
            {config.rateMissingText} “—” means not provided, not zero.
          </p>
        )}
      </Panel>

      <Panel title="Data Source & Methodology">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-ink-muted">Source</dt>
          <dd>{config.publisher}</dd>
          <dt className="text-ink-muted">Dataset</dt>
          <dd>
            {config.dataset}, base year {data.baseYear}
          </dd>
          <dt className="text-ink-muted">Coverage</dt>
          <dd>{data.coverage}</dd>
          <dt className="text-ink-muted">Retrieved</dt>
          <dd>
            From the official MoSPI API; last at{" "}
            <span className="figure">{retrieved ? formatTimestamp(retrieved) : "unknown"}</span>. Official
            publication time: <span className="text-ink-muted">not provided by the API, so not shown.</span>
          </dd>
          <dt className="text-ink-muted">Snapshots in view</dt>
          <dd>
            {snapshots.map((s) => (
              <span key={s.releaseKey} className="figure block break-all text-xs">
                {s.releaseKey}
              </span>
            ))}
            <span className="text-xs text-ink-muted">Each month uses the most recently retrieved snapshot.</span>
          </dd>
        </dl>
        <div className="mt-4 space-y-2 border-t border-rule pt-4">
          {config.definitions.map((d) => (
            <details key={d.term} className="text-sm">
              <summary className={`cursor-pointer font-medium ${focusRing}`}>{d.term}</summary>
              <p className="mt-1 text-ink-muted">{d.text}</p>
            </details>
          ))}
          {[...config.limits, ...data.limitations].length > 0 && (
            <details className="text-sm">
              <summary className={`cursor-pointer font-medium ${focusRing}`}>Known limitations</summary>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">
                {[...new Set([...config.limits, ...data.limitations])].map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Panel>

      <Panel title="Research transparency">
        <p className="text-sm text-ink-muted">
          ArthaSense AI uses official economic data. This {config.shortName} module shows historical data only.
          Forecasting and model comparisons are separate future capabilities, and no forecast accuracy is claimed
          until evaluations have been completed and published.
        </p>
      </Panel>
    </div>
  );
}
