"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Help } from "@/components/artha/help";
import { SourceAttribution } from "@/components/artha/source-attribution";
import { Tour, INDICATOR_TOUR } from "@/components/artha/tour";
import { useFilterState } from "@/components/indicators/explorer";
import { Sparkline } from "@/components/indicators/indicator-summary";
import { SeriesChart } from "@/components/indicators/series-chart";
import { StatusPill, type StatusTone } from "@/components/ui/primitives";
import {
  clipToWindow,
  commonWindow,
  inWindow,
  latestWithMetric,
  METRIC_LABEL,
  type MetricKey,
  RANGE_KEYS,
  resolveWindow,
  serializeFilters,
  withDerived,
} from "@/lib/analysis";
import type { GuideKey } from "@/lib/guide";
import {
  formatIndex,
  formatPercent,
  formatPeriod,
  type IndicatorResult,
  lastRetrievedAt,
  latestObservation,
  missingMonths,
  monthNumber,
} from "@/lib/indicator";
import type { IndicatorConfig } from "@/lib/indicators";
import { calculatedItem, FORMULA, officialItem, seriesId, type SourceItem } from "@/lib/provenance";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const chip = (on: boolean) =>
  `rounded border px-3 py-1 text-sm ${focusRing} ${on ? "border-accent bg-accent text-accent-ink" : "border-rule hover:bg-bg"}`;

export interface OverviewEntry {
  config: IndicatorConfig;
  result: IndicatorResult;
}

const PLAIN: Record<string, { name: string; text: string; help: GuideKey }> = {
  cpi: { name: "Consumer Price Index", text: "What households pay for a basket of goods and services.", help: "indicators" },
  wpi: { name: "Wholesale Price Index", text: "What traders pay for goods in bulk, before they reach shops.", help: "indicators" },
  iip: { name: "Index of Industrial Production", text: "How much India's mines, factories and power plants produce.", help: "indicators" },
};

function status(result: IndicatorResult): { tone: StatusTone; text: string } {
  if (!result.ok) return { tone: "down", text: "API unavailable" };
  if (!latestObservation(result.data.observations)) return { tone: "warn", text: "No data imported" };
  return { tone: "ok", text: "Available" };
}

function sourceFor(entry: OverviewEntry): SourceItem[] {
  const { config, result } = entry;
  if (!result.ok || !latestObservation(result.data.observations)) return [];
  const obs = result.data.observations;
  const latest = latestObservation(obs)!;
  return [
    officialItem({
      label: `${config.shortName} index`,
      publisher: config.publisher,
      dataset: config.dataset,
      seriesId: seriesId(config.key, result.data.baseYear, "index"),
      coverage: result.data.coverage,
      baseYear: result.data.baseYear,
      period: formatPeriod(latest.period, true),
      retrievedAt: lastRetrievedAt(obs),
      limitations: [...config.limits],
    }),
  ];
}

function Card({ entry, qs }: { entry: OverviewEntry; qs: string }) {
  const { config, result } = entry;
  const plain = PLAIN[config.key];
  const st = status(result);
  const rows = useMemo(() => (result.ok ? withDerived(result.data.observations) : []), [result]);
  const latest = latestObservation(rows);
  const mom = latestWithMetric(rows, "mom");
  const rate = latestWithMetric(rows, "official");
  return (
    <section aria-label={`${config.shortName} summary`} className="flex flex-col rounded-md border border-rule bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-serif text-lg font-semibold">
            {plain.name} <span className="text-ink-muted">({config.shortName})</span>
            <Help topic={plain.help} label={plain.name} />
          </h3>
          <p className="text-xs text-ink-muted">{plain.text}</p>
        </div>
        <StatusPill tone={st.tone}>{st.text}</StatusPill>
      </div>
      {!result.ok ? (
        <p className="mt-3 text-sm text-up">Unable to load {config.shortName} data. Please check the API connection.</p>
      ) : !latest ? (
        <p className="mt-3 text-sm text-ink-muted">{config.empty}</p>
      ) : (
        <>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="figure text-4xl font-medium tracking-tight">{formatIndex(latest.index)}</p>
              <p className="text-sm">
                {formatPeriod(latest.period, true)} · base {result.data.baseYear} <Help topic="baseYear" />
              </p>
            </div>
            <Sparkline values={rows.filter((r) => r.index !== null).map((r) => ({ n: monthNumber(r.period), v: r.index as number }))} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-ink-muted">
                Monthly change (calculated) <Help topic="mom" />
              </dt>
              <dd className="figure text-sm">
                {mom ? formatPercent(mom.mom, true) : "Not available"}
                {mom && mom.period !== latest.period && <span className="block text-ink-muted">for {formatPeriod(mom.period)}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">
                Official annual rate <Help topic="official" />
              </dt>
              <dd className="figure text-sm">
                {config.rateColumn === null ? (
                  <span className="text-ink-muted">Not provided by source</span>
                ) : rate ? (
                  <>
                    {formatPercent(rate.rate, config.rateSigned)}
                    <span className="block text-ink-muted">for {formatPeriod(rate.period)}</span>
                  </>
                ) : (
                  <span className="text-ink-muted">Not available</span>
                )}
              </dd>
            </div>
          </dl>
          <SourceAttribution className="mt-3" items={sourceFor(entry)} />
        </>
      )}
      <div className="mt-auto border-t border-rule pt-3">
        <Link href={`${config.path}${qs}`} className="text-sm font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent">
          Explore {config.shortName} →
        </Link>
      </div>
    </section>
  );
}

const COMPARE_METRICS: Exclude<MetricKey, "index" | "official">[] = ["yoy", "mom"];

/** Visual hub: hero, summary cards, trend previews, safe comparison, data coverage, navigation.
 *  All values come from the same parsed API results the detail pages use. */
export function IndicatorsOverview({ entries }: { entries: OverviewEntry[] }) {
  const [filters, setFilters] = useFilterState(["index", "mom", "yoy"]);
  const [picked, setPicked] = useState<string[]>(entries.map((e) => e.config.key));
  const [cmpMetric, setCmpMetric] = useState<"yoy" | "mom">("yoy");

  const derived = useMemo(
    () => entries.map((e) => ({ entry: e, rows: e.result.ok ? withDerived(e.result.data.observations) : [] })),
    [entries],
  );
  const qsAll = serializeFilters({ ...filters, metric: filters.metric }).toString();
  const qs = qsAll ? `?${qsAll}` : "";

  const chosen = derived.filter((d) => picked.includes(d.entry.config.key) && d.rows.length > 0);
  const common = commonWindow(chosen.map((d) => d.rows));
  const cmpWindow = clipToWindow(common, filters.range, filters.custom);

  return (
    <div className="space-y-8">
      <section aria-label="Introduction" className="rounded-md border border-rule bg-surface p-5">
        <h2 className="font-serif text-3xl font-semibold tracking-tight">Explore India&apos;s Economic Indicators</h2>
        <p className="mt-2 max-w-2xl text-ink-muted">
          Understand how prices and industrial production have changed using official monthly statistics.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Tour steps={INDICATOR_TOUR} />
          {entries.map((e) => (
            <Link key={e.config.key} href={`${e.config.path}${qs}`} className={`rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg ${focusRing}`}>
              Explore {e.config.shortName}
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Latest values" className="grid gap-4 lg:grid-cols-3">
        {entries.map((e) => (
          <Card key={e.config.key} entry={e} qs={qs} />
        ))}
      </section>
      <p className="-mt-5 text-xs text-ink-muted">
        Each index has its own base year and scale, so levels must not be compared between indicators.
      </p>

      <section aria-label="Date range" className="space-y-3">
        <div role="group" aria-label="Time range" className="flex flex-wrap items-center gap-2">
          {RANGE_KEYS.filter((k) => k !== "Custom").map((k) => (
            <button key={k} type="button" aria-pressed={filters.range === k} onClick={() => setFilters({ range: k, custom: null })} className={chip(filters.range === k)}>
              {k === "All" ? "All available" : k}
            </button>
          ))}
          <Help topic="range" />
          <span className="text-xs text-ink-muted">Custom months are available on each indicator page.</span>
        </div>
      </section>

      <section aria-label="Trend snapshot" className="space-y-3">
        <h2 className="font-serif text-xl font-semibold">
          Trends <Help topic="trend" />
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {derived.map(({ entry, rows }) => {
            const { config, result } = entry;
            const vis = inWindow(rows, resolveWindow(rows, filters.range, null));
            return (
              <div key={config.key} className="rounded-md border border-rule bg-surface p-4">
                <h3 className="mb-2 text-sm font-semibold">
                  {config.chartTitle}
                  {result.ok && <span className="font-normal text-ink-muted"> · base {result.data.baseYear}</span>}
                </h3>
                {result.ok && vis.filter((r) => r.index !== null).length >= 2 ? (
                  <SeriesChart
                    points={vis.map((r) => ({ n: monthNumber(r.period), label: formatPeriod(r.period), value: r.index, tip: [`Base ${result.data.baseYear}`] }))}
                    mode="line"
                    name={config.indexName}
                    yLabel={`${config.shortName} index`}
                  />
                ) : (
                  <p className="rounded border border-dashed border-rule px-3 py-8 text-center text-sm text-ink-muted">
                    {result.ok ? "Not enough stored months in this range to draw a trend." : "Data unavailable."}
                  </p>
                )}
                <SourceAttribution className="mt-2" items={sourceFor(entry)} />
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Compare indicators" className="rounded-md border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl font-semibold">
          Compare indicators <Help topic="compare" />
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Percentage changes are comparable; index levels are not, so each indicator gets its own aligned chart over a
          common window.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">Indicators to compare</legend>
            {entries.map((e) => (
              <label key={e.config.key} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={picked.includes(e.config.key)}
                  onChange={(ev) => setPicked((p) => (ev.target.checked ? [...p, e.config.key] : p.filter((k) => k !== e.config.key)))}
                />
                {e.config.shortName}
              </label>
            ))}
          </fieldset>
          <div role="group" aria-label="Comparison metric" className="flex gap-2">
            {COMPARE_METRICS.map((m) => (
              <button key={m} type="button" aria-pressed={cmpMetric === m} onClick={() => setCmpMetric(m)} className={chip(cmpMetric === m)}>
                {METRIC_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        {cmpWindow ? (
          <p className="mt-2 text-xs text-ink-muted">
            Common calendar window: {formatPeriod(`${Math.floor(cmpWindow.start / 12)}-${String((cmpWindow.start % 12) + 1).padStart(2, "0")}-01`)} –{" "}
            {formatPeriod(`${Math.floor(cmpWindow.end / 12)}-${String((cmpWindow.end % 12) + 1).padStart(2, "0")}-01`)} (months where every
            selected indicator has data).
          </p>
        ) : (
          <p className="mt-2 text-sm text-warn">The selected indicators share no common months in this range.</p>
        )}
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          {cmpWindow &&
            chosen.map(({ entry, rows }) => {
              const vis = inWindow(rows, cmpWindow);
              const pts = vis.map((r) => ({ n: monthNumber(r.period), label: formatPeriod(r.period), value: r[cmpMetric], tip: ["Calculated"] }));
              return (
                <div key={entry.config.key}>
                  <h3 className="mb-1 text-sm font-semibold">
                    {entry.config.shortName} · {METRIC_LABEL[cmpMetric]}
                  </h3>
                  {pts.some((p) => p.value !== null) ? (
                    <SeriesChart points={pts} mode="bar" name={`${entry.config.shortName} ${cmpMetric === "yoy" ? "YoY" : "MoM"} %`} yLabel="% change" suffix="%" />
                  ) : (
                    <p className="rounded border border-dashed border-rule px-3 py-8 text-center text-sm text-ink-muted">
                      Not available in this window (needs {cmpMetric === "yoy" ? "12 months of earlier history" : "the previous month"}).
                    </p>
                  )}
                </div>
              );
            })}
        </div>
        <SourceAttribution
          className="mt-3"
          items={chosen.flatMap(({ entry }) => {
            const [base] = sourceFor(entry);
            return base ? [base, calculatedItem(base, `${entry.config.shortName} ${cmpMetric === "yoy" ? "YoY" : "MoM"} change`, FORMULA[cmpMetric], "% change")] : [];
          })}
        />
        <p className="mt-2 text-xs text-ink-muted">
          CPI, WPI and IIP measure different things. Moving together does not show that one causes the other.
        </p>
      </section>

      <section aria-label="Data coverage">
        <h2 className="mb-2 font-serif text-xl font-semibold">
          Data coverage <Help topic="missing" />
        </h2>
        <div className="overflow-x-auto rounded-md border border-rule bg-surface">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Stored history of each indicator</caption>
            <thead>
              <tr className="border-b border-rule text-left text-xs">
                <th scope="col" className="px-4 py-2 font-semibold">Indicator</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Latest index</th>
                <th scope="col" className="px-4 py-2 font-semibold">Latest period</th>
                <th scope="col" className="px-4 py-2 font-semibold">Earliest stored</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Months stored</th>
                <th scope="col" className="px-4 py-2 font-semibold">Missing months</th>
                <th scope="col" className="px-4 py-2 font-semibold">Base year</th>
                <th scope="col" className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {derived.map(({ entry, rows }) => {
                const { config, result } = entry;
                const latest = latestObservation(rows);
                const first = rows.find((r) => r.index !== null);
                const st = status(result);
                const gaps = missingMonths(rows.filter((r) => r.index !== null));
                return (
                  <tr key={config.key} className="border-b border-rule last:border-b-0">
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <Link href={config.path} className="font-serif text-lg font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                        {config.shortName}
                      </Link>
                      <span className="block text-xs text-ink-muted">{config.overviewBlurb}</span>
                    </th>
                    <td className="figure px-4 py-3 text-right">{latest ? formatIndex(latest.index) : <span className="text-ink-muted">Unavailable</span>}</td>
                    <td className="px-4 py-3">{latest ? formatPeriod(latest.period, true) : <span className="text-ink-muted">Unavailable</span>}</td>
                    <td className="px-4 py-3">{first ? formatPeriod(first.period) : "—"}</td>
                    <td className="figure px-4 py-3 text-right">{rows.filter((r) => r.index !== null).length}</td>
                    <td className="px-4 py-3 text-xs">{gaps.length ? gaps.join(", ") : "None"}</td>
                    <td className="figure px-4 py-3">{result.ok ? result.data.baseYear : "—"}</td>
                    <td className="px-4 py-3">
                      <StatusPill tone={st.tone}>{st.text}</StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Coverage is what ArthaSense has stored, not a claim about what the publisher has released. Retrieval times are
          in each card&apos;s source details.
        </p>
      </section>

      <section aria-label="Explore deeper" className="grid gap-4 md:grid-cols-3">
        {[
          ["cpi", "Month-by-month consumer prices, heatmap, moving average and official source."],
          ["wpi", "Wholesale prices of goods, monthly and yearly change, with limits explained."],
          ["iip", "Industrial output plus sector growth comparison and ranking."],
        ].map(([key, text]) => {
          const e = entries.find((x) => x.config.key === key)!;
          return (
            <Link key={key} href={`${e.config.path}${qs}`} className={`rounded-md border border-rule bg-surface p-4 hover:bg-bg ${focusRing}`}>
              <p className="font-serif text-lg font-semibold">{e.config.navLabel} →</p>
              <p className="mt-1 text-sm text-ink-muted">{text}</p>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
