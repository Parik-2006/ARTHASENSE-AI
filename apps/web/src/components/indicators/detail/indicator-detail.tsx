"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { useRange } from "@/components/indicators/detail/use-range";
import { TimeChart } from "@/components/overview/time-chart";
import { downloadCsv, Empty } from "@/components/overview/v3/ui";
import { ClassBadge, periodSpan, SourceAttribution } from "@/components/source/source-attribution";
import { deriveGdp, fiscalQuarterOf, type GdpData, type GdpResult, type GdpRow, type GvaResult, quarterLabel, quarterShort } from "@/lib/gdp";
import { formatIndex, formatPeriod, latestObservation } from "@/lib/indicator";
import type { IndicatorConfig } from "@/lib/indicators";
import {
  DEFINITION,
  explainGdp,
  explainLevel,
  explainRate,
  monthlyWindow,
  quarterWindow,
  shortfallNote,
  toCsv,
  VIEW_COLOR,
  type ViewKey,
} from "@/lib/indicator-view";
import { derive, type Derived, seedCustomRange } from "@/lib/overview";
import { BASE_YEAR_NOTE } from "@/lib/series-options";
import type { SeriesBundle } from "@/lib/series-data";
import { type DataClass, seriesIds, type SourceInfo, sourceFor } from "@/lib/source";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const btn = `rounded border border-rule px-3 py-1.5 text-sm hover:border-accent ${focusRing}`;
const ym = (p: string) => p.slice(0, 7);
const periodOfN = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`;

// ---------------------------------------------------------------- shared pieces

function ChartCard({ title, cls, help, children, note }: { title: string; cls: DataClass; help?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section data-testid="indicator-chart" aria-label={title} className="min-w-0 rounded-md border border-rule bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {title}
          {help && <HelpTip id={help} />}
        </h2>
        <ClassBadge cls={cls} />
      </div>
      {children}
      {note && <div className="mt-2 text-xs text-ink-muted">{note}</div>}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="figure text-lg font-medium">{value}</dd>
      {sub && <dd className="text-xs text-ink-muted">{sub}</dd>}
    </div>
  );
}

/** Accessible table version of what the two charts show. */
function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number | null)[][] }) {
  return (
    <details className="text-sm">
      <summary className={`cursor-pointer font-medium text-accent underline ${focusRing}`}>Show the numbers as a table ({rows.length} rows)</summary>
      <div className="mt-2 max-h-80 overflow-auto">
        <table className="w-full min-w-[28rem] text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-rule text-left">
              {head.map((h, i) => (
                <th key={h} scope="col" className={`py-1.5 pr-3 font-semibold ${i ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r[0])} className="border-b border-rule last:border-b-0">
                {r.map((c, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="py-1 pr-3 text-left font-medium">{c}</th>
                  ) : (
                    <td key={i} className="figure py-1 pr-3 text-right">{c === null ? "—" : c}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const READ_COMMON = [
  "The horizontal axis is time. The vertical axis is the value of the line; it does not always start at zero, so small moves can look large.",
  "Index points are not percentages. An index compares the price or output level with its base year, which is set to 100. A percentage change compares two periods.",
  "The base year is the reference period that equals 100. Different base years are separate series and are never joined here.",
  "Official figures are published by the government agency named in the source line. Calculated figures are worked out by ArthaSense from those official values and are labelled.",
  "Recent official values can be revised in later releases, so the latest months may change.",
];
const READ: Record<ViewKey, string[]> = {
  cpi: ["CPI is published every month. The inflation chart shows how much higher (or lower) the index is than in the same month a year earlier.", "A line can fall while prices still rise: falling inflation means prices are rising more slowly, not that they are falling."],
  wpi: ["WPI is published every month. It covers goods only, priced at the wholesale stage, so it can move differently from consumer prices.", "The API gives the index only, so the inflation rate is calculated from the index (same month a year earlier) and labelled as calculated."],
  iip: ["IIP is published every month and is not seasonally adjusted: festivals, monsoon and the number of working days move output up and down.", "Growth compares a month with the same month a year earlier, which removes most of that seasonal pattern."],
  gdp: ["GDP is published once a quarter, so each point is one fiscal quarter (Q1 = April to June). No monthly GDP exists and none is drawn.", "Growth compares a quarter with the same quarter a year earlier. GVA is GDP by industry, before product taxes and subsidies."],
};

function Tutorial({ k }: { k: ViewKey }) {
  return (
    <details className="rounded-md border border-rule bg-surface p-3 text-sm" data-tour="how-to-read">
      <summary className={`cursor-pointer font-medium ${focusRing}`}>Learn how to read these charts</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
        {[...READ[k], ...READ_COMMON].map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </details>
  );
}

function Explanation({ children }: { children: ReactNode }) {
  return (
    <div aria-live="polite" data-testid="explanation" className="rounded-md border-l-4 border-accent bg-surface px-4 py-3 text-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">What this period shows</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- monthly indicators (CPI, WPI, IIP)

export function MonthlyDetail({ config, bundles }: { config: IndicatorConfig; bundles: SeriesBundle[] }) {
  const k = config.key;
  const prepared = useMemo(() => bundles.map((b) => ({ b, rows: b.result.ok ? derive(b.result.data.observations) : ([] as Derived[]) })), [bundles]);
  const search = useSearchParams();
  const wanted = search.get("base");
  const current = prepared.find((p) => p.b.option.id === wanted) ?? prepared[0];
  // Custom starts from the latest 12 months of the series on screen (never from another base year).
  const { sel, bar, go } = useRange(() => seedCustomRange([current.rows.filter((r) => r.index !== null)]));
  const missingWanted = wanted !== null && current.b.option.id !== wanted;
  const { b, rows } = current;
  const res = b.result;

  const header = (
    <div className="space-y-3">
      <p className="max-w-3xl text-base">{DEFINITION[k]}</p>
      {missingWanted && (
        <p role="status" className="rounded border border-warn px-3 py-2 text-xs text-warn">
          The series &quot;{wanted}&quot; is not stored for {config.shortName}, so the current series is shown.
        </p>
      )}
      {prepared.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-tour="series-switch">
          <label htmlFor={`${k}-base`} className="font-medium">
            Series (base year)
          </label>
          <HelpTip id="base-year" />
          <select
            id={`${k}-base`}
            value={current.b.option.id}
            onChange={(e) => go({ base: e.target.value === prepared[0].b.option.id ? null : e.target.value })}
            className={`min-w-0 max-w-full truncate rounded border border-rule bg-bg px-2 py-1 ${focusRing}`}
          >
            {prepared.map((p) => (
              <option key={p.b.option.id} value={p.b.option.id}>
                {p.b.option.label}
              </option>
            ))}
          </select>
          {current.b.option.role !== "current" && <span className="w-full text-xs text-warn">{current.b.option.note} {BASE_YEAR_NOTE}</span>}
        </div>
      )}
      <div className="rounded-md border border-rule bg-surface p-3">{bar}</div>
    </div>
  );

  if (!res.ok) {
    return (
      <div className="space-y-5">
        {header}
        <div role="alert" className="rounded-md border border-up bg-surface px-6 py-10 text-center">
          <p className="font-serif text-xl font-semibold">Unable to load {config.shortName} data right now.</p>
          <p className="mt-2 text-sm text-ink-muted">The data service did not answer. No figures are shown rather than old or estimated ones. Please try again later.</p>
        </div>
        <Tutorial k={k} />
      </div>
    );
  }
  const data = res.data;
  if (!rows.some((r) => r.index !== null)) {
    return (
      <div className="space-y-5">
        {header}
        <Empty>{config.empty}</Empty>
      </div>
    );
  }

  // IIP: headline or one official sector, chosen with ?sector= (both charts follow it). Sectors exist only for some bases.
  const sectorOpts =
    k === "iip" && b.sectors?.ok
      ? b.sectors.data.sectors.filter((s) => s.observations.some((o) => o.index !== null)).map((s) => ({ key: s.key, label: s.label, rows: derive(s.observations) }))
      : [];
  const wantedSector = search.get("sector");
  const sector = sectorOpts.find((s) => s.key === wantedSector) ?? null;
  const viewRows = sector ? sector.rows : rows;
  const sectorKey = sector?.key ?? "general";
  const sectorLabel = sector ? sector.label : "General (headline)";

  const w = monthlyWindow(viewRows, sel);
  const ids = seriesIds(k, data.baseYear, sectorKey, data.series ?? null);
  const src: SourceInfo = { ...sourceFor(config, data), seriesIds: ids, coverage: k === "iip" ? `India · ${sectorLabel}` : data.coverage };
  const hasOfficialRate = viewRows.some((r) => r.rate !== null);
  const rateOfficial = hasOfficialRate && k !== "wpi";
  const name = config.shortName;
  const indexTitle = `${name} index history${k === "iip" ? ` · ${sectorLabel}` : ""}`;
  const rateTitle = k === "iip" ? `IIP growth history (%)${sector ? ` · ${sectorLabel}` : ""}` : k === "cpi" ? "CPI inflation history (%)" : "WPI inflation, year-on-year (%)";
  const rateName = k === "iip" ? "industrial production growth" : k === "cpi" ? "consumer inflation" : "wholesale inflation";
  const pick = (r: Derived) => (rateOfficial ? r.rate : r.yoyCalc);
  const ratePoints = w.rows.map((r) => ({ n: r.n, v: pick(r) }));
  const latestAll = latestObservation(viewRows.map((r) => ({ period: r.period, index: r.index, rate: r.rate, indexSource: null, rateSource: null })));
  const period = periodSpan(w.first?.period ?? null, w.last?.period ?? null);
  const color = VIEW_COLOR[k];
  const short = shortfallNote(w.requestedMonths, w.stored, "month");

  const csvHead = ["period", `${k}_index`, ...(rateOfficial ? [k === "cpi" ? "inflation_yoy_pct_official" : "growth_yoy_pct_official"] : []), "yoy_change_pct_calculated", "mom_change_pct_calculated",
    ...(k === "iip" ? ["sector"] : []), "base_year", "series_id", "publisher", "release_key", "retrieved_at", "source_status"]; // prettier-ignore
  const f4 = (v: number | null) => (v === null ? null : v.toFixed(4));
  const csvRows = w.rows.map((r) => [
    r.period, r.index, ...(rateOfficial ? [r.rate] : []), f4(r.yoyCalc), f4(r.mom),
    ...(k === "iip" ? [sectorKey] : []), data.baseYear, ids[0], config.publisher, r.releaseKey, r.retrievedAt, r.sourceStatus ?? null,
  ]); // prettier-ignore
  const flagged = w.rows.filter((r) => r.sourceStatus && r.sourceStatus !== "source_final");

  const rangeLatest = [...w.rows].reverse().find((r) => r.index !== null) ?? null;
  const rangeRate = [...w.rows].reverse().find((r) => pick(r) !== null) ?? null;

  return (
    <div className="space-y-5">
      {header}
      {k === "iip" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="iip-sector" className="font-medium">
            Sector
          </label>
          <HelpTip id="sectors" />
          <select
            id="iip-sector"
            value={sector?.key ?? "general"}
            disabled={sectorOpts.length === 0}
            onChange={(e) => go({ sector: e.target.value === "general" ? null : e.target.value })}
            className={`min-w-0 max-w-full truncate rounded border border-rule bg-bg px-2 py-1 ${focusRing}`}
          >
            <option value="general">General (headline)</option>
            {sectorOpts.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {sectorOpts.length === 0 && <span className="text-xs text-ink-muted">Sector series are not stored for base {data.baseYear}; only the headline index exists.</span>}
          {wantedSector && !sector && <span role="status" className="text-xs text-warn">The sector &quot;{wantedSector}&quot; is not stored for this base, so the headline is shown.</span>}
        </div>
      )}

      <dl data-testid="range-summary" className="grid grid-cols-2 gap-4 rounded-md border border-rule bg-surface p-4 lg:grid-cols-4">
        <Stat label="Selected period" value={period} sub={`${w.stored} monthly observation${w.stored === 1 ? "" : "s"}`} />
        <Stat label="Index at end of period" value={rangeLatest ? formatIndex(rangeLatest.index) : "—"} sub={rangeLatest ? `${formatPeriod(rangeLatest.period, true)} · base ${data.baseYear} = 100` : undefined} />
        <Stat
          label={`${rateOfficial ? "Official" : "Calculated"} ${k === "iip" ? "growth" : "inflation"} at end of period`}
          value={rangeRate ? `${(pick(rangeRate) as number).toFixed(2)}%` : "—"}
          sub={rangeRate ? formatPeriod(rangeRate.period, true) : undefined}
        />
        <Stat
          label="Change over the period (index)"
          value={w.first && w.last && w.stored > 1 ? `${(((w.last.index as number) / (w.first.index as number) - 1) * 100).toFixed(2)}%` : "—"}
          sub="Calculated by ArthaSense"
        />
      </dl>
      {latestAll && rangeLatest && latestAll.period !== rangeLatest.period && (
        <p className="-mt-2 text-xs text-ink-muted">
          The latest stored observation overall is {formatPeriod(latestAll.period, true)} ({formatIndex(latestAll.index)}); the figures above are for the selected period only.
        </p>
      )}
      {short && <p className="-mt-2 text-xs text-warn">{short}</p>}
      {flagged.length > 0 && (
        <p className="-mt-2 text-xs text-warn">
          The source flags {flagged.map((r) => `${formatPeriod(r.period)} (${(r.sourceStatus ?? "").replace("source_status_", "")})`).join(", ")} in this range. The flag is kept exactly as published; the source API does not define it (see Known limitations under Source details).
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title={indexTitle} cls="official" help="base-year" note={`Official index points, base ${data.baseYear} = 100. Not a percentage.`}>
          {w.stored >= 2 ? (
            <TimeChart series={[{ key: "index", label: `${name} index`, stroke: color, points: w.rows.map((r) => ({ n: r.n, v: r.index })) }]} yLabel={`Index (base ${data.baseYear} = 100)`} description={`${indexTitle}, ${period}, base ${data.baseYear}.`} />
          ) : (
            <Empty>{w.stored === 1 ? "Only one month falls in this range; a trend needs at least two." : "No stored months fall in this range."}</Empty>
          )}
        </ChartCard>

        <ChartCard
          title={rateTitle}
          cls={rateOfficial ? "official" : "calculated"}
          help="yoy"
          note={rateOfficial ? `Official year-on-year rate as published by ${config.sourceShort}.` : "Calculated by ArthaSense: (index ÷ index of the same month a year earlier in the same series − 1) × 100. Not an official published rate."}
        >
          {ratePoints.some((p) => p.v !== null) ? (
            <TimeChart kind="bars" barColor="series" signed unit="%" series={[{ key: "rate", label: rateTitle, stroke: color, points: ratePoints }]} yLabel="% change from a year earlier" description={`${rateTitle}, ${period}.`} />
          ) : (
            <Empty>No {rateName} figure exists in this range. A calculated rate needs the same month a year earlier in the same series.</Empty>
          )}
        </ChartCard>
      </div>

      <Explanation>
        <p>{explainLevel(k as Exclude<ViewKey, "gdp">, w)}</p>
        <p className="mt-1">{explainRate(rateName, w.rows.map((r) => ({ period: r.period, v: pick(r) })), rateOfficial)}</p>
      </Explanation>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={w.rows.length === 0}
          onClick={() => downloadCsv(`india-${k}-${data.baseYear}${k === "iip" ? `-${sectorKey}` : ""}-${w.rows.length ? `${ym(w.rows[0].period)}-to-${ym(w.rows[w.rows.length - 1].period)}` : "empty"}.csv`, toCsv(csvHead, csvRows))}
          className={`${btn} disabled:opacity-50`}
        >
          Download CSV ({w.rows.length} rows)
        </button>
        {src.url && (
          <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">
            Official dataset (API)
          </a>
        )}
        {src.publisherUrl && (
          <a href={src.publisherUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">
            Publisher website
          </a>
        )}
      </div>
      <DataTable
        caption={`${name} observations, ${period}`}
        head={["Month", "Index", rateOfficial ? "Official rate %" : "Calculated YoY %"]}
        rows={[...w.rows].reverse().map((r) => [formatPeriod(r.period, true), r.index === null ? null : r.index.toFixed(2), pick(r) === null ? null : (pick(r) as number).toFixed(2)])}
      />
      <SourceAttribution cls="official" sources={[src]} period={period} units={`Index, base ${data.baseYear} = 100; rates in %`} method={rateOfficial ? undefined : "Inflation rate calculated by ArthaSense from the official index."} />
      <Tutorial k={k} />
    </div>
  );
}

// ---------------------------------------------------------------- GDP (quarterly)

const GVA_SHORT: Record<string, string> = {
  total: "Total GVA",
  agriculture: "Agriculture",
  mining: "Mining",
  manufacturing: "Manufacturing",
  electricity: "Electricity, gas & water",
  construction: "Construction",
  trade: "Trade, hotels & transport",
  financial: "Financial & real estate",
  public: "Public administration & other",
};

export function gdpSource(d: GdpData): SourceInfo {
  const at = d.observations.map((o) => o.retrievedAt).filter((x): x is string => !!x).sort();
  return {
    short: "MoSPI (NSO) National Accounts",
    publisher: "National Statistics Office (NSO), Ministry of Statistics and Programme Implementation (MoSPI), Government of India",
    dataset: `Quarterly estimates of GDP and GVA, ${d.measure}`,
    url: d.sourceUrl,
    publisherUrl: "https://www.mospi.gov.in/",
    seriesIds: ["mospi.nas.2022-23.india.gdp.real.level", "mospi.nas.2022-23.india.gdp.real.growth_yoy"],
    channel: "MoSPI eSankhyiki API (National Accounts), stored in ArthaSense PostgreSQL and served by the ArthaSense API",
    coverage: d.geography,
    baseYear: d.baseYear,
    retrievedAt: at.length ? at[at.length - 1] : null,
    publishedAt: null,
    snapshots: new Set(d.observations.map((o) => o.releaseKey).filter(Boolean)).size,
    revision: "Quarterly GDP estimates are revised in later releases; the source API gives no revision flag.",
    limitations: d.limitations,
  };
}

export function GdpDetail({ gdp, gva }: { gdp: GdpResult; gva: GvaResult }) {
  const search = useSearchParams();
  const gdpRows = useMemo(() => (gdp.ok ? deriveGdp(gdp.data) : []), [gdp]);
  const industries = gva.ok ? gva.data.industries : [];
  // ?measure=<industry> switches BOTH charts from GDP to that official GVA industry (same base, same quarters).
  const wantedMeasure = search.get("measure");
  const ind = industries.find((i) => i.key === wantedMeasure) ?? null;
  const rows: GdpRow[] = ind
    ? ind.points.map((p) => {
        const fq = fiscalQuarterOf(p.n);
        return { n: p.n, fiscalYear: fq.fiscalYear, quarter: fq.quarter, level: p.level, growthOfficial: p.growth, yoyCalc: null, qoq: null, releaseKey: p.releaseKey, retrievedAt: p.retrievedAt };
      })
    : gdpRows;
  const { sel, bar, go } = useRange(() => {
    const ns = rows.filter((r) => r.level !== null).map((r) => r.n);
    if (!ns.length) return null;
    const hi = ns[ns.length - 1];
    return { from: ym(periodOfN(Math.max(ns[0], hi - 9))), to: ym(periodOfN(hi + 2)) };
  });
  const measureName = ind ? `real GVA (${GVA_SHORT[ind.key] ?? ind.label})` : "real GDP";
  const measureTitle = ind ? `Real GVA · ${GVA_SHORT[ind.key] ?? ind.label}` : "Real GDP";

  const header = (
    <div className="space-y-3">
      <p className="max-w-3xl text-base">{DEFINITION.gdp}</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="gdp-measure" className="font-medium">
          Measure
        </label>
        <HelpTip id="gdp" />
        <select
          id="gdp-measure"
          value={ind?.key ?? "gdp"}
          disabled={!gdp.ok || industries.length === 0}
          onChange={(e) => go({ measure: e.target.value === "gdp" ? null : e.target.value })}
          className={`min-w-0 max-w-full truncate rounded border border-rule bg-bg px-2 py-1 ${focusRing}`}
        >
          <option value="gdp">GDP (whole economy)</option>
          {industries.map((i) => (
            <option key={i.key} value={i.key}>
              GVA: {i.label}
            </option>
          ))}
        </select>
        {wantedMeasure && !ind && gdp.ok && <span role="status" className="text-xs text-warn">The measure &quot;{wantedMeasure}&quot; is not stored, so GDP is shown.</span>}
        {ind && <span className="w-full text-xs text-ink-muted">GVA is output by industry before product taxes and subsidies. Industry names are MoSPI&apos;s own; MoSPI&apos;s data service gives no agriculture / industry / services split.</span>}
      </div>
      <div className="rounded-md border border-rule bg-surface p-3">{bar}</div>
    </div>
  );

  if (!gdp.ok) {
    return (
      <div className="space-y-5">
        {header}
        <div role="status" data-testid="gdp-unavailable" className="rounded-md border border-dashed border-rule bg-surface p-6">
          <p className="font-serif text-xl font-semibold">GDP data is not available yet</p>
          <p className="mt-2 text-sm text-ink-muted">
            {gdp.state === "not_stored"
              ? "Official quarterly GDP from MoSPI's National Accounts has not been loaded into this database yet. No GDP figures are shown until it is, and none are estimated."
              : "The data service did not answer. No GDP figures are shown rather than old or estimated ones."}
          </p>
          <p className="mt-2 text-sm">
            Official source:{" "}
            <a href="https://www.mospi.gov.in/" target="_blank" rel="noopener noreferrer" className="text-accent underline">
              National Statistics Office, MoSPI (quarterly estimates of GDP)
            </a>
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Real GDP quarterly level" cls="official">
            <Empty>Not available: GDP is not stored.</Empty>
          </ChartCard>
          <ChartCard title="Official real GDP growth, year-on-year (%)" cls="official">
            <Empty>Not available: GDP is not stored.</Empty>
          </ChartCard>
        </div>
        <Tutorial k="gdp" />
      </div>
    );
  }

  const data = gdp.data;
  const w = quarterWindow(rows, sel);
  const levels = w.rows.filter((r) => r.level !== null);
  const growth = w.rows.filter((r) => r.growthOfficial !== null);
  const period = w.rows.length ? (w.rows.length === 1 ? quarterLabel(w.rows[0].n) : `${quarterShort(w.rows[0].n)} – ${quarterShort(w.rows[w.rows.length - 1].n)}`) : "no quarters";
  const src = { ...gdpSource(data), dataset: ind ? `Quarterly GVA by industry (${ind.label}), constant 2022-23 prices` : gdpSource(data).dataset, seriesIds: ind ? [`mospi.nas.2022-23.india.gva.${ind.key}.real.level`, `mospi.nas.2022-23.india.gva.${ind.key}.real.growth_yoy`] : gdpSource(data).seriesIds };
  const short = shortfallNote(w.requestedQuarters, growth.length, "quarter");
  const lastLevel = levels[levels.length - 1] ?? null;
  const lastGrowth = growth[growth.length - 1] ?? null;
  const calYear = sel.key === "Custom" && sel.from?.endsWith("-01") && sel.to?.endsWith("-12") && sel.from.slice(0, 4) === sel.to.slice(0, 4) ? sel.from.slice(0, 4) : null;

  const csvHead = ["fiscal_year", "quarter", "quarter_first_month", "measure", "real_level_crore_constant_2022_23", "growth_yoy_pct_official", "base_year", "publisher", "release_key", "retrieved_at"];
  const csvRows = w.rows.map((r) => [r.fiscalYear, `Q${r.quarter}`, ym(periodOfN(r.n)), ind ? `gva_${ind.key}` : "gdp", r.level, r.growthOfficial, data.baseYear, "NSO, MoSPI", r.releaseKey, r.retrievedAt]);

  return (
    <div className="space-y-5">
      {header}
      <dl data-testid="range-summary" className="grid grid-cols-2 gap-4 rounded-md border border-rule bg-surface p-4 lg:grid-cols-4">
        <Stat label="Selected period" value={period} sub={`${w.rows.length} quarter${w.rows.length === 1 ? "" : "s"} · ${growth.length} with official growth`} />
        <Stat label={`${measureTitle} at end of period`} value={lastLevel ? `₹${(lastLevel.level as number).toLocaleString("en-IN")} cr` : "—"} sub={lastLevel ? `${quarterShort(lastLevel.n)} · constant ${data.baseYear} prices` : undefined} />
        <Stat label="Official growth at end of period" value={lastGrowth ? `${(lastGrowth.growthOfficial as number).toFixed(1)}%` : "—"} sub={lastGrowth ? quarterLabel(lastGrowth.n) : undefined} />
        <Stat label="Frequency" value="Quarterly" sub="Fiscal quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar" />
      </dl>
      {calYear && (
        <p className="-mt-2 text-xs text-ink-muted">
          Year {calYear} is a calendar year: it includes the quarters that start in January–December {calYear} (Q4 FY{Number(calYear) - 1}-{String(Number(calYear) % 100).padStart(2, "0")} to Q3 FY{calYear}-{String((Number(calYear) + 1) % 100).padStart(2, "0")}).
        </p>
      )}
      {short && <p className="-mt-2 text-xs text-warn">{short}</p>}

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title={`${measureTitle} quarterly level`} cls="official" help="gdp" note={`Official level at constant ${data.baseYear} prices (inflation removed), drawn in ₹ lakh crore (1 lakh crore = 1,00,000 crore); the table and CSV give exact ₹ crore. Quarterly figures are not seasonally adjusted, so quarters within a year differ partly for seasonal reasons.`}>
          {w.tooShort ? (
            <Empty>A 2-month range is shorter than one quarter. GDP is quarterly, so choose 3M or longer.</Empty>
          ) : levels.length ? (
            <TimeChart kind="bars" barColor="series" digits={2} stepMonths={3} formatN={quarterShort} series={[{ key: "lvl", label: `${measureTitle} (₹ lakh crore)`, stroke: VIEW_COLOR.gdp, points: w.rows.map((r) => ({ n: r.n, v: r.level === null ? null : r.level / 1e5 })) }]} yLabel="₹ lakh crore, constant prices" description={`${measureTitle} quarterly level, ${period}.`} />
          ) : (
            <Empty>No quarterly level is stored for this range.</Empty>
          )}
        </ChartCard>

        <ChartCard title={`Official ${measureName} growth, year-on-year (%)`} cls="official" help="yoy" note="Official year-on-year growth at constant prices: each quarter against the same quarter a year earlier.">
          {w.tooShort ? (
            <Empty>A 2-month range is shorter than one quarter. Choose 3M or longer.</Empty>
          ) : growth.length ? (
            <TimeChart kind="bars" barColor="series" signed unit="%" digits={1} stepMonths={3} formatN={quarterShort} series={[{ key: "g", label: `${measureTitle} growth`, stroke: VIEW_COLOR.gdp, points: w.rows.map((r) => ({ n: r.n, v: r.growthOfficial })) }]} yLabel="% change from a year earlier" description={`Official ${measureName} growth by fiscal quarter, ${period}.`} />
          ) : (
            <Empty>No official growth figure is stored for this range. The 2022-23 series starts in FY2022-23, so official growth begins in Q1 FY2023-24.</Empty>
          )}
        </ChartCard>
      </div>

      <Explanation>
        <p>{explainGdp(w, measureName)}</p>
        {growth.length > 0 && <p className="mt-1">These figures are at constant 2022-23 prices, so growth is after removing the effect of price changes.</p>}
      </Explanation>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={w.rows.length === 0} onClick={() => downloadCsv(`india-${ind ? `gva-${ind.key}` : "gdp"}-quarterly-${data.baseYear}${w.rows.length ? `-${w.rows[0].fiscalYear}Q${w.rows[0].quarter}-to-${w.rows[w.rows.length - 1].fiscalYear}Q${w.rows[w.rows.length - 1].quarter}` : ""}.csv`, toCsv(csvHead, csvRows))} className={`${btn} disabled:opacity-50`}>
          Download CSV ({w.rows.length} rows)
        </button>
        {src.url && (
          <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">
            Official dataset (API)
          </a>
        )}
        <a href="https://www.mospi.gov.in/" target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">
          Publisher website
        </a>
      </div>
      <DataTable
        caption={`${measureTitle} by quarter, ${period}`}
        head={["Quarter", "Level (₹ crore)", "Official growth %"]}
        rows={[...w.rows].reverse().map((r) => [quarterLabel(r.n), r.level === null ? null : r.level.toLocaleString("en-IN"), r.growthOfficial === null ? null : r.growthOfficial.toFixed(1)])}
      />
      <SourceAttribution cls="official" sources={[src]} period={period} units="₹ crore at constant 2022-23 prices; growth in % year-on-year" />
      <Tutorial k="gdp" />
    </div>
  );
}
