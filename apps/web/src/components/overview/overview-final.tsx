"use client";

import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { Sparkline } from "@/components/indicators/indicator-summary";
import { gdpSource } from "@/components/indicators/detail/indicator-detail";
import { useRange } from "@/components/indicators/detail/use-range";
import { type ChartSeries, TimeChart } from "@/components/overview/time-chart";
import { Empty, SectionShell, Seg } from "@/components/overview/v3/ui";
import { ClassBadge, periodSpan, SourceAttribution } from "@/components/source/source-attribution";
import { deriveGdp, type GdpResult, type GdpRow, quarterLabel, quarterShort } from "@/lib/gdp";
import { formatIndex, formatPeriod } from "@/lib/indicator";
import { explainGdp, explainRate, monthlyWindow, pathFor, quarterWindow, VIEW_COLOR, VIEW_KEYS, VIEW_NAME, type ViewKey } from "@/lib/indicator-view";
import { derive, type Derived, seedCustomRange } from "@/lib/overview";
import type { IndicatorBundle } from "@/lib/overview-data";
import { buildComparison, type CmpMode, parseCmpMode, parseCompareSel } from "@/lib/overview-v3";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const ONE_LINE: Record<ViewKey, string> = {
  cpi: "Prices households pay for everyday goods and services.",
  wpi: "Prices of goods traded in bulk, before they reach shoppers.",
  iip: "Output of factories, mines and power plants.",
  gdp: "Value of everything the economy produces, after removing price changes.",
};

interface Prep {
  b: IndicatorBundle;
  rows: Derived[];
  /** Official year-on-year rate for CPI and IIP; calculated for WPI (its source publishes the index only). */
  official: boolean;
}

const rateOf = (p: Prep, r: Derived) => (p.official ? r.rate : r.yoyCalc);

export function OverviewFinal({ bundles, gdp }: { bundles: IndicatorBundle[]; gdp: GdpResult }) {
  const prepared: Prep[] = useMemo(
    () =>
      bundles.map((b) => {
        const rows = b.segments[0] ? derive(b.segments[0].observations) : [];
        return { b, rows, official: b.rateKind !== null && rows.some((r) => r.rate !== null) };
      }),
    [bundles],
  );
  const gdpRows: GdpRow[] = useMemo(() => (gdp.ok ? deriveGdp(gdp.data) : []), [gdp]);
  const { sel, bar, go, params } = useRange(() => seedCustomRange(prepared.map((p) => p.rows.filter((r) => r.index !== null))));
  const byKey = (k: ViewKey) => prepared.find((p) => p.b.key === k);

  return (
    <>
      {Indicators()}
      {Changes()}
      {Compare()}
    </>
  );

  // ============================== Section 1: key indicators ==============================
  function Indicators() {
    return (
      <SectionShell id="indicators" tour="cards" title="Key economic indicators" intro="The latest official figure for each indicator. Select a card to explore its history.">
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {VIEW_KEYS.map((k) => (
            <li key={k} className="min-w-0">
              {k === "gdp" ? GdpCard() : MonthlyCard({ p: byKey(k), k })}
            </li>
          ))}
        </ul>
      </SectionShell>
    );
  }

  function CardLink(k: ViewKey, footer: ReactNode, children: ReactNode) {
    return (
      <Link
        href={pathFor(k)}
        data-testid={`card-${k}`}
        aria-label={`${VIEW_NAME[k].full} (${VIEW_NAME[k].short}): open the detailed view`}
        className={`group flex h-full flex-col rounded-md border border-rule border-t-4 bg-surface p-4 transition-colors hover:border-accent ${focusRing}`}
        style={{ borderTopColor: VIEW_COLOR[k] }}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold">
            <abbr title={VIEW_NAME[k].full} className="no-underline">{VIEW_NAME[k].short}</abbr>
          </span>
          <span aria-hidden className="text-sm text-ink-muted transition-transform group-hover:translate-x-0.5">View details →</span>
        </span>
        <span className="text-xs text-ink-muted">{VIEW_NAME[k].full}</span>
        <span className="mt-1 text-sm">{ONE_LINE[k]}</span>
        {children}
        <span className="mt-auto pt-3 text-xs text-ink-muted">{footer}</span>
      </Link>
    );
  }

  function MonthlyCard({ p, k }: { p: Prep | undefined; k: Exclude<ViewKey, "gdp"> }) {
    const seg = p?.b.segments[0];
    const valid = p ? p.rows.filter((r) => r.index !== null) : [];
    const last = valid[valid.length - 1];
    const rateRow = p ? [...p.rows].reverse().find((r) => rateOf(p, r) !== null) : undefined;
    const footer = p && seg ? <>Source: {p.b.source.short} · base {seg.baseYear}</> : <>Source: MoSPI</>;
    return (
      CardLink(
        k,
        footer,
        !p || p.b.error ? (
          <span role="alert" className="mt-3 text-sm text-up">Data could not be loaded right now.</span>
        ) : !last ? (
          <span className="mt-3 text-sm text-ink-muted">No observations are stored yet.</span>
        ) : (
          <span className="mt-3 flex items-end justify-between gap-2">
            <span className="min-w-0">
              <span className="figure block text-3xl font-medium tracking-tight">{formatIndex(last.index)}</span>
              <span className="block text-xs text-ink-muted">Index, base {seg!.baseYear} = 100 · {formatPeriod(last.period, true)}</span>
              {rateRow && (
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="figure font-medium">{(rateOf(p, rateRow) as number).toFixed(2)}%</span>
                  <span className="text-xs text-ink-muted">{k === "iip" ? "growth" : "inflation"}, year-on-year · {formatPeriod(rateRow.period)}</span>
                  <ClassBadge cls={p.official ? "official" : "calculated"} />
                </span>
              )}
            </span>
            <Sparkline values={valid.slice(-24).map((r) => ({ n: r.n, v: r.index as number }))} />
          </span>
        ),
      )
    );
  }

  function GdpCard() {
    const growth = gdpRows.filter((r) => r.growthOfficial !== null);
    const last = growth[growth.length - 1];
    return (
      CardLink(
        "gdp",
        gdp.ok ? <>Source: MoSPI (NSO) National Accounts · base {gdp.data.baseYear}</> : <>Source: MoSPI (NSO) National Accounts</>,
        gdp.ok && last ? (
          <span className="mt-3 flex items-end justify-between gap-2">
            <span className="min-w-0">
              <span className="figure block text-3xl font-medium tracking-tight">{(last.growthOfficial as number).toFixed(1)}%</span>
              <span className="block text-xs text-ink-muted">Real GDP growth, year-on-year · {quarterLabel(last.n)}</span>
              <span className="mt-1 inline-flex"><ClassBadge cls="official" /></span>
            </span>
            <Sparkline stepMonths={3} values={growth.slice(-12).map((r) => ({ n: r.n, v: r.growthOfficial as number }))} />
          </span>
        ) : (
          <span role="status" data-testid="gdp-unavailable" className="mt-3 rounded border border-dashed border-rule p-2 text-sm text-ink-muted">
            GDP data is not available yet. No figure is shown until official quarterly GDP is stored.
          </span>
        ),
      )
    );
  }

  // ============================== Section 2: how are things changing ==============================
  function Changes() {
    const k = (VIEW_KEYS as readonly string[]).includes(params.get("chg") ?? "") ? (params.get("chg") as ViewKey) : "cpi";
    const pick = (key: ViewKey) => go({ chg: key === "cpi" ? null : key });
    return (
      <SectionShell id="changes" tour="changes" title="How are things changing?" help="yoy" intro="Change compared with the same period a year earlier. Choose an indicator and a time range.">
        <div className="rounded-md border border-rule bg-surface p-4">
          <div className="mb-3 flex flex-col gap-3">
            <Seg label="Indicator" value={k} onChange={pick} options={VIEW_KEYS.map((x) => ({ key: x, label: VIEW_NAME[x].short }))} />
            {bar}
          </div>
          {k === "gdp" ? GdpChange() : MonthlyChange({ k })}
        </div>
      </SectionShell>
    );
  }

  function MonthlyChange({ k }: { k: Exclude<ViewKey, "gdp"> }) {
    const p = byKey(k);
    if (!p || p.b.error) {
      return (
        <div data-testid="change-panel">
          <Empty>{VIEW_NAME[k].short} data could not be loaded right now.</Empty>
        </div>
      );
    }
    const w = monthlyWindow(p.rows, sel);
    const points = w.rows.map((r) => ({ n: r.n, v: rateOf(p, r) }));
    const label = k === "iip" ? "industrial production growth" : k === "cpi" ? "consumer inflation" : "wholesale inflation";
    const period = periodSpan(w.first?.period ?? null, w.last?.period ?? null);
    return (
      <div data-testid="change-panel">
        <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
          {VIEW_NAME[k].short}: {label} (% year-on-year) <ClassBadge cls={p.official ? "official" : "calculated"} />
        </p>
        {points.some((x) => x.v !== null) ? (
          <TimeChart kind="bars" barColor="series" signed unit="%" series={[{ key: k, label, stroke: VIEW_COLOR[k], points }]} yLabel="% change from a year earlier" description={`Bar chart of ${label}, ${period}.`} />
        ) : (
          <Empty>No {label} figure exists in this range. A calculated change needs the same month a year earlier.</Empty>
        )}
        <p className="mt-2 text-sm">{explainRate(label, w.rows.map((r) => ({ period: r.period, v: rateOf(p, r) })), p.official)}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <SourceAttribution cls={p.official ? "official" : "calculated"} sources={[p.b.source]} period={period} units="% year-on-year" method={p.official ? undefined : "Calculated by ArthaSense from the official index (same month a year earlier). Not an official rate."} />
          <Link href={pathFor(k)} className="text-sm font-medium text-accent underline">Explore {VIEW_NAME[k].short} in detail →</Link>
        </div>
      </div>
    );
  }

  function GdpChange() {
    if (!gdp.ok) {
      return (
        <div data-testid="change-panel">
          <Empty>GDP change cannot be shown: official quarterly GDP is not stored yet. No figure is estimated.</Empty>
        </div>
      );
    }
    const w = quarterWindow(gdpRows, sel);
    const period = w.rows.length ? `${quarterShort(w.rows[0].n)} – ${quarterShort(w.rows[w.rows.length - 1].n)}` : "no quarters";
    return (
      <div data-testid="change-panel">
        <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
          GDP: real growth by fiscal quarter (% year-on-year) <ClassBadge cls="official" />
        </p>
        {w.tooShort ? (
          <Empty>GDP is quarterly, so a 2-month range cannot contain a full quarter. Choose 3M or longer.</Empty>
        ) : w.rows.some((r) => r.growthOfficial !== null) ? (
          <TimeChart kind="bars" barColor="series" signed unit="%" digits={1} stepMonths={3} formatN={quarterShort} series={[{ key: "gdp", label: "Real GDP growth", stroke: VIEW_COLOR.gdp, points: w.rows.map((r) => ({ n: r.n, v: r.growthOfficial })) }]} yLabel="% change from a year earlier" description={`Official real GDP growth by quarter, ${period}.`} />
        ) : (
          <Empty>No official GDP growth is stored in this range.</Empty>
        )}
        <p className="mt-2 text-sm">{explainGdp(w)}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <SourceAttribution cls="official" sources={[gdpSource(gdp.data)]} period={period} units="% year-on-year, constant prices" />
          <Link href={pathFor("gdp")} className="text-sm font-medium text-accent underline">Explore GDP in detail →</Link>
        </div>
      </div>
    );
  }

  // ============================== Section 3: compare ==============================
  function Compare() {
    const available: ViewKey[] = VIEW_KEYS.filter((k) => (k === "gdp" ? gdp.ok : !!byKey(k)?.rows.length));
    const ci = params.get("ci");
    // Default: the monthly indicators (a monthly comparison). GDP can be added; the comparison then becomes quarterly.
    const picked = ci === null ? available.filter((k) => k !== "gdp") : parseCompareSel(ci, available);
    const requested: CmpMode = params.get("cmp") ? parseCmpMode(params.get("cmp")) : "yoy";
    const result = buildComparison({ picked, monthly: prepared.map((p) => ({ key: p.b.key, rows: p.rows })), gdp: gdp.ok ? { rows: gdpRows } : null, sel, mode: requested });
    const quarterly = result.frequency === "quarterly";
    const setPick = (k: ViewKey, on: boolean) => {
      const next = on ? [...picked, k] : picked.filter((x) => x !== k);
      go({ ci: next.join(",") || "none" });
    };
    const modes: { key: CmpMode; label: string; disabled?: boolean }[] = [
      { key: "yoy", label: "Year-on-year %" },
      { key: "mom", label: "Month-on-month %", disabled: quarterly },
      { key: "rebased", label: "% change from start" },
      { key: "aligned", label: "Side by side" },
    ];
    const sources = [...prepared.filter((p) => picked.includes(p.b.key)).map((p) => p.b.source), ...(picked.includes("gdp") && gdp.ok ? [gdpSource(gdp.data)] : [])];
    return (
      <SectionShell id="compare" tour="compare" title="Compare economic trends" help="comparison" intro="Indicators are compared by percentage change, never by raw levels: index points and rupees are different units. Moving together does not mean one causes the other.">
        <div className="rounded-md border border-rule bg-surface p-4">
          <div className="mb-3 flex flex-col gap-3">
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <legend className="mb-1 text-xs text-ink-muted">Indicators</legend>
              {VIEW_KEYS.map((k) => (
                <label key={k} className={`flex items-center gap-1.5 ${available.includes(k) ? "" : "opacity-60"}`}>
                  <input type="checkbox" checked={picked.includes(k)} disabled={!available.includes(k)} onChange={(e) => setPick(k, e.target.checked)} />
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: VIEW_COLOR[k] }} />
                  {VIEW_NAME[k].short}
                  {!available.includes(k) && <span className="text-xs text-ink-muted">(not available yet)</span>}
                </label>
              ))}
            </fieldset>
            <Seg label="Comparison mode" value={result.mode} options={modes} onChange={(m) => go({ cmp: m === "yoy" ? null : m })} />
            {bar}
          </div>
          <p className="mb-2 text-xs text-ink-muted">
            <strong className="text-ink">{quarterly ? "Quarterly comparison" : "Monthly comparison"}.</strong>
            {quarterly && <HelpTip id="gdp-quarterly" />}{" "}
            {quarterly
              ? "GDP is quarterly, so each monthly index enters as its average over the three months of a fiscal quarter, only where all three are stored. No monthly GDP is created."
              : "Each indicator's current official series is used, over the months they all share."}
          </p>
          {result.coerced && <p role="status" className="mb-2 rounded border border-warn px-2 py-1 text-xs text-warn">{result.coerced}</p>}
          {result.problem ? (
            <Empty>{result.problem}</Empty>
          ) : result.mode === "aligned" ? (
            <div className="grid gap-4 md:grid-cols-2">
              {result.aligned.map((a) => (
                <div key={a.key} className="min-w-0">
                  <p className="mb-1 text-sm font-medium">{a.label} <span className="text-xs font-normal text-ink-muted">({a.frequency}, own scale)</span></p>
                  <TimeChart stepMonths={a.stepMonths} formatN={a.stepMonths === 3 ? quarterShort : undefined} digits={a.key === "gdp" ? 0 : 2} series={[{ key: a.key, label: a.label, stroke: VIEW_COLOR[a.key], points: a.points }]} yLabel={a.yLabel} description={`${a.label}, ${a.frequency}, over the common window.`} />
                </div>
              ))}
            </div>
          ) : (
            <TimeChart
              signed
              unit="%"
              stepMonths={quarterly ? 3 : 1}
              formatN={quarterly ? quarterShort : undefined}
              series={(result.series as ChartSeries[]).map((s) => ({ ...s, stroke: VIEW_COLOR[s.key as ViewKey] ?? s.stroke }))}
              yLabel={result.mode === "mom" ? "Change from previous month (%)" : result.mode === "yoy" ? "Change from a year earlier (%)" : "Change since the first period shown (%)"}
              description={`Comparison of ${picked.map((k) => VIEW_NAME[k].short).join(", ")} by ${result.mode === "rebased" ? "percentage change from a common start" : "percentage change"}.`}
            />
          )}
          {!result.problem && (
            <SourceAttribution className="mt-3" cls={result.mode === "aligned" ? "official" : "calculated"} sources={sources} period="the window shown above" units={result.mode === "aligned" ? "each on its own scale" : "% change"} method={result.mode === "aligned" ? undefined : "Percentage changes calculated by ArthaSense from each official series. Not official rates."} />
          )}
        </div>
      </SectionShell>
    );
  }
}
