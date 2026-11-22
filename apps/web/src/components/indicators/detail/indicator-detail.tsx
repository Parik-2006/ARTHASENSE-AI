"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { useRange } from "@/components/indicators/detail/use-range";
import { type ChartSeries, TimeChart } from "@/components/overview/time-chart";
import { downloadCsv, Empty } from "@/components/overview/v3/ui";
import { ClassBadge, periodSpan, SourceAttribution } from "@/components/source/source-attribution";
import { deriveGdp, type GdpData, type GdpResult, type GvaResult, quarterLabel, quarterShort } from "@/lib/gdp";
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

const SECTOR_KEYS = ["mining", "manufacturing", "electricity"] as const;
const SECTOR_STROKE: Record<string, { stroke: string; dash?: string }> = {
  mining: { stroke: "var(--ind-wpi)" },
  manufacturing: { stroke: "var(--ind-iip)", dash: "6 3" },
  electricity: { stroke: "var(--ind-gdp)", dash: "2 3" },
};

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
            className={`rounded border border-rule bg-bg px-2 py-1 ${focusRing}`}
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

  const w = monthlyWindow(rows, sel);
  const ids = seriesIds(k, data.baseYear, "general", data.series ?? null);
  const src: SourceInfo = { ...sourceFor(config, data), seriesIds: ids };
  const hasOfficialRate = rows.some((r) => r.rate !== null);
  const rateOfficial = hasOfficialRate && k !== "wpi";
  const rateTitle = k === "cpi" ? "Consumer inflation rate (%)" : k === "wpi" ? "Wholesale inflation rate (%)" : "Industrial production growth (%)";
  const rateName = k === "iip" ? "industrial production growth" : k === "cpi" ? "consumer inflation" : "wholesale inflation";
  const pick = (r: Derived) => (rateOfficial ? r.rate : r.yoyCalc);
  const ratePoints = w.rows.map((r) => ({ n: r.n, v: pick(r) }));
  const latestAll = latestObservation(data.observations);
  const period = periodSpan(w.first?.period ?? null, w.last?.period ?? null);
  const color = VIEW_COLOR[k];
  const short = shortfallNote(w.requestedMonths, w.stored, "month");

  // ---- chart 2: index, or (IIP) the three sectors when they are stored for this base
  const sectorRows =
    k === "iip" && b.sectors?.ok
      ? b.sectors.data.sectors
          .filter((s) => (SECTOR_KEYS as readonly string[]).includes(s.key))
          .map((s) => ({ key: s.key, label: s.label, rows: derive(s.observations) }))
          .filter((s) => s.rows.some((r) => r.index !== null))
      : [];
  const inW = (n: number) => w.rows.length > 0 && n >= w.rows[0].n && n <= w.rows[w.rows.length - 1].n;
  const sectorSeries: ChartSeries[] = sectorRows.map((s) => ({ key: s.key, label: s.label, ...SECTOR_STROKE[s.key], points: s.rows.filter((r) => inW(r.n)).map((r) => ({ n: r.n, v: r.index })) }));
  const showSectors = sectorSeries.some((s) => s.points.filter((p) => p.v !== null).length >= 2);

  const csvHead = ["period", `${k}_index`, ...(rateOfficial ? [k === "cpi" ? "inflation_yoy_pct_official" : "growth_yoy_pct_official"] : []), "yoy_change_pct_calculated", "mom_change_pct_calculated",
    ...(showSectors ? sectorRows.map((s) => `${s.key}_index`) : []), "base_year", "series_id", "publisher", "release_key", "retrieved_at", "source_status"]; // prettier-ignore
  const f4 = (v: number | null) => (v === null ? null : v.toFixed(4));
  const csvRows = w.rows.map((r) => [
    r.period, r.index, ...(rateOfficial ? [r.rate] : []), f4(r.yoyCalc), f4(r.mom),
    ...(showSectors ? sectorRows.map((s) => s.rows.find((x) => x.n === r.n)?.index ?? null) : []),
    data.baseYear, ids[0], config.publisher, r.releaseKey, r.retrievedAt, r.sourceStatus ?? null,
  ]); // prettier-ignore
  const flagged = w.rows.filter((r) => r.sourceStatus && r.sourceStatus !== "source_final");

  const rangeLatest = [...w.rows].reverse().find((r) => r.index !== null) ?? null;
  const rangeRate = [...w.rows].reverse().find((r) => pick(r) !== null) ?? null;

  return (
    <div className="space-y-5">
      {header}

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
        <ChartCard
          title={rateTitle}
          cls={rateOfficial ? "official" : "calculated"}
          help="yoy"
          note={rateOfficial ? `Official year-on-year rate as published by ${config.sourceShort}.` : "Calculated by ArthaSense: (index ÷ index of the same month a year earlier − 1) × 100. Not an official published rate."}
        >
          {ratePoints.filter((p) => p.v !== null).length >= 1 ? (
            <TimeChart signed unit="%" series={[{ key: "rate", label: rateTitle, stroke: color, points: ratePoints }]} yLabel="% change from a year earlier" description={`${rateTitle}, ${period}.`} />
          ) : (
            <Empty>No {rateName} figure exists in this range. A calculated rate needs the same month a year earlier in the same series.</Empty>
          )}
        </ChartCard>

        {showSectors ? (
          <ChartCard title="Sectoral industrial production trends" cls="official" help="sectors" note={`Official sector indices, base ${data.baseYear} = 100. Each sector has its own weight in the headline IIP.`}>
            <TimeChart series={sectorSeries} yLabel={`Index (base ${data.baseYear} = 100)`} description={`Mining, manufacturing and electricity indices, ${period}.`} />
          </ChartCard>
        ) : (
          <ChartCard
            title={k === "cpi" ? "CPI general index over time" : k === "wpi" ? "WPI overall index over time" : "IIP general index over time"}
            cls="official"
            help="base-year"
            note={k === "iip" ? "Sector series are not stored for this base year, so the general index is shown instead." : `Index points, base ${data.baseYear} = 100. Not a percentage.`}
          >
            {w.stored >= 2 ? (
              <TimeChart series={[{ key: "index", label: `${config.shortName} index`, stroke: color, points: w.rows.map((r) => ({ n: r.n, v: r.index })) }]} yLabel={`Index (base ${data.baseYear} = 100)`} description={`${config.shortName} index, ${period}, base ${data.baseYear}.`} />
            ) : (
              <Empty>{w.stored === 1 ? "Only one month falls in this range; a trend needs at least two." : "No months fall in this range."}</Empty>
            )}
          </ChartCard>
        )}
      </div>

      <Explanation>
        <p>{explainLevel(k as Exclude<ViewKey, "gdp">, w)}</p>
        <p className="mt-1">{explainRate(rateName, w.rows.map((r) => ({ period: r.period, v: pick(r) })), rateOfficial)}</p>
      </Explanation>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={w.rows.length === 0}
          onClick={() => downloadCsv(`india-${k}-${data.baseYear}-${w.rows.length ? `${ym(w.rows[0].period)}-to-${ym(w.rows[w.rows.length - 1].period)}` : "empty"}.csv`, toCsv(csvHead, csvRows))}
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
        caption={`${config.shortName} observations, ${period}`}
        head={["Month", "Index", rateOfficial ? "Official rate %" : "Calculated YoY %", ...(showSectors ? sectorRows.map((s) => s.label) : [])]}
        rows={[...w.rows].reverse().map((r) => [formatPeriod(r.period, true), r.index === null ? null : r.index.toFixed(2), pick(r) === null ? null : (pick(r) as number).toFixed(2), ...(showSectors ? sectorRows.map((s) => s.rows.find((x) => x.n === r.n)?.index?.toFixed(2) ?? null) : [])])}
      />
      <SourceAttribution cls="official" sources={[src]} period={period} units={`Index, base ${data.baseYear} = 100; rates in %`} method={rateOfficial ? undefined : "Inflation rate calculated by ArthaSense from the official index."} />
      <Tutorial k={k} />
    </div>
  );
}

// ---------------------------------------------------------------- GDP (quarterly)

const GVA_DEFAULT = ["agriculture", "manufacturing", "construction", "financial"];
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
const GVA_STROKE = ["var(--ind-cpi)", "var(--ind-wpi)", "var(--ind-iip)", "var(--ind-gdp)", "var(--ink-muted)", "var(--target)", "var(--up)", "var(--down)", "var(--ok)"];

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
  const rows = useMemo(() => (gdp.ok ? deriveGdp(gdp.data) : []), [gdp]);
  const { sel, bar } = useRange(() => {
    const ns = rows.filter((r) => r.growthOfficial !== null).map((r) => r.n);
    if (!ns.length) return null;
    const hi = ns[ns.length - 1];
    return { from: ym(periodOfN(Math.max(ns[0], hi - 9))), to: ym(periodOfN(hi + 2)) };
  });
  const [picked, setPicked] = useState<string[]>(GVA_DEFAULT);

  const header = (
    <div className="space-y-3">
      <p className="max-w-3xl text-base">{DEFINITION.gdp}</p>
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
        <ChartCard title="Real GDP growth (%) by fiscal quarter" cls="official">
          <Empty>Not available: GDP is not stored.</Empty>
        </ChartCard>
        <ChartCard title="Sectoral GVA growth (%)" cls="official">
          <Empty>Not available: GVA is not stored.</Empty>
        </ChartCard>
        <Tutorial k="gdp" />
      </div>
    );
  }

  const data = gdp.data;
  const w = quarterWindow(rows, sel);
  const growth = w.rows.filter((r) => r.growthOfficial !== null);
  const period = w.rows.length ? (w.rows.length === 1 ? quarterLabel(w.rows[0].n) : `${quarterShort(w.rows[0].n)} – ${quarterShort(w.rows[w.rows.length - 1].n)}`) : "no quarters";
  const src = gdpSource(data);
  const short = shortfallNote(w.requestedQuarters, growth.length, "quarter");
  const lastLevel = [...w.rows].reverse().find((r) => r.level !== null) ?? null;
  const lastGrowth = growth[growth.length - 1] ?? null;
  const lo = w.rows[0]?.n ?? null;
  const hi = w.rows[w.rows.length - 1]?.n ?? null;
  const inQ = (n: number) => lo !== null && hi !== null && n >= lo && n <= hi;
  const industries = gva.ok ? gva.data.industries : [];
  const gvaSeries: ChartSeries[] = industries
    .filter((i) => picked.includes(i.key))
    .map((i) => ({ key: i.key, label: GVA_SHORT[i.key] ?? i.label, stroke: GVA_STROKE[industries.indexOf(i) % GVA_STROKE.length], dash: i.key === "total" ? "6 3" : undefined, points: i.points.filter((p) => inQ(p.n)).map((p) => ({ n: p.n, v: p.growth })) }));
  const gvaHasData = gvaSeries.some((s) => s.points.some((p) => p.v !== null));

  const csvHead = ["fiscal_year", "quarter", "quarter_first_month", "gdp_real_level_crore", "gdp_real_growth_yoy_pct_official",
    ...industries.map((i) => `gva_${i.key}_growth_yoy_pct_official`), "base_year", "price_basis", "publisher", "release_key", "retrieved_at"]; // prettier-ignore
  const csvRows = w.rows.map((r) => [
    r.fiscalYear, `Q${r.quarter}`, ym(periodOfN(r.n)), r.level, r.growthOfficial,
    ...industries.map((i) => i.points.find((p) => p.n === r.n)?.growth ?? null),
    data.baseYear, "constant 2022-23 prices (real)", "NSO, MoSPI", r.releaseKey, r.retrievedAt,
  ]); // prettier-ignore

  return (
    <div className="space-y-5">
      {header}
      <dl data-testid="range-summary" className="grid grid-cols-2 gap-4 rounded-md border border-rule bg-surface p-4 lg:grid-cols-4">
        <Stat label="Selected period" value={period} sub={`${w.rows.length} quarter${w.rows.length === 1 ? "" : "s"} · ${growth.length} with official growth`} />
        <Stat label="Real GDP growth at end of period" value={lastGrowth ? `${(lastGrowth.growthOfficial as number).toFixed(1)}%` : "—"} sub={lastGrowth ? quarterLabel(lastGrowth.n) : undefined} />
        <Stat label="Real GDP at end of period" value={lastLevel ? `₹${(lastLevel.level as number).toLocaleString("en-IN")} cr` : "—"} sub={lastLevel ? `${quarterShort(lastLevel.n)} · constant ${data.baseYear} prices` : undefined} />
        <Stat label="Frequency" value="Quarterly" sub="Fiscal quarters, Q1 = Apr–Jun" />
      </dl>
      {short && <p className="-mt-2 text-xs text-warn">{short}</p>}

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Real GDP growth (%) by fiscal quarter" cls="official" help="gdp" note="Official year-on-year growth of real GDP (constant 2022-23 prices): each quarter against the same quarter a year earlier.">
          {w.tooShort ? (
            <Empty>A 2-month range is shorter than one quarter. GDP is quarterly, so choose 3M or longer.</Empty>
          ) : growth.length ? (
            <TimeChart kind="bars" barColor="series" signed unit="%" digits={1} stepMonths={3} formatN={quarterShort} series={[{ key: "g", label: "Real GDP growth", stroke: VIEW_COLOR.gdp, points: w.rows.map((r) => ({ n: r.n, v: r.growthOfficial })) }]} yLabel="% change from a year earlier" description={`Official real GDP growth by fiscal quarter, ${period}.`} />
          ) : (
            <Empty>No official GDP growth figure is stored for this range. The 2022-23 series starts in FY2022-23, so official growth begins in Q1 FY2023-24.</Empty>
          )}
        </ChartCard>

        <ChartCard title="Sectoral GVA growth (%)" cls="official" help="gdp" note="Official year-on-year real growth for MoSPI's own industry groups. MoSPI's data service does not publish a single agriculture / industry / services split, so none is calculated here.">
          {!gva.ok ? (
            <Empty>Sector-wise GVA is not available: {gva.reason}</Empty>
          ) : w.tooShort ? (
            <Empty>A 2-month range is shorter than one quarter. Choose 3M or longer.</Empty>
          ) : (
            <>
              <fieldset className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <legend className="sr-only">Industries to show</legend>
                {industries.map((i) => (
                  <label key={i.key} className="flex items-center gap-1" title={i.label}>
                    <input type="checkbox" checked={picked.includes(i.key)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, i.key] : x.filter((y) => y !== i.key)))} />
                    {GVA_SHORT[i.key] ?? i.label}
                  </label>
                ))}
              </fieldset>
              {gvaHasData ? (
                <TimeChart signed unit="%" digits={1} stepMonths={3} formatN={quarterShort} series={gvaSeries} yLabel="% change from a year earlier" description={`Official real GVA growth by industry, ${period}.`} />
              ) : (
                <Empty>{picked.length ? "No official GVA growth is stored for the selected industries in this range." : "Select at least one industry."}</Empty>
              )}
            </>
          )}
        </ChartCard>
      </div>

      <Explanation>
        <p>{explainGdp(w)}</p>
        {growth.length > 0 && <p className="mt-1">GDP is measured at constant 2022-23 prices, so these growth rates are after removing the effect of price changes.</p>}
      </Explanation>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={w.rows.length === 0} onClick={() => downloadCsv(`india-gdp-quarterly-${data.baseYear}${w.rows.length ? `-${w.rows[0].fiscalYear}Q${w.rows[0].quarter}-to-${w.rows[w.rows.length - 1].fiscalYear}Q${w.rows[w.rows.length - 1].quarter}` : ""}.csv`, toCsv(csvHead, csvRows))} className={`${btn} disabled:opacity-50`}>
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
        caption={`Quarterly real GDP, ${period}`}
        head={["Quarter", "Real GDP (₹ crore)", "Official growth %"]}
        rows={[...w.rows].reverse().map((r) => [quarterLabel(r.n), r.level === null ? null : r.level.toLocaleString("en-IN"), r.growthOfficial === null ? null : r.growthOfficial.toFixed(1)])}
      />
      <SourceAttribution cls="official" sources={[src]} period={period} units="₹ crore at constant 2022-23 prices; growth in % year-on-year" />
      <Tutorial k="gdp" />
    </div>
  );
}
