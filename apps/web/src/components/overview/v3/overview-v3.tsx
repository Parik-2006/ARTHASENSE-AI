"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { IndicatorLink } from "@/components/guide/indicator-link";
import { Sparkline } from "@/components/indicators/indicator-summary";
import { Empty, downloadCsv, Panel, RangeBar, SectionShell, Seg } from "@/components/overview/v3/ui";
import { type ChartSeries, TimeChart } from "@/components/overview/time-chart";
import { periodSpan, SourceAttribution } from "@/components/source/source-attribution";
import { deriveGdp, GDP_ANNUAL_NOTE, GDP_QOQ_CAVEAT, type GdpData, gdpCsv, type GdpResult, type GdpRow, quarterLabel, quarterShort } from "@/lib/gdp";
import { formatIndex, formatPeriod, latestObservation } from "@/lib/indicator";
import type { IndicatorBundle } from "@/lib/overview-data";
import {
  applyRange,
  type Derived,
  derive,
  inWindow,
  parseRange,
  seedCustomRange,
  windowCsv,
  windowFor,
  ymNumber,
} from "@/lib/overview";
import {
  buildComparison,
  type CmpMode,
  latestMovement,
  OV_KEYS,
  OV_NAMES,
  OV_STROKE,
  type OvKey,
  parseCmpMode,
  parseCompareSel,
  parseOpen,
} from "@/lib/overview-v3";
import type { SourceInfo } from "@/lib/source";

const IIP_WARNING = "Monthly industrial output changes can reflect seasonal patterns. Official year-over-year growth is often more useful.";
const NOT_COMPARABLE = "These indicators measure different parts of the economy. Similar movement does not mean one caused the other.";

const WHAT: Record<OvKey, { measures: string; graph: string; plain: string }> = {
  cpi: {
    plain: "Prices households pay for a fixed basket of goods and services.",
    measures: "CPI follows the prices households pay for a fixed basket of goods and services.",
    graph: "Each point is one month's index; the base period equals 100. A rising line means the basket costs more than before. The vertical axis does not start at zero.",
  },
  wpi: {
    plain: "Prices of goods traded in bulk, before they reach shoppers.",
    measures: "WPI follows prices of goods sold in bulk between businesses. It covers goods, not services.",
    graph: "Each point is one month's index; the base period equals 100. Compare the line with its own earlier months only. The vertical axis does not start at zero.",
  },
  iip: {
    plain: "Volume of output from mining, manufacturing and electricity.",
    measures: "IIP measures how much mining, manufacturing and electricity the country produces.",
    graph: "Each point is one month's index; the base period equals 100. Month-to-month moves follow the seasons, so read the longer trend.",
  },
  gdp: {
    plain: "Total value of goods and services produced, adjusted for price changes.",
    measures: "Real GDP is the value of everything produced, measured at constant prices so inflation does not inflate it. It is published quarterly.",
    graph: "Each point is one fiscal quarter (Q1 is April to June). There is no monthly GDP, so no monthly values are drawn or filled in.",
  },
};

function gdpSource(d: GdpData): SourceInfo {
  const rel = new Set(d.observations.map((o) => o.releaseKey).filter(Boolean));
  const at = d.observations.map((o) => o.retrievedAt).filter((x): x is string => !!x).sort();
  return {
    short: "MoSPI National Accounts",
    publisher: "National Statistics Office, MoSPI",
    dataset: `${d.measure}, quarterly`,
    url: d.sourceUrl,
    publisherUrl: "https://www.mospi.gov.in/",
    seriesIds: [],
    channel: "MoSPI eSankhyiki API, stored in ArthaSense PostgreSQL and served by the ArthaSense API",
    coverage: d.geography,
    baseYear: d.baseYear,
    retrievedAt: at.length ? at[at.length - 1] : null,
    publishedAt: null,
    snapshots: rel.size,
    revision: "GDP estimates are revised by the publisher; revision details are not provided by the source API.",
    limitations: d.limitations,
  };
}

function CardShell({ k, isOpen, onToggle, children, source, first }: { k: OvKey; isOpen: boolean; onToggle: () => void; children: ReactNode; source: ReactNode; first?: boolean }) {
  return (
    <article aria-label={`${OV_NAMES[k].full} summary`} data-tour={first ? "card-index" : undefined} className={`flex min-w-0 flex-col rounded-md border bg-surface ${isOpen ? "border-accent" : "border-rule"}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={isOpen ? "ov-expanded" : undefined}
        onClick={onToggle}
        className="rounded-md p-4 text-left hover:bg-bg/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="text-lg font-semibold">
            {OV_NAMES[k].short} <span className="text-sm font-normal text-ink-muted">· {OV_NAMES[k].full}</span>
          </span>
          <span aria-hidden className="text-accent">{isOpen ? "Hide ▲" : "Open ▼"}</span>
        </span>
        <span className="mt-1 block text-sm text-ink-muted">{WHAT[k].plain}</span>
        {children}
        <span className="sr-only">{isOpen ? "Close the full chart" : "Open the full chart"}</span>
      </button>
      <div className="px-4 pb-4">{source}</div>
    </article>
  );
}


type MMetric = "official" | "mom" | "calc";
type GMetric = "official" | "calc";

interface Prep {
  b: IndicatorBundle;
  rows: Derived[];
}

export function OverviewV3({ bundles, gdp }: { bundles: IndicatorBundle[]; gdp: GdpResult }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { sel, error: rangeError } = parseRange(params.get("range"), params.get("from"), params.get("to"));
  const open = parseOpen(params.get("open"));

  const push = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const q = p.toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const [mMetric, setMMetric] = useState<Record<string, MMetric>>({});
  const [gMetric, setGMetric] = useState<GMetric>("official");
  const [fromIn, setFromIn] = useState(sel.from ?? "");
  const [toIn, setToIn] = useState(sel.to ?? "");
  const prepared: Prep[] = useMemo(() => bundles.map((b) => ({ b, rows: b.segments[0] ? derive(b.segments[0].observations) : [] })), [bundles]);
  const gdpRows: GdpRow[] | null = useMemo(() => (gdp.ok ? deriveGdp(gdp.data) : null), [gdp]);
  const gdpSrc = gdp.ok ? gdpSource(gdp.data) : null;

  const customBad = !!fromIn && !!toIn && ymNumber(fromIn) !== null && ymNumber(toIn) !== null && ymNumber(fromIn)! > ymNumber(toIn)!;
  const onPreset = (key: string) => {
    if (key === "Custom") {
      const ok = fromIn && toIn && ymNumber(fromIn) !== null && ymNumber(toIn) !== null && ymNumber(fromIn)! <= ymNumber(toIn)!;
      const seed = ok ? { from: fromIn, to: toIn } : seedCustomRange(prepared.map((p) => p.rows));
      if (!seed) return;
      setFromIn(seed.from);
      setToIn(seed.to);
      push({ range: "Custom", from: seed.from, to: seed.to });
    } else push({ range: key === "All" ? null : key, from: null, to: null });
  };
  const onCustom = (f: string, t: string) => {
    setFromIn(f);
    setToIn(t);
    if (ymNumber(f) !== null && ymNumber(t) !== null && ymNumber(f)! <= ymNumber(t)!) push({ range: "Custom", from: f, to: t });
  };
  const rangeBar = (
    <RangeBar sel={sel} error={rangeError ?? (customBad ? "The start month must not be after the end month." : null)} fromIn={fromIn} toIn={toIn} onPreset={onPreset} onCustom={onCustom} />
  );

  return (
    <>
      {IndicatorsSection()}
      {ChangesSection()}
      {CompareSection()}
    </>
  );

  // ======================= Section 1 =======================
  function IndicatorsSection() {
    const toggle = (k: OvKey) => push({ open: open === k ? null : k, base: null });
    return (
      <SectionShell id="indicators" tour="cards" title="Economic indicators" help="expand-graph" intro="Select an indicator to open its full historical chart.">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {prepared.map(({ b, rows }, i) => (
            <Fragment key={b.key}>{MonthlyCard({ b, rows, isOpen: open === b.key, onToggle: () => toggle(b.key), first: i === 0 })}</Fragment>
          ))}
          {GdpCard({ isOpen: open === "gdp", onToggle: () => toggle("gdp") })}
        </div>
        {open && ExpandedPanel({ k: open })}
      </SectionShell>
    );
  }

  function MonthlyCard({ b, rows, isOpen, onToggle, first }: { b: IndicatorBundle; rows: Derived[]; isOpen: boolean; onToggle: () => void; first: boolean }) {
    const seg = b.segments[0];
    const latest = latestObservation(seg?.observations ?? []);
    const valid = rows.filter((r) => r.index !== null);
    return (
      <CardShell
        k={b.key}
        isOpen={isOpen}
        onToggle={onToggle}
        first={first}
        source={
          <>
            <p className="text-xs text-ink-muted">Source: {b.source.short}{seg ? ` · base ${seg.baseYear}` : ""}</p>
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-accent underline focus-visible:outline-2 focus-visible:outline-accent">Source details</summary>
              <SourceAttribution className="mt-2" cls="official" sources={[b.source]} period={periodSpan(valid[0]?.period ?? null, valid[valid.length - 1]?.period ?? null)} units="Index points" />
            </details>
          </>
        }
      >
        {b.error ? (
          <span role="alert" className="mt-3 block text-sm text-up">Unable to load {b.shortName} data.</span>
        ) : !latest ? (
          <span className="mt-3 block text-sm text-ink-muted">No {b.shortName} observations are stored yet.</span>
        ) : (
          <span className="mt-3 flex items-end justify-between gap-2">
            <span>
              <span className="figure block text-3xl font-medium tracking-tight">{formatIndex(latest.index)}</span>
              <span className="block text-sm">{formatPeriod(latest.period, true)}</span>
              <span className="block text-xs text-ink-muted">Index, base {seg.baseYear} = 100</span>
            </span>
            <Sparkline values={valid.map((r) => ({ n: r.n, v: r.index as number }))} />
          </span>
        )}
      </CardShell>
    );
  }

  function GdpCard({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
    const latest = gdpRows ? [...gdpRows].reverse().find((r) => r.level !== null) : undefined;
    return (
      <CardShell
        k="gdp"
        isOpen={isOpen}
        onToggle={onToggle}
        source={
          gdpSrc && gdp.ok ? (
            <>
              <p className="text-xs text-ink-muted">Source: {gdpSrc.short} · base {gdp.data.baseYear}</p>
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-accent underline focus-visible:outline-2 focus-visible:outline-accent">Source details</summary>
                <SourceAttribution className="mt-2" cls="official" sources={[gdpSrc]} period="quarterly" units={gdp.data.unit} />
              </details>
            </>
          ) : (
            <p className="text-xs text-ink-muted">Source: MoSPI National Accounts (not yet loaded)</p>
          )
        }
      >
        {gdp.ok && latest && gdpRows ? (
          <span className="mt-3 flex items-end justify-between gap-2">
            <span>
              <span className="figure block text-3xl font-medium tracking-tight">{latest.level!.toLocaleString("en-IN")}</span>
              <span className="block text-sm">{quarterLabel(latest.n)}</span>
              <span className="block text-xs text-ink-muted">{gdp.data.unit}, constant prices, base {gdp.data.baseYear}</span>
            </span>
            <Sparkline stepMonths={3} values={gdpRows.filter((r) => r.level !== null).map((r) => ({ n: r.n, v: r.level as number }))} />
          </span>
        ) : (
          <span role="status" className="mt-3 block rounded border border-dashed border-rule p-3 text-sm text-ink-muted">
            GDP data is not available yet. {gdp.ok ? "" : gdp.reason}
          </span>
        )}
      </CardShell>
    );
  }

  function ExpandedPanel({ k }: { k: OvKey }) {
    const close = () => push({ open: null, base: null });
    const name = OV_NAMES[k];
    return (
      <div id="ov-expanded" data-tour="expanded" role="region" aria-label={`${name.full} full chart`} className="mt-4 rounded-md border border-accent bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="font-serif text-xl font-semibold">{name.short} · {name.full}</h3>
          <button type="button" onClick={close} className="rounded border border-rule px-2.5 py-1 text-sm hover:border-accent focus-visible:outline-2 focus-visible:outline-accent">
            Close ✕
          </button>
        </div>
        <div className="mt-3">{rangeBar}</div>
        <dl className="mt-3 grid gap-2 text-sm text-ink-muted md:grid-cols-2">
          <div><dt className="font-medium text-ink">What it measures</dt><dd>{WHAT[k].measures}</dd></div>
          <div><dt className="font-medium text-ink">What the graph means</dt><dd>{WHAT[k].graph}</dd></div>
        </dl>
        <div className="mt-4">{k === "gdp" ? GdpExpanded() : MonthlyExpanded({ k })}</div>
      </div>
    );
  }

  function MonthlyExpanded({ k }: { k: Exclude<OvKey, "gdp"> }) {
    const b = bundles.find((x) => x.key === k)!;
    const segId = params.get("base");
    const seg = b.segments.find((s) => s.id === segId) ?? b.segments[0];
    if (b.error) return <Empty>Unable to load {b.shortName} data. Please check the API connection.</Empty>;
    if (!seg) return <Empty>No {b.shortName} observations are stored yet.</Empty>;
    const rows = derive(seg.observations).filter((r) => r.index !== null);
    const shown = applyRange(rows, sel);
    const months = { "3M": 3, "6M": 6, "1Y": 12, "2Y": 24, "3Y": 36, "5Y": 60 }[sel.key as string];
    return (
      <>
        {b.segments.length > 1 && (
          <label className="mb-2 inline-block text-sm">
            Series / base year{" "}
            <select value={seg.id} onChange={(e) => push({ base: e.target.value === "current" ? null : e.target.value })} className="rounded border border-rule bg-bg px-1.5 py-1">
              {b.segments.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
            </select>
          </label>
        )}
        {seg.id !== "current" && <p className="mb-2 text-xs text-warn">Earlier series ({seg.label}). Its index levels are not comparable with the current base and are never joined to it.</p>}
        {shown.length < 2 ? (
          <Empty>{shown.length === 0 ? `No ${b.shortName} observations fall in the selected window.` : "Only one observation falls in this window; a trend needs at least two."}</Empty>
        ) : (
          <TimeChart
            series={[{ key: b.key, label: b.shortName, ...OV_STROKE[b.key], dash: undefined, points: shown.map((r) => ({ n: r.n, v: r.index })) }]}
            yLabel={`${b.shortName} index (base ${seg.baseYear} = 100)`}
            description={`Line chart of the ${b.fullName}, ${periodSpan(shown[0].period, shown[shown.length - 1].period)}, base ${seg.baseYear}.`}
          />
        )}
        {months && shown.length < months && shown.length > 0 && (
          <p className="mt-1 text-xs text-warn">The {sel.key} window spans {months} months, but only {shown.length} have stored values. No other months are filled in.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {shown.length > 0 && (
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  `${b.key}-${shown[0].period.slice(0, 7)}-to-${shown[shown.length - 1].period.slice(0, 7)}.csv`,
                  windowCsv(shown, { indicator: b.shortName, baseYear: seg.baseYear, source: b.source.short, publisher: b.source.publisher, seriesId: b.source.seriesIds[0], rateColumn: b.rateKind === "inflation" ? "yoy_inflation_pct_official" : b.rateKind === "growth" ? "yoy_growth_pct_official" : null }),
                )
              }
              className="rounded border border-rule px-2.5 py-1 hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
            >
              Download CSV
            </button>
          )}
          <IndicatorLink path={b.path} className="font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent">Full {b.shortName} explorer →</IndicatorLink>
        </div>
        <SourceAttribution
          className="mt-3"
          cls="official"
          sources={[{ ...b.source, baseYear: seg.baseYear, coverage: seg.coverage }]}
          period={periodSpan(shown[0]?.period ?? null, shown[shown.length - 1]?.period ?? null)}
          units="Index points"
        />
        <ul className="mt-2 flex flex-wrap gap-x-4 text-xs">
          {b.source.url && <li><a href={b.source.url} className="text-accent underline" rel="noreferrer" target="_blank">Dataset (official API)</a></li>}
          {b.source.publisherUrl && <li><a href={b.source.publisherUrl} className="text-accent underline" rel="noreferrer" target="_blank">Publisher website</a></li>}
        </ul>
      </>
    );
  }

  function inGdpWindow(rows: GdpRow[]): GdpRow[] {
    const last = rows.length ? rows[rows.length - 1].n : null;
    const w = windowFor(sel, last);
    return rows.filter((r) => inWindow(r.n, w));
  }

  function GdpExpanded() {
    if (!gdp.ok || !gdpRows) {
      return (
        <div role="status" className="rounded-md border border-dashed border-rule p-6 text-sm">
          <p className="font-medium">GDP data is not available yet.</p>
          <p className="mt-1 text-ink-muted">{gdp.ok ? "" : gdp.reason}</p>
          <p className="mt-2 text-ink-muted">
            Official quarterly GDP (MoSPI National Accounts) must be ingested into the database first. No figures are shown until then, and none are estimated.
          </p>
        </div>
      );
    }
    const shown = inGdpWindow(gdpRows.filter((r) => r.level !== null));
    return (
      <>
        {shown.length < 2 ? (
          <Empty>Fewer than two quarters fall in this window. Choose a longer range.</Empty>
        ) : (
          <TimeChart
            stepMonths={3}
            formatN={quarterShort}
            digits={0}
            series={[{ key: "gdp", label: "GDP", ...OV_STROKE.gdp, dash: undefined, points: shown.map((r) => ({ n: r.n, v: r.level })) }]}
            yLabel={`Real GDP, constant prices (${gdp.data.unit})`}
            description={`Line chart of quarterly real GDP at constant prices, base ${gdp.data.baseYear}.`}
          />
        )}
        <p className="mt-1 text-xs text-ink-muted">Quarterly data only. Levels are real GDP at constant prices, not growth rates.</p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => downloadCsv("gdp-quarterly.csv", gdpCsv(shown, { baseYear: gdp.data.baseYear, unit: gdp.data.unit, measure: gdp.data.measure }))}
            className="rounded border border-rule px-2.5 py-1 text-sm hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
          >
            Download CSV
          </button>
        </div>
        {gdpSrc && <SourceAttribution className="mt-3" cls="official" sources={[gdpSrc]} period={periodSpan(null, null)} units={gdp.data.unit} />}
        <ul className="mt-2 flex flex-wrap gap-x-4 text-xs">
          {gdpSrc?.url && <li><a href={gdpSrc.url} className="text-accent underline" rel="noreferrer" target="_blank">Dataset (official API)</a></li>}
          <li><a href="https://www.mospi.gov.in/" className="text-accent underline" rel="noreferrer" target="_blank">Publisher website</a></li>
        </ul>
      </>
    );
  }

  // ======================= Section 2 =======================
  function ChangesSection() {
    return (
      <SectionShell id="changes" tour="changes" title="How are things changing?" help="mom" intro="Green and blue bars show rises and falls. Official figures are shown as published; calculated ones are labelled.">
        <div className="mb-3">{rangeBar}</div>
        <div className="grid gap-4 lg:grid-cols-2">
          {prepared.map((p) => (
            <Fragment key={p.b.key}>{MonthlyChange({ p })}</Fragment>
          ))}
          {GdpChange()}
        </div>
      </SectionShell>
    );
  }

  function MonthlyChange({ p }: { p: Prep }) {
    const { b } = p;
    const hasOfficial = b.rateKind !== null;
    const metric: MMetric = mMetric[b.key] ?? (hasOfficial ? "official" : "mom");
    const setMetric = (m: MMetric) => setMMetric((x) => ({ ...x, [b.key]: m }));
    const visible = applyRange(p.rows, sel);
    const pick = (r: Derived) => (metric === "official" ? r.rate : metric === "mom" ? r.mom : r.yoyCalc);
    const points = visible.map((r) => ({ n: r.n, v: pick(r) }));
    const lastReal = [...visible].reverse().find((r) => pick(r) !== null);
    const sentence = lastReal
      ? latestMovement(b.shortName, "index", { label: formatPeriod(lastReal.period, true), value: pick(lastReal), prevLabel: metric === "mom" ? "the previous month" : "the same month a year earlier" }, metric === "official" ? "official" : "calculated")
      : null;
    const cls = metric === "official" ? "official" : "calculated";
    return (
      <Panel
        title={`${b.shortName}: change`}
        help={metric === "mom" ? "mom" : "yoy"}
        aside={
          <Seg
            label={`${b.shortName} change measure`}
            value={metric}
            onChange={setMetric}
            options={[
              ...(hasOfficial ? [{ key: "official" as const, label: "Annual (official)" }] : []),
              { key: "calc" as const, label: "Annual (calculated)" },
              { key: "mom" as const, label: "Monthly (calculated)" },
            ]}
          />
        }
      >
        {b.error ? (
          <Empty>Unable to load {b.shortName} data.</Empty>
        ) : points.some((x) => x.v !== null) ? (
          <TimeChart kind="bars" signed unit="%" series={[{ key: metric, label: metric, stroke: "var(--up)", points }]} yLabel={metric === "mom" ? "Change from previous month (%)" : `Change from a year earlier (%, ${metric === "official" ? "official" : "calculated"})`} description={`Bar chart of ${metric === "official" ? "official" : "calculated"} ${metric === "mom" ? "month-over-month" : "year-over-year"} change in the ${b.fullName}.`} />
        ) : (
          <Empty>
            {metric === "official" ? `No official ${b.shortName} figure is stored for this window.` : "Not enough consecutive or year-apart stored months in this window to calculate this change."}
          </Empty>
        )}
        {!hasOfficial && <p className="mt-1 text-xs text-ink-muted">{b.rateMissingText}</p>}
        {sentence && <p className="mt-2 text-sm">{sentence}</p>}
        {b.key === "iip" && metric === "mom" && <p className="mt-2 rounded border border-warn px-2 py-1 text-xs text-warn">{IIP_WARNING}</p>}
        <SourceAttribution className="mt-3" cls={cls} sources={[b.source]} period={periodSpan(visible[0]?.period ?? null, visible[visible.length - 1]?.period ?? null)} units="% change" method={cls === "calculated" ? "Calculated by ArthaSense from the official index. It is not an official rate." : undefined} />
      </Panel>
    );
  }

  function GdpChange() {
    const metric = gMetric;
    const setMetric = setGMetric;
    if (!gdp.ok || !gdpRows) {
      return (
        <Panel title="GDP: change" help="gdp">
          <Empty>GDP change cannot be shown: official GDP data is not available yet. {gdp.ok ? "" : gdp.reason}</Empty>
        </Panel>
      );
    }
    const visible = inGdpWindow(gdpRows);
    const pick = (r: GdpRow) => (metric === "official" ? r.growthOfficial : r.yoyCalc);
    const points = visible.map((r) => ({ n: r.n, v: pick(r) }));
    const last = [...visible].reverse().find((r) => pick(r) !== null);
    const sentence = last ? latestMovement("GDP", "gdp", { label: quarterLabel(last.n), value: pick(last), prevLabel: "the same quarter a year earlier" }, metric === "official" ? "official" : "calculated") : null;
    return (
      <Panel
        title="GDP: change (quarterly)"
        help="gdp"
        aside={<Seg label="GDP change measure" value={metric} onChange={setMetric} options={[{ key: "official", label: "Year-on-year (official)" }, { key: "calc", label: "Year-on-year (calculated)" }]} />}
      >
        {points.some((x) => x.v !== null) ? (
          <TimeChart kind="bars" signed unit="%" stepMonths={3} formatN={quarterShort} series={[{ key: "g", label: "GDP", stroke: "var(--up)", points }]} yLabel="Change from the same quarter a year earlier (%)" description="Bar chart of year-on-year real GDP change by fiscal quarter." />
        ) : (
          <Empty>{metric === "official" ? "No official year-on-year GDP growth is stored for this window." : "A calculated change needs the same quarter a year earlier."}</Empty>
        )}
        {sentence && <p className="mt-2 text-sm">{sentence}</p>}
        <p className="mt-2 text-xs text-ink-muted">{GDP_QOQ_CAVEAT} {GDP_ANNUAL_NOTE}</p>
        <SourceAttribution className="mt-3" cls={metric === "official" ? "official" : "calculated"} sources={[gdpSrc!]} period="quarterly" units="% change" method={metric === "calc" ? "Calculated by ArthaSense from official GDP levels. It is not an official rate." : undefined} />
      </Panel>
    );
  }

  // ======================= Section 3 =======================
  function CompareSection() {
    const available: OvKey[] = gdp.ok ? [...OV_KEYS] : OV_KEYS.filter((k) => k !== "gdp");
    const picked = parseCompareSel(params.get("ci"), available);
    const mode: CmpMode = parseCmpMode(params.get("cmp"));
    const result = buildComparison({
      picked,
      monthly: prepared.map((p) => ({ key: p.b.key, rows: p.rows })),
      gdp: gdpRows ? { rows: gdpRows } : null,
      sel,
      mode,
    });
    const setPick = (k: OvKey, on: boolean) => {
      const next = on ? [...picked, k] : picked.filter((x) => x !== k);
      push({ ci: next.length === available.length ? null : next.join(",") || "none" });
    };
    const monthlyModes: { key: CmpMode; label: string }[] = [
      { key: "mom", label: "Monthly % change" },
      { key: "yoy", label: "Annual % change" },
      { key: "aligned", label: "Separate aligned charts" },
      { key: "rebased", label: "% change from common start" },
    ];
    const quarterly = result.frequency === "quarterly";
    const modes = quarterly ? monthlyModes.map((m) => (m.key === "mom" ? { ...m, disabled: true } : m)) : monthlyModes;
    const pickedBundles = prepared.filter((p) => picked.includes(p.b.key as OvKey)).map((p) => p.b.source);
    const sources = [...pickedBundles, ...(picked.includes("gdp") && gdpSrc ? [gdpSrc] : [])];
    const fmtQ = (n: number) => quarterShort(n);
    return (
      <SectionShell id="compare" tour="compare" title="Compare economic trends" help="comparison" intro={NOT_COMPARABLE}>
        <div className="mb-3">{rangeBar}</div>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Seg label="Comparison mode" value={result.mode} options={modes} onChange={(k) => push({ cmp: k === "mom" ? null : k })} />
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="sr-only">Indicators to compare</legend>
            {OV_KEYS.map((k) => (
              <label key={k} className={`flex items-center gap-1.5 ${k === "gdp" && !gdp.ok ? "opacity-60" : ""}`}>
                <input type="checkbox" checked={picked.includes(k)} disabled={k === "gdp" && !gdp.ok} onChange={(e) => setPick(k, e.target.checked)} />
                {OV_NAMES[k].short}
                {k === "gdp" && !gdp.ok && <span className="text-xs text-ink-muted">(not available yet)</span>}
              </label>
            ))}
          </fieldset>
        </div>
        <div className="rounded-md border border-rule bg-surface p-4">
          <p className="mb-2 text-xs text-ink-muted">
            <strong className="text-ink">Comparison frequency: {quarterly ? "Quarterly (fiscal quarters)" : "Monthly"}.</strong>{quarterly && <HelpTip id="gdp-quarterly" />}{" "}
            {quarterly
              ? "GDP is quarterly, so each monthly indicator is shown as the average of its three monthly values in a fiscal quarter, only where all three months are stored. Nothing is interpolated and no monthly GDP exists."
              : "Only the current base series of each indicator is used, over the months they all share."}
          </p>
          {result.coerced && <p role="status" className="mb-2 rounded border border-warn px-2 py-1 text-xs text-warn">{result.coerced}</p>}
          {result.problem ? (
            <Empty>{result.problem}</Empty>
          ) : result.mode === "aligned" ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {result.aligned.map((a) => (
                <div key={a.key} className="min-w-0">
                  <p className="mb-1 text-sm font-medium">{a.label} <span className="text-xs font-normal text-ink-muted">({a.frequency})</span></p>
                  <TimeChart stepMonths={a.stepMonths} formatN={a.stepMonths === 3 ? fmtQ : undefined} series={[{ key: a.key, label: a.label, ...OV_STROKE[a.key], dash: undefined, points: a.points }]} yLabel={a.yLabel} description={`Aligned ${a.frequency} chart of ${a.label} over the common window.`} />
                </div>
              ))}
              <p className="text-xs text-ink-muted md:col-span-2 xl:col-span-4">Each chart has its own vertical scale. Do not compare line heights across charts.</p>
            </div>
          ) : (
            <TimeChart
              signed
              unit="%"
              stepMonths={quarterly ? 3 : 1}
              formatN={quarterly ? fmtQ : undefined}
              series={result.series as ChartSeries[]}
              yLabel={result.mode === "mom" ? "Monthly change (%)" : result.mode === "yoy" ? `Annual change (%, calculated${quarterly ? ", per quarter" : ""})` : "Change since common start (%)"}
              description={`Comparison of ${picked.map((k) => OV_NAMES[k].short).join(", ")}, ${quarterly ? "quarterly" : "monthly"}.`}
            />
          )}
          {result.mode === "rebased" && !result.problem && result.starts.length > 0 && result.starts[0].n !== null && (
            <p className="mt-2 text-xs text-ink-muted">All lines start at 0% in {quarterly ? quarterLabel(result.starts[0].n) : formatPeriod(`${Math.floor(result.starts[0].n / 12)}-${String((result.starts[0].n % 12) + 1).padStart(2, "0")}-01`, true)} or at their own first month in the window.</p>
          )}
          {picked.includes("iip") && result.mode === "mom" && <p className="mt-2 text-xs text-warn">{IIP_WARNING}</p>}
          {!result.problem && <SourceAttribution className="mt-3" cls={result.mode === "aligned" ? "official" : "calculated"} sources={sources} period="common window shown above" units={result.mode === "aligned" ? "Index points / GDP level (separate scales)" : "% change"} method={result.mode === "aligned" ? undefined : "Percent changes calculated by ArthaSense from each official series."} />}
        </div>
      </SectionShell>
    );
  }
}
