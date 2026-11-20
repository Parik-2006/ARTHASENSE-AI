"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState, useTransition } from "react";
import { IndicatorChart } from "@/components/indicators/indicator-chart";
import { Panel } from "@/components/ui/primitives";
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
  type SortKey,
  sortRows,
  toCsv,
  withMomChange,
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
  const [range, setRange] = useState<RangeKey>("All");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "period",
    dir: "desc",
  });

  const rows = useMemo(() => (result.ok ? withMomChange(result.data.observations) : []), [result]);
  const visible = useMemo(() => filterRange(rows, range), [rows, range]);
  const sorted = useMemo(() => sortRows(visible, sort.key, sort.dir), [visible, sort]);

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
  const hasRate = config.rateCard !== null;
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

  const sortBtn = (key: SortKey, label: string) => {
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
    const csv = toCsv(sorted, {
      source: config.sourceShort,
      indexColumn: config.indexCsvColumn,
      rateColumn: config.rateCsvColumn,
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `india-${config.key}-${data.baseYear}-${range.toLowerCase()}.csv`;
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
        <button type="button" onClick={refresh} disabled={pending} className={buttonClass}>
          {pending ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <section aria-label={`${config.shortName} overview`} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {config.cardOrder.map((k) => (
          <Card key={k} {...cards[k]} />
        ))}
      </section>

      <Panel
        title={config.chartTitle}
        footnote="The vertical axis does not start at zero. Gaps in the line are months with no stored observation."
      >
        <p className="-mt-1 mb-3 text-sm text-ink-muted">
          {data.coverage} · Base {data.baseYear}
        </p>
        <TrendChart
          rows={rows}
          axisLabel={`${config.shortName} index (${data.baseYear} = 100)`}
          name={config.indexName}
          range={range}
          onRangeChange={setRange}
        />
      </Panel>

      {children}

      <Panel title="Observations">
        <div className="-mt-1 mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">
            {sorted.length} {sorted.length === 1 ? "month" : "months"} shown (follows the chart range). MoM is calculated
            {hasRate ? "; the year-on-year column is official where available." : "."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
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
                {hasRate && (
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">
                    {config.rateColumn}
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
                  {hasRate && (
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
                  <td className="py-2 text-ink-muted">{config.sourceShort}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasRate && sorted.every((r) => r.rate === null) && (
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
