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
import { formatIndex, formatPeriod, formatTimestamp } from "@/lib/indicator";
import { explainGdp, explainLevel, explainRate, monthlyWindow, pathFor, quarterWindow, VIEW_COLOR, VIEW_KEYS, VIEW_NAME, type ViewKey } from "@/lib/indicator-view";
import { derive, type Derived, seedCustomRange } from "@/lib/overview";
import type { IndicatorBundle } from "@/lib/overview-data";
import { buildComparison, type CmpMode, parseCmpMode, parseCompareSel } from "@/lib/overview-v3";
import { seriesIds } from "@/lib/source";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const ONE_LINE: Record<ViewKey, string> = {
  cpi: "Prices households pay for everyday goods and services.",
  wpi: "Prices of goods traded in bulk, before they reach shoppers.",
  iip: "Output of factories, mines and power plants.",
  gdp: "Value of everything the economy produces, after removing price changes.",
};

/** One stored official series (base year) of an indicator, prepared for Section 2. */
interface SegView {
  id: string;
  label: string;
  baseYear: string;
  series: string | null;
  coverage: string;
  rows: Derived[];
  /** The series carries an official year-on-year rate (CPI, IIP); otherwise the change is calculated (WPI, archives). */
  official: boolean;
  /** "Jan 2013 – Dec 2025": months with an index value. */
  span: string;
  /** Months with an official rate, or null. */
  rateSpan: string | null;
}

interface Prep {
  b: IndicatorBundle;
  /** The CURRENT series (cards, comparison, defaults). */
  rows: Derived[];
  /** Official year-on-year rate for CPI and IIP; calculated for WPI (its source publishes the index only). */
  official: boolean;
  /** Every stored series, current first; never merged. */
  segs: SegView[];
}

function segView(b: IndicatorBundle, seg: IndicatorBundle["segments"][number]): SegView {
  const rows = derive(seg.observations);
  const idx = rows.filter((r) => r.index !== null);
  const rt = rows.filter((r) => r.rate !== null);
  return {
    id: seg.id, label: seg.label, baseYear: seg.baseYear, series: seg.series ?? null, coverage: seg.coverage, rows,
    official: b.rateKind !== null && rt.length > 0,
    span: periodSpan(idx[0]?.period ?? null, idx[idx.length - 1]?.period ?? null),
    rateSpan: rt.length ? periodSpan(rt[0].period, rt[rt.length - 1].period) : null,
  }; // prettier-ignore
}

const rateOf = (p: Prep, r: Derived) => (p.official ? r.rate : r.yoyCalc);
type ChangeMetric = "yoy" | "level";
const day = (iso: string | null | undefined) => (iso ? formatTimestamp(iso).split(",")[0] : null);

export function OverviewFinal({ bundles, gdp }: { bundles: IndicatorBundle[]; gdp: GdpResult }) {
  const prepared: Prep[] = useMemo(
    () =>
      bundles.map((b) => {
        const rows = b.segments[0] ? derive(b.segments[0].observations) : [];
        return { b, rows, official: b.rateKind !== null && rows.some((r) => r.rate !== null), segs: b.segments.map((g) => segView(b, g)) };
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
    const footer =
      p && seg ? (
        <>
          Source: {p.b.source.short} · base {seg.baseYear}
          {day(p.b.source.retrievedAt) && <> · retrieved {day(p.b.source.retrievedAt)}</>}
        </>
      ) : (
        <>Source: MoSPI</>
      );
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
        gdp.ok ? (
          <>
            Source: MoSPI (NSO) National Accounts · base {gdp.data.baseYear}
            {day(gdpSource(gdp.data).retrievedAt) && <> · retrieved {day(gdpSource(gdp.data).retrievedAt)}</>}
          </>
        ) : (
          <>Source: MoSPI (NSO) National Accounts</>
        ),
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
    // Default: the first indicator that actually has a year-on-year figure stored (never open on an empty panel).
    const hasRate = (x: ViewKey) => (x === "gdp" ? gdpRows.some((r) => r.growthOfficial !== null) : !!byKey(x)?.rows.some((r) => rateOf(byKey(x)!, r) !== null));
    const def: ViewKey = VIEW_KEYS.find(hasRate) ?? "cpi";
    const k = (VIEW_KEYS as readonly string[]).includes(params.get("chg") ?? "") ? (params.get("chg") as ViewKey) : def;
    const pick = (key: ViewKey) => go({ chg: key === def ? null : key, chgs: null }); // series ids are per indicator
    const m: ChangeMetric = params.get("chgm") === "level" ? "level" : "yoy";
    return (
      <SectionShell id="changes" tour="changes" title="How are things changing?" help="yoy" intro="Choose an indicator, what to show and a time range. Year-on-year change compares each period with the same period a year earlier.">
        <div className="rounded-md border border-rule bg-surface p-4">
          <div className="mb-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Seg label="Indicator" value={k} onChange={pick} options={VIEW_KEYS.map((x) => ({ key: x, label: VIEW_NAME[x].short }))} />
              <Seg label="Show" value={m} onChange={(x) => go({ chgm: x === "yoy" ? null : x })} options={[{ key: "yoy", label: "Year-on-year change %" }, { key: "level", label: "Level" }]} />
            </div>
            {bar}
          </div>
          {k === "gdp" ? GdpChange(m) : MonthlyChange({ k, m })}
        </div>
      </SectionShell>
    );
  }

  function MonthlyChange({ k, m }: { k: Exclude<ViewKey, "gdp">; m: ChangeMetric }) {
    const p = byKey(k);
    if (!p || p.b.error || !p.segs.length) {
      return (
        <div data-testid="change-panel">
          <Empty>{VIEW_NAME[k].short} data could not be loaded right now.</Empty>
        </div>
      );
    }
    // Which official series (base year) to show: ?chgs=<series id>; default = the current series. Bases are never joined.
    const wanted = params.get("chgs");
    const s = p.segs.find((x) => x.id === wanted) ?? p.segs[0];
    const isCurrent = s.id === p.segs[0].id;
    const val = (x: SegView, r: Derived) => (m === "level" ? r.index : x.official ? r.rate : r.yoyCalc);
    const w = monthlyWindow(s.rows, sel);
    const have = w.rows.filter((r) => val(s, r) !== null).length;
    const label = k === "iip" ? "industrial production growth" : k === "cpi" ? "consumer inflation" : "wholesale inflation";
    const period = periodSpan(w.first?.period ?? null, w.last?.period ?? null);
    const ids = seriesIds(k, s.baseYear, "general", s.series);
    const src = { ...p.b.source, baseYear: s.baseYear, coverage: s.coverage, seriesIds: ids, dataset: `${p.b.source.dataset} (${s.label})` };
    // Another stored series with MORE figures for the chosen range: say so and offer it, instead of a bare "no data".
    // Only for fixed calendar windows (Custom / a year) or when this series shows nothing: presets and All are relative to
    // each series' own history, so comparing month counts across series there would be misleading.
    const fixedWindow = sel.key === "Custom";
    const better = p.segs
      .filter(() => fixedWindow || have === 0)
      .filter((x) => x.id !== s.id)
      .map((x) => ({ x, n: monthlyWindow(x.rows, sel).rows.filter((r) => val(x, r) !== null).length }))
      .filter((a) => a.n > have)
      .sort((a, b) => b.n - a.n)[0];
    const choose = (id: string) => go({ chgs: id === p.segs[0].id ? null : id });

    const selector = (
      <div className="mb-3 space-y-1 text-sm">
        {p.segs.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`chg-base-${k}`} className="font-medium">
              Series (base year)
            </label>
            <HelpTip id="base-year" />
            <select id={`chg-base-${k}`} value={s.id} onChange={(e) => choose(e.target.value)} className={`min-w-0 max-w-full truncate rounded border border-rule bg-bg px-2 py-1 ${focusRing}`}>
              {p.segs.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label} ({x.span})
                </option>
              ))}
            </select>
          </div>
        )}
        <p data-testid="series-coverage" className="text-xs text-ink-muted">
          {s.label}: index {s.span}
          {s.official ? (s.rateSpan ? `; official ${k === "iip" ? "growth" : "inflation"} ${s.rateSpan}` : `; no official ${k === "iip" ? "growth" : "inflation"} stored`) : "; year-on-year change calculated from the index"}.
          {!isCurrent && " A separate official series: its index levels are not comparable with other base years and are never joined to them."}
        </p>
      </div>
    );
    const hint = better && (
      <p role="status" data-testid="series-hint" className="mt-2 rounded border border-warn px-3 py-2 text-sm">
        {have === 0 ? `${s.label} has no ${m === "level" ? "index values" : `${label} figures`} in this range.` : `${s.label} has only ${have} month${have === 1 ? "" : "s"} in this range.`}{" "}
        The {better.x.label} series has {better.n} month{better.n === 1 ? "" : "s"}.{" "}
        <button type="button" onClick={() => choose(better.x.id)} className={`font-medium text-accent underline ${focusRing}`}>
          Show {better.x.label}
        </button>
      </p>
    );

    if (m === "level") {
      return (
        <div data-testid="change-panel">
          {selector}
          <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
            {VIEW_NAME[k].short}: index level (base {s.baseYear} = 100) · {s.label} <ClassBadge cls="official" />
          </p>
          {w.stored >= 2 ? (
            <TimeChart series={[{ key: k, label: `${VIEW_NAME[k].short} index (${s.label})`, stroke: VIEW_COLOR[k], points: w.rows.map((r) => ({ n: r.n, v: r.index })) }]} yLabel={`Index (base ${s.baseYear} = 100)`} description={`${VIEW_NAME[k].short} index, ${s.label}, ${period}.`} />
          ) : (
            <Empty>{w.stored === 1 ? "Only one month falls in this range; a trend needs at least two." : `No months of ${s.label} fall in this range.`}</Empty>
          )}
          {hint}
          <p className="mt-2 text-sm">{explainLevel(k, w)}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <SourceAttribution cls="official" sources={[src]} period={period} units={`Index points, base ${s.baseYear} = 100`} />
            <Link href={`${pathFor(k)}${isCurrent ? "" : `?base=${encodeURIComponent(s.id)}`}`} className="text-sm font-medium text-accent underline">Explore {VIEW_NAME[k].short} in detail →</Link>
          </div>
        </div>
      );
    }
    const points = w.rows.map((r) => ({ n: r.n, v: val(s, r) }));
    return (
      <div data-testid="change-panel">
        {selector}
        <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
          {VIEW_NAME[k].short}: {label} (% year-on-year) · {s.label} <ClassBadge cls={s.official ? "official" : "calculated"} />
        </p>
        {have ? (
          <TimeChart kind="bars" barColor="series" signed unit="%" series={[{ key: k, label: `${label} (${s.label})`, stroke: VIEW_COLOR[k], points }]} yLabel="% change from a year earlier" description={`Bar chart of ${label}, ${s.label}, ${period}.`} />
        ) : (
          <Empty>
            No {label} figure for {s.label} in this range.{" "}
            {s.official ? `This series publishes it for ${s.rateSpan ?? "no months"}.` : "A calculated change needs the same month a year earlier in this series."}
          </Empty>
        )}
        {hint}
        <p className="mt-2 text-sm">{explainRate(label, w.rows.map((r) => ({ period: r.period, v: val(s, r) })), s.official)}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <SourceAttribution cls={s.official ? "official" : "calculated"} sources={[src]} period={period} units="% year-on-year" method={s.official ? undefined : "Calculated by ArthaSense from the official index of this series (same month a year earlier). Not an official rate."} />
          <Link href={`${pathFor(k)}${isCurrent ? "" : `?base=${encodeURIComponent(s.id)}`}`} className="text-sm font-medium text-accent underline">Explore {VIEW_NAME[k].short} in detail →</Link>
        </div>
      </div>
    );
  }

  function GdpChange(m: ChangeMetric) {
    if (!gdp.ok) {
      return (
        <div data-testid="change-panel">
          <Empty>GDP change cannot be shown: official quarterly GDP is not stored yet. No figure is estimated.</Empty>
        </div>
      );
    }
    const w = quarterWindow(gdpRows, sel);
    const period = w.rows.length ? `${quarterShort(w.rows[0].n)} – ${quarterShort(w.rows[w.rows.length - 1].n)}` : "no quarters";
    if (m === "level") {
      return (
        <div data-testid="change-panel">
          <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
            GDP: real level by fiscal quarter (₹ crore, constant {gdp.data.baseYear} prices) <ClassBadge cls="official" />
          </p>
          {w.tooShort ? (
            <Empty>GDP is quarterly, so a 2-month range cannot contain a full quarter. Choose 3M or longer.</Empty>
          ) : w.rows.some((r) => r.level !== null) ? (
            <TimeChart kind="bars" barColor="series" digits={2} stepMonths={3} formatN={quarterShort} series={[{ key: "gdp", label: "Real GDP (₹ lakh crore)", stroke: VIEW_COLOR.gdp, points: w.rows.map((r) => ({ n: r.n, v: r.level === null ? null : r.level / 1e5 })) }]} yLabel="₹ lakh crore, constant prices" description={`Real GDP level by quarter, ${period}.`} />
          ) : (
            <Empty>No GDP level is stored in this range.</Empty>
          )}
          <p className="mt-2 text-sm">Quarterly levels are not seasonally adjusted: compare a quarter with the same quarter of other years, not with the quarter before.</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <SourceAttribution cls="official" sources={[gdpSource(gdp.data)]} period={period} units="₹ crore, constant 2022-23 prices" />
            <Link href={pathFor("gdp")} className="text-sm font-medium text-accent underline">Explore GDP in detail →</Link>
          </div>
        </div>
      );
    }
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
    // Default: monthly indicators that have at least one year-on-year value (an indicator with too little history
    // would only add an empty line); fall back to all monthly indicators.
    const withYoy = available.filter((k) => k !== "gdp" && !!byKey(k)?.rows.some((r) => r.yoyCalc !== null));
    const picked = ci === null ? (withYoy.length >= 2 ? withYoy : available.filter((k) => k !== "gdp")) : parseCompareSel(ci, available);
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
