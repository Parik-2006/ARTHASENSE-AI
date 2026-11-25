"use client";

import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { Sparkline } from "@/components/indicators/indicator-summary";
import { gdpSource } from "@/components/indicators/detail/indicator-detail";
import { useRange } from "@/components/indicators/detail/use-range";
import { CalcExplainer } from "@/components/overview/calc-explainer";
import { TimeChart } from "@/components/overview/time-chart";
import { Empty, SectionShell, Seg } from "@/components/overview/v3/ui";
import { ClassBadge, periodSpan, SourceAttribution } from "@/components/source/source-attribution";
import { deriveGdp, type GdpResult, type GdpRow, quarterLabel, quarterShort } from "@/lib/gdp";
import { formatIndex, formatPeriod, formatTimestamp } from "@/lib/indicator";
import { explainGdp, explainLevel, explainRate, monthlyWindow, pathFor, quarterWindow, VIEW_COLOR, VIEW_KEYS, VIEW_NAME, type ViewKey } from "@/lib/indicator-view";
import { derive, type Derived, seedCustomRange } from "@/lib/overview";
import type { IndicatorBundle } from "@/lib/overview-data";
import { buildYearComparison, calendarQuarter } from "@/lib/overview-v3";
import { calendarToFiscal, type Explanation, fixed, gdpExplanation, gdpQuarterDetail, methodAverageOfMonthlyYoy, monthlyExplanation, monthlyQuarterDetail, type QuarterDetail, seriesPrecision } from "@/lib/calc-explain";
import { seriesIds } from "@/lib/source";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** "Compare economic trends" always shows this calendar year (product decision, 2026-11-23). */
export const COMPARE_YEAR = 2026;

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
            <li key={k} className="flex min-w-0 flex-col">
              {k === "gdp" ? GdpCard() : MonthlyCard({ p: byKey(k), k })}
              <div className="rounded-b-md border border-t-0 border-rule bg-surface px-4 pb-2 pt-0.5">
                <CalcExplainer explanation={explainFor(k)} terms={termsFor(k)} testId={`explain-${k}`} />
              </div>
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
        className={`group flex flex-1 flex-col rounded-t-md border border-b-0 border-rule border-t-4 bg-surface p-4 transition-colors hover:border-accent ${focusRing}`}
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

  /** Calculation explanation of the figure a card shows (same latest row, same series, same precision). */
  function explainFor(k: ViewKey): Explanation | null {
    if (k === "gdp") return gdp.ok ? gdpExplanation(gdpRows, gdp.data.baseYear, { name: "MoSPI (NSO) National Accounts", url: gdp.data.sourceUrl ?? "https://www.mospi.gov.in/", retrieved: day(gdpSource(gdp.data).retrievedAt) }) : null;
    const p = byKey(k);
    const seg = p?.b.segments[0];
    if (!p || p.b.error || !seg) return null;
    return monthlyExplanation({ key: k, rows: p.rows, official: p.official, baseYear: seg.baseYear, source: { name: `${p.b.source.short} · ${p.b.source.dataset}`, url: p.b.source.url ?? p.b.source.publisherUrl, retrieved: day(p.b.source.retrievedAt) } });
  }

  function termsFor(k: ViewKey): string[] {
    if (k === "gdp") return ["real-gdp", "fiscal-quarter", "yoy", "official", "source"];
    return ["index-value", "base-year", "yoy", ...(k === "iip" ? [] : ["inflation"]), k === "wpi" ? "calculated" : "official", "percentage-points", "current-legacy", "source"];
  }

  function MonthlyCard({ p, k }: { p: Prep | undefined; k: Exclude<ViewKey, "gdp"> }) {
    const seg = p?.b.segments[0];
    const valid = p ? p.rows.filter((r) => r.index !== null) : [];
    const last = valid[valid.length - 1];
    const rateRow = p ? [...p.rows].reverse().find((r) => rateOf(p, r) !== null) : undefined;
    // Shown with the source's own precision (WPI/IIP indices and IIP growth have one decimal), never extra digits.
    const idxDp = seriesPrecision(valid.map((r) => r.index));
    const rateDp = p?.official ? seriesPrecision(p.rows.map((r) => r.rate)) : 2;
    const footer =
      p && seg ? (
        <>
          Source: {p.b.source.short} · base {seg.baseYear} · published monthly
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
              <span className="figure block text-3xl font-medium tracking-tight">{last.index === null ? formatIndex(null) : fixed(last.index, idxDp)}</span>
              <span className="block text-xs text-ink-muted">Index, base {seg!.baseYear} = 100 · {formatPeriod(last.period, true)}</span>
              {rateRow && (
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="figure font-medium">{fixed(rateOf(p, rateRow) as number, rateDp)}%</span>
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
            Source: MoSPI (NSO) National Accounts · base {gdp.data.baseYear} · published quarterly
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
    const idxDp = seriesPrecision(s.rows.map((r) => r.index));
    const rateDp = s.official ? seriesPrecision(s.rows.map((r) => r.rate)) : 2;
    const yearAgo = (n: number) => formatPeriod(`${Math.floor((n - 12) / 12)}-${String(((n - 12) % 12) + 1).padStart(2, "0")}-01`);
    const tipYoy = (n: number) => [`vs ${yearAgo(n)} · base ${s.baseYear}`, s.official ? `Official (${p.b.source.short})` : "Calculated by ArthaSense"];
    const tipLevel = () => [`Index, base ${s.baseYear} = 100`, `Official (${p.b.source.short})`];
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
            <TimeChart digits={idxDp} tipExtra={tipLevel} series={[{ key: k, label: `${VIEW_NAME[k].short} index (${s.label})`, stroke: VIEW_COLOR[k], points: w.rows.map((r) => ({ n: r.n, v: r.index })) }]} yLabel={`Index (base ${s.baseYear} = 100)`} description={`${VIEW_NAME[k].short} index, ${s.label}, ${period}.`} />
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
          <TimeChart kind="bars" barColor="series" signed unit="%" digits={rateDp} tipExtra={tipYoy} series={[{ key: k, label: `${label} (${s.label})`, stroke: VIEW_COLOR[k], points }]} yLabel="% change from a year earlier" description={`Bar chart of ${label}, ${s.label}, ${period}.`} />
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
            <TimeChart kind="bars" barColor="series" digits={2} stepMonths={3} formatN={quarterShort} tipExtra={(n) => [quarterLabel(n).replace(/^Q\d FY\S+ /, ""), "Constant 2022-23 prices", "Official (MoSPI NSO)"]} series={[{ key: "gdp", label: "Real GDP (₹ lakh crore)", stroke: VIEW_COLOR.gdp, points: w.rows.map((r) => ({ n: r.n, v: r.level === null ? null : r.level / 1e5 })) }]} yLabel="₹ lakh crore, constant prices" description={`Real GDP level by quarter, ${period}.`} />
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
          <TimeChart kind="bars" barColor="series" signed unit="%" digits={1} stepMonths={3} formatN={quarterShort} tipExtra={(n) => [quarterLabel(n).replace(/^Q\d FY\S+ /, ""), `vs ${quarterShort(n - 12)}, constant prices`, "Official (MoSPI NSO)"]} series={[{ key: "gdp", label: "Real GDP growth", stroke: VIEW_COLOR.gdp, points: w.rows.map((r) => ({ n: r.n, v: r.growthOfficial })) }]} yLabel="% change from a year earlier" description={`Official real GDP growth by quarter, ${period}.`} />
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

  /** Every plotted point, inspectable: the months and averages used (calculated) or the official figure (GDP). */
  function CompareBreakdown({ quarters, keys }: { quarters: number[]; keys: ViewKey[] }) {
    const rows: QuarterDetail[] = quarters.flatMap((n) =>
      keys.map((k) => (k === "gdp" ? gdpQuarterDetail(gdpRows, n) : monthlyQuarterDetail(k, byKey(k)?.rows ?? [], n))),
    );
    // Method A (average of the three monthly year-on-year rates) differs from the method used; report by how much.
    const gaps = rows
      .filter((d) => d.provenance === "calculated" && d.result !== null)
      .map((d) => {
        const a = methodAverageOfMonthlyYoy(byKey(d.key)?.rows ?? [], d.n);
        return a === null ? null : Math.abs((d.result as number) - a);
      })
      .filter((x): x is number => x !== null);
    const dpOf = (k: ViewKey) => (k === "gdp" ? 1 : seriesPrecision((byKey(k)?.rows ?? []).map((r) => r.index)));
    const months = (ms: QuarterDetail["months"], k: ViewKey) => ms.map((m) => `${m.label.slice(0, 3)} ${fixed(m.value, dpOf(k))}`).join(", ");
    return (
      <details className="mt-3 rounded border border-rule" data-testid="compare-breakdown">
        <summary className={`cursor-pointer px-3 py-2 text-sm font-medium ${focusRing}`}>How was each point calculated?</summary>
        <div className="overflow-x-auto px-3 pb-3" role="region" aria-label="Calculation of each plotted point (scrollable)" tabIndex={0}>
          <table className="w-full min-w-[40rem] text-xs">
            <caption className="sr-only">Months and averages behind each quarterly point</caption>
            <thead>
              <tr className="border-b border-rule text-left">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Quarter</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Indicator</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">This quarter (index)</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Same quarter a year earlier</th>
                <th scope="col" className="py-1.5 text-right font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={`${d.n}-${d.key}`} className="border-b border-rule align-top last:border-b-0">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    {calendarQuarter(d.n)}
                    <span className="block text-ink-muted">{calendarToFiscal(d.n)}</span>
                  </th>
                  <td className="py-1.5 pr-3">{VIEW_NAME[d.key].short}</td>
                  {d.provenance === "official" ? (
                    <td colSpan={2} className="py-1.5 pr-3 text-ink-muted">
                      Official real GDP growth as published by MoSPI (NSO): the quarter vs the same quarter a year earlier, constant prices.
                    </td>
                  ) : (
                    <>
                      <td className="figure py-1.5 pr-3">
                        {months(d.months, d.key)}
                        {d.avg !== null && <span className="block text-ink-muted">average {d.avg.toFixed(4)}</span>}
                      </td>
                      <td className="figure py-1.5 pr-3">
                        {months(d.prevMonths, d.key)}
                        {d.prevAvg !== null && <span className="block text-ink-muted">average {d.prevAvg.toFixed(4)}</span>}
                      </td>
                    </>
                  )}
                  <td className="figure py-1.5 text-right">
                    {d.result === null ? <span className="text-ink-muted">not shown: {d.missing}</span> : `${d.result > 0 ? "+" : ""}${fixed(d.result, 1)}%`}
                    <span className="block text-ink-muted">{d.provenance === "official" ? "official" : "calculated"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-ink-muted">
            Calculated change = ((average of this quarter ÷ average of the same quarter a year earlier) − 1) × 100. Averaging index levels first and then comparing is not the same as
            averaging three monthly year-on-year rates
            {gaps.length ? `; in this chart the two differ by at most ${Math.max(...gaps).toFixed(3)} percentage points` : ""}.
          </p>
        </div>
      </details>
    );
  }

  // ============================== Section 3: compare (2026 only) ==============================
  // One calendar year, permanently 2026 (COMPARE_YEAR), all four indicators, year-on-year by quarter. No indicator,
  // mode or range controls: this section does not read or write the URL, so stale ?ci= / ?cmp= links are ignored and
  // Section 2's range is not shared.
  function Compare() {
    const result = buildYearComparison({ monthly: prepared.map((p) => ({ key: p.b.key, rows: p.rows })), gdp: gdp.ok ? { rows: gdpRows } : null, year: COMPARE_YEAR });
    const sources = [...prepared.map((p) => p.b.source), ...(gdp.ok ? [gdpSource(gdp.data)] : [])];
    const notes = [...result.notes, ...(gdp.ok ? [] : ["GDP is not stored yet, so it is not drawn. No GDP figure is estimated."])];
    const span = result.quarters.length ? `${calendarQuarter(result.quarters[0])} – ${calendarQuarter(result.quarters[result.quarters.length - 1])}` : "no quarters";
    return (
      <SectionShell id="compare" tour="compare" title="Compare economic trends" help="comparison" intro="How prices, industrial output and GDP changed from a year earlier, quarter by quarter. Only percentage changes are compared: index points and rupees are different units.">
        <div className="rounded-md border border-rule bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-ink-muted">Year</span>
            <span data-testid="compare-year" aria-label={`Showing calendar year ${result.year ?? "none"}`} className="rounded border border-accent bg-accent px-2.5 py-1 font-medium text-accent-ink">
              {result.year ?? "—"}
            </span>
          </div>
          <p className="mb-2 text-xs text-ink-muted" data-testid="compare-method">
            <strong className="text-ink">Quarterly, year-on-year.</strong>
            <HelpTip id="gdp-quarterly" /> For CPI, WPI and IIP, ArthaSense averages the index over the quarter&apos;s three months and compares that average with the same three months a year earlier
            (calculated; only when all six months are stored). GDP shows its official real growth for the quarter, as published. No monthly GDP is created.
          </p>
          {result.problem ? (
            <Empty>{result.problem}</Empty>
          ) : (
            <>
              <TimeChart
                signed
                unit="%"
                digits={1}
                stepMonths={3}
                formatN={calendarQuarter}
                series={result.series.map((s) => ({ ...s, stroke: VIEW_COLOR[s.key as ViewKey] ?? s.stroke }))}
                yLabel="Change from the same quarter a year earlier (%)"
                description={`Year-on-year change of ${result.series.map((s) => s.label).join(", ")} by quarter, ${span}.`}
                tipExtra={(n) => [`${calendarToFiscal(n)} · vs same quarter ${Math.floor(n / 12) - 1}`, "GDP official; others calculated", "(3-month average index)"]}
              />
              <CompareBreakdown quarters={result.quarters} keys={result.series.map((x) => x.key as ViewKey)} />
              <p className="mt-2 text-xs text-ink-muted" data-testid="compare-fiscal">
                Fiscal quarters: {result.quarters.map((n) => `${calendarQuarter(n).replace(/ \d{4}$/, "")} = ${quarterShort(n)}`).join(" · ")}
              </p>
              {notes.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-muted" data-testid="compare-notes">
                  {notes.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
              <SourceAttribution className="mt-3" cls="calculated" sources={sources} period={span} units="% change from a year earlier" method="CPI, WPI and IIP: calculated by ArthaSense from each indicator's current official series as ((average index of the quarter's 3 months ÷ average of the same 3 months a year earlier) − 1) × 100; not official rates. GDP: official real growth (constant prices) as published by MoSPI (NSO)." />
            </>
          )}
        </div>
      </SectionShell>
    );
  }
}
