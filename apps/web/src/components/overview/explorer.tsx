"use client";

import { IndicatorLink } from "@/components/guide/indicator-link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { Heatmap } from "@/components/overview/heatmap";
import { type ChartSeries, TimeChart } from "@/components/overview/time-chart";
import { periodSpan, SourceAttribution } from "@/components/source/source-attribution";
import { formatPeriod, type IndicatorKey } from "@/lib/indicator";
import type { IndicatorBundle } from "@/lib/overview-data";
import {
  applyRange,
  commonWindow,
  type Derived,
  derive,
  heatGrid,
  OV_RANGES,
  parseRange,
  rebasePercent,
  type RangeSel,
  seedCustomRange,
  windowCsv,
  ymNumber,
} from "@/lib/overview";
import { seriesIds } from "@/lib/source";

const STROKE: Record<IndicatorKey, { stroke: string; dash?: string }> = {
  cpi: { stroke: "var(--accent)" },
  wpi: { stroke: "var(--target)", dash: "6 3" },
  iip: { stroke: "var(--down)", dash: "2 3" },
};
const IIP_WARNING =
  "Monthly industrial output changes can reflect seasonal patterns. Official year-over-year growth is often more useful for interpretation.";
const NOT_COMPARABLE = "These indicators measure different parts of the economy. Similar movement does not necessarily mean one caused the other.";

type CmpMode = "mom" | "yoy" | "aligned" | "rebased";
const CMP_MODES: { key: CmpMode; label: string }[] = [
  { key: "mom", label: "Monthly % change" },
  { key: "yoy", label: "Annual % change" },
  { key: "aligned", label: "Separate aligned charts" },
  { key: "rebased", label: "% change from common start" },
];

function Section({ id, tour, title, help, intro, children }: { id: string; tour?: string; title: string; help?: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} data-tour={tour} aria-labelledby={`${id}-h`} className="mt-10 scroll-mt-20">
      <h2 id={`${id}-h`} className="font-serif text-2xl font-semibold tracking-tight">
        {title}
        {help && <HelpTip id={help} />}
      </h2>
      {intro && <p className="mt-1 max-w-3xl text-sm text-ink-muted">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Card({ title, help, aside, children }: { title: string; help?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-rule bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {title}
          {help && <HelpTip id={help} />}
        </h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; label: string }[]; onChange: (k: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded border px-2.5 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
            value === o.key ? "border-accent bg-accent text-accent-ink" : "border-rule hover:border-accent"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-md border border-dashed border-rule px-4 py-8 text-center text-sm text-ink-muted">{children}</p>;
}

/** How much of the selected window is actually covered by stored data: never silently widened. */
function windowNote(shown: number, sel: RangeSel): string | null {
  const months = OV_RANGES.find((r) => r.key === sel.key)?.months;
  if (months && shown < months) return `The ${sel.key} window spans ${months} months, but only ${shown} have stored values. No other months are filled in.`;
  return null;
}

function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface Prepared {
  b: IndicatorBundle;
  rows: Derived[]; // primary (current-base) series, derived within that one base
}

export function OverviewExplorer({ bundles }: { bundles: IndicatorBundle[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const { sel, error: rangeError } = parseRange(params.get("range"), params.get("from"), params.get("to"));
  const indParam = params.get("ind") as IndicatorKey | null;
  const ind: IndicatorKey = bundles.some((b) => b.key === indParam) ? (indParam as IndicatorKey) : "wpi";
  const cmpParam = params.get("cmp") as CmpMode | null;
  const cmp: CmpMode = CMP_MODES.some((m) => m.key === cmpParam) ? (cmpParam as CmpMode) : "mom";
  const ann = params.get("ann") === "calc" ? "calc" : "official";

  const push = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const q = p.toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const [fromIn, setFromIn] = useState(sel.from ?? "");
  const [toIn, setToIn] = useState(sel.to ?? "");
  const [heatMetric, setHeatMetric] = useState<"mom" | "rate">("mom");
  const [baseSel, setBaseSel] = useState<Partial<Record<IndicatorKey, string>>>({});
  const [cmpPick, setCmpPick] = useState<IndicatorKey[]>(["cpi", "wpi", "iip"]);

  const prepared: Prepared[] = useMemo(
    () => bundles.map((b) => ({ b, rows: b.segments[0] ? derive(b.segments[0].observations) : [] })),
    [bundles],
  );
  const get = (k: IndicatorKey) => prepared.find((p) => p.b.key === k)!;

  const customOrder = fromIn && toIn && ymNumber(fromIn) !== null && ymNumber(toIn) !== null && ymNumber(fromIn)! > ymNumber(toIn)!;
  const setPreset = (key: string) => {
    if (key === "Custom") {
      // Seed a valid window from the stored data so the month inputs appear straight away.
      const valid = fromIn && toIn && ymNumber(fromIn) !== null && ymNumber(toIn) !== null && ymNumber(fromIn)! <= ymNumber(toIn)!;
      const seed = valid ? { from: fromIn, to: toIn } : seedCustomRange(prepared.map((p) => p.rows));
      if (!seed) return;
      setFromIn(seed.from);
      setToIn(seed.to);
      push({ range: "Custom", from: seed.from, to: seed.to });
    }
    else push({ range: key === "All" ? null : key, from: null, to: null });
  };
  const applyCustom = (f: string, t: string) => {
    setFromIn(f);
    setToIn(t);
    if (ymNumber(f) !== null && ymNumber(t) !== null && ymNumber(f)! <= ymNumber(t)!) push({ range: "Custom", from: f, to: t });
  };

  const sourcesOf = (ps: Prepared[]) => ps.map((p) => p.b.source);

  // ---------- change panels (single selected indicator) ----------
  const cur = get(ind);
  const curVisible = applyRange(cur.rows, sel);
  const momPoints = curVisible.map((r) => ({ n: r.n, v: r.mom }));
  const annPoints = curVisible.map((r) => ({ n: r.n, v: ann === "official" ? r.rate : r.yoyCalc }));
  const hasOfficial = cur.b.rateKind !== null;

  // ---------- comparison ----------
  const picked = prepared.filter((p) => cmpPick.includes(p.b.key));
  const win = commonWindow(picked.map((p) => p.rows.filter((r) => r.index !== null)), sel);
  const inWin = (r: Derived) => win !== null && r.n >= win.lo && r.n <= win.hi;
  const cmpSeries = (metric: "mom" | "yoyCalc" | "rebased"): ChartSeries[] =>
    picked.map((p) => {
      const rows = p.rows.filter(inWin);
      const rebased = metric === "rebased" ? rebasePercent(rows).values : null;
      return {
        key: p.b.key,
        label: p.b.shortName,
        ...STROKE[p.b.key],
        points: rows.map((r) => ({ n: r.n, v: rebased ? (rebased.get(r.n) ?? null) : r[metric as "mom" | "yoyCalc"] })),
      };
    });

  // ---------- heatmap ----------
  const heatRows = curVisible.map((r) => ({ n: r.n, v: heatMetric === "mom" ? r.mom : r.rate }));

  return (
    <>
      <div data-tour="range" className="sticky top-0 z-20 mt-8 rounded-md border border-rule bg-surface/95 p-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm font-medium">Time range</p>
          <Seg label="Time range" value={sel.key} options={OV_RANGES.map((r) => ({ key: r.key, label: r.label }))} onChange={setPreset} />
          {sel.key === "Custom" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label>
                From <input type="month" value={fromIn} onChange={(e) => applyCustom(e.target.value, toIn)} className="rounded border border-rule bg-bg px-2 py-1" />
              </label>
              <label>
                To <input type="month" value={toIn} onChange={(e) => applyCustom(fromIn, e.target.value)} className="rounded border border-rule bg-bg px-2 py-1" />
              </label>
            </div>
          )}
        </div>
        <p className="mt-1.5 text-xs text-ink-muted">
          Applies to the charts below (not to the latest-value cards above). Relative ranges end at each series&apos; latest stored month; comparisons use the months every selected series shares.
        </p>
        {(rangeError || customOrder) && (
          <p role="alert" className="mt-1 text-xs text-up">
            {rangeError ?? "The start month must not be after the end month."}
          </p>
        )}
      </div>

      {/* ---------- trends ---------- */}
      <Section id="trends" tour="trends" title="Historical trends" help="trend-chart" intro="Each indicator has its own scale and base year, so these charts are deliberately separate. Do not compare line heights across them.">
        <div className="grid gap-4 lg:grid-cols-3">
          {prepared.map(({ b }) => {
            const seg = b.segments.find((s) => s.id === baseSel[b.key]) ?? b.segments[0];
            const rows = seg ? derive(seg.observations).filter((r) => r.index !== null) : [];
            const shown = applyRange(rows, sel);
            const first = shown[0]?.period ?? null;
            const last = shown[shown.length - 1]?.period ?? null;
            const note = windowNote(shown.length, sel);
            const vals = shown.map((r) => r.index as number);
            const nonZero = vals.length > 0 && Math.min(...vals) > 0;
            return (
              <Card
                key={b.key}
                title={`${b.shortName} index`}
                help={b.key}
                aside={
                  b.segments.length > 1 && (
                    <label className="text-xs">
                      <span className="sr-only">Base year series for {b.shortName}</span>
                      <select
                        value={seg?.id}
                        onChange={(e) => setBaseSel((s) => ({ ...s, [b.key]: e.target.value }))}
                        className="rounded border border-rule bg-bg px-1.5 py-1"
                      >
                        {b.segments.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </label>
                  )
                }
              >
                {b.error ? (
                  <Empty>Unable to load {b.shortName} data. Please check the API connection.</Empty>
                ) : shown.length < 2 ? (
                  <Empty>
                    {shown.length === 0
                      ? `No ${b.shortName} observations fall in the selected window.`
                      : `Only one ${b.shortName} observation (${formatPeriod(shown[0].period, true)}) falls in this window; a trend needs at least two.`}
                  </Empty>
                ) : (
                  <TimeChart
                    series={[{ key: b.key, label: b.shortName, ...STROKE[b.key], dash: undefined, points: shown.map((r) => ({ n: r.n, v: r.index })) }]}
                    yLabel={`${b.shortName} index (base ${seg?.baseYear ?? ""} = 100)`}
                    description={`Line chart of the ${b.fullName}, ${periodSpan(first, last)}, base ${seg?.baseYear}.`}
                  />
                )}
                {note && <p className="mt-1 text-xs text-warn">{note}</p>}
                {nonZero && shown.length >= 2 && <p className="mt-1 text-xs text-ink-muted">The vertical axis does not start at zero.</p>}
                {seg && seg.id !== "current" && (
                  <p className="mt-1 text-xs text-warn">
                    Earlier series ({seg.label}). Its index levels are not comparable with the current base.
                  </p>
                )}
                {shown.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        downloadCsv(
                          `${b.key}-${shown[0].period.slice(0, 7)}-to-${shown[shown.length - 1].period.slice(0, 7)}.csv`,
                          windowCsv(shown, {
                            indicator: b.shortName,
                            baseYear: seg?.baseYear ?? "",
                            source: b.source.short,
                            publisher: b.source.publisher,
                            seriesId: seg ? seriesIds(b.key, seg.baseYear, "general", seg.series ?? null)[0] : b.source.seriesIds[0],
                            rateColumn: b.rateKind === "inflation" ? "yoy_inflation_pct_official" : b.rateKind === "growth" ? "yoy_growth_pct_official" : null,
                          }),
                        )
                      }
                      className="rounded border border-rule px-2 py-1 hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      Download CSV
                    </button>
                    <details>
                      <summary className="cursor-pointer text-accent underline focus-visible:outline-2 focus-visible:outline-accent">Monthly data</summary>
                      <div className="relative mt-2 max-h-64 overflow-auto rounded border border-rule" role="region" aria-label={`${b.shortName} monthly data, scrollable`} tabIndex={0}>
                        <table className="w-full text-left">
                          <caption className="sr-only">{b.shortName} monthly values for the selected window. Blank means not available.</caption>
                          <thead className="sticky top-0 bg-surface text-ink-muted">
                            <tr>
                              <th scope="col" className="px-2 py-1 font-medium">Month</th>
                              <th scope="col" className="px-2 font-medium">Index</th>
                              <th scope="col" className="px-2 font-medium">MoM % (calc.)</th>
                              <th scope="col" className="px-2 font-medium">Official YoY %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...shown].reverse().map((r) => (
                              <tr key={r.period} className="border-t border-rule">
                                <th scope="row" className="px-2 py-1 font-normal">{formatPeriod(r.period)}</th>
                                <td className="figure px-2">{r.index?.toFixed(2) ?? ""}</td>
                                <td className="figure px-2">{r.mom === null ? "" : r.mom.toFixed(2)}</td>
                                <td className="figure px-2">{r.rate === null ? "" : r.rate.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>
                )}
                <SourceAttribution
                  className="mt-3"
                  cls="official"
                  sources={[{ ...b.source, baseYear: seg?.baseYear ?? b.source.baseYear, coverage: seg?.coverage ?? b.source.coverage, seriesIds: seg ? seriesIds(b.key, seg.baseYear, "general", seg.series ?? null) : b.source.seriesIds }]}
                  period={periodSpan(first, last)}
                  units="Index points"
                />
                <IndicatorLink path={b.path} className="mt-2 inline-block rounded text-sm font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent">
                  Full {b.shortName} explorer →
                </IndicatorLink>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* ---------- changes ---------- */}
      <Section id="changes" tour="changes" title="How are things changing?" help="mom" intro="Pick an indicator. Monthly bars are calculated by ArthaSense from consecutive months of the current base series.">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Seg label="Indicator" value={ind} options={prepared.map((p) => ({ key: p.b.key, label: p.b.shortName }))} onChange={(k) => push({ ind: k === "wpi" ? null : k })} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={`${cur.b.shortName}: month-over-month change`} help="mom">
            {momPoints.some((p) => p.v !== null) ? (
              <TimeChart
                kind="bars"
                signed
                unit="%"
                series={[{ key: "mom", label: "MoM %", stroke: "var(--up)", points: momPoints }]}
                yLabel="Change from previous month (%)"
                description={`Bar chart of calculated month-over-month percentage change in the ${cur.b.fullName}.`}
              />
            ) : (
              <Empty>No month-over-month change can be calculated in this window: it needs two consecutive stored months.</Empty>
            )}
            <p className="mt-2 text-xs text-ink-muted">Formula: ((current index ÷ previous month index) − 1) × 100. Months without a stored predecessor show no bar. Warm = higher than the month before, blue = lower.</p>
            {cur.b.key === "iip" && <p className="mt-2 rounded border border-warn px-2 py-1 text-xs text-warn">{IIP_WARNING}</p>}
            <SourceAttribution
              className="mt-3"
              cls="calculated"
              sources={sourcesOf([cur])}
              period={periodSpan(curVisible[0]?.period ?? null, curVisible[curVisible.length - 1]?.period ?? null)}
              units="% change"
              method="Monthly change calculated by ArthaSense from the official index. It is not an official rate."
            />
          </Card>

          <Card title={`${cur.b.shortName}: compared with last year`} help="yoy" aside={<Seg label="Annual metric" value={ann} options={[{ key: "official", label: "Official" }, { key: "calc", label: "Calculated" }]} onChange={(k) => push({ ann: k === "official" ? null : k })} />}>
            {ann === "official" && !hasOfficial ? (
              <Empty>
                {cur.b.rateMissingText} You can switch to the calculated year-over-year change, which is derived from the index and labelled as calculated.
              </Empty>
            ) : annPoints.some((p) => p.v !== null) ? (
              <TimeChart
                kind="bars"
                signed
                unit="%"
                series={[{ key: "ann", label: "Annual %", stroke: "var(--up)", points: annPoints }]}
                yLabel={ann === "official" ? "Official year-on-year (%)" : "Calculated year-on-year (%)"}
                description={`Bar chart of ${ann === "official" ? "official" : "calculated"} year-over-year change in the ${cur.b.fullName}.`}
              />
            ) : (
              <Empty>
                {ann === "official"
                  ? `No official year-on-year ${cur.b.shortName} figure is stored for this window.`
                  : "A calculated annual change needs the same month a year earlier, which is not stored for any month in this window."}
              </Empty>
            )}
            <p className="mt-2 text-xs text-ink-muted">
              {ann === "official"
                ? "Official figures are shown exactly as published by the source."
                : "Calculated: ((current index ÷ same month previous year index) − 1) × 100, within one base year only. This is not the official figure."}
            </p>
            <SourceAttribution
              className="mt-3"
              cls={ann === "official" ? "official" : "calculated"}
              sources={sourcesOf([cur])}
              period={periodSpan(curVisible[0]?.period ?? null, curVisible[curVisible.length - 1]?.period ?? null)}
              units="% change"
              method={ann === "official" ? undefined : "Annual change calculated by ArthaSense from the official index."}
            />
          </Card>
        </div>
      </Section>

      {/* ---------- comparison ---------- */}
      <Section id="compare" tour="compare" title="Compare economic trends" help="comparison" intro={NOT_COMPARABLE}>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Seg label="Comparison mode" value={cmp} options={CMP_MODES} onChange={(k) => push({ cmp: k === "mom" ? null : k })} />
          <fieldset className="flex gap-3 text-sm">
            <legend className="sr-only">Indicators to compare</legend>
            {prepared.map(({ b }) => (
              <label key={b.key} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={cmpPick.includes(b.key)}
                  onChange={(e) => setCmpPick((c) => (e.target.checked ? [...c, b.key] : c.filter((k) => k !== b.key)))}
                />
                {b.shortName}
              </label>
            ))}
          </fieldset>
        </div>
        {picked.length < 2 ? (
          <Empty>Select at least two indicators to compare.</Empty>
        ) : !win ? (
          <Empty>
            The selected indicators have no calendar months in common within this window, so no valid comparison can be drawn. Widen the range or choose other indicators.
          </Empty>
        ) : (
          <div className="rounded-md border border-rule bg-surface p-4">
            <p className="mb-2 text-xs text-ink-muted">
              Common window: {formatPeriod(`${Math.floor(win.lo / 12)}-${String((win.lo % 12) + 1).padStart(2, "0")}-01`)} to{" "}
              {formatPeriod(`${Math.floor(win.hi / 12)}-${String((win.hi % 12) + 1).padStart(2, "0")}-01`)}. Only the current base series of each indicator is used.
            </p>
            {cmp === "aligned" ? (
              <div className="grid gap-4 md:grid-cols-3">
                {picked.map((p) => (
                  <div key={p.b.key}>
                    <p className="mb-1 text-sm font-medium">{p.b.shortName} (base {p.b.segments[0]?.baseYear})</p>
                    <TimeChart
                      series={[{ key: p.b.key, label: p.b.shortName, ...STROKE[p.b.key], dash: undefined, points: p.rows.filter(inWin).map((r) => ({ n: r.n, v: r.index })) }]}
                      yLabel="Index points"
                      description={`Aligned chart of ${p.b.fullName} over the common window.`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <TimeChart
                signed
                unit="%"
                series={cmpSeries(cmp === "mom" ? "mom" : cmp === "yoy" ? "yoyCalc" : "rebased")}
                yLabel={cmp === "mom" ? "Monthly change (%)" : cmp === "yoy" ? "Annual change (%, calculated)" : "Change since common start (%)"}
                description={`Comparison of ${picked.map((p) => p.b.shortName).join(", ")}: ${CMP_MODES.find((m) => m.key === cmp)?.label}.`}
              />
            )}
            {cmp === "rebased" && (
              <p className="mt-2 text-xs text-ink-muted">
                Each line is the % change from its own first month in the common window, so all start at 0%. Starts: {picked.map((p) => `${p.b.shortName} ${rebasePercent(p.rows.filter(inWin)).start ? formatPeriod(rebasePercent(p.rows.filter(inWin)).start!) : "n/a"}`).join(", ")}.
              </p>
            )}
            {cmp === "yoy" && <p className="mt-2 text-xs text-ink-muted">Calculated from index levels so all three use the same definition; official rates differ in definition and availability (WPI has none).</p>}
            {picked.some((p) => p.b.key === "iip") && cmp === "mom" && <p className="mt-2 text-xs text-warn">{IIP_WARNING}</p>}
            <SourceAttribution
              className="mt-3"
              cls={cmp === "aligned" ? "official" : "calculated"}
              sources={sourcesOf(picked)}
              period="common window shown above"
              units={cmp === "aligned" ? "Index points (separate scales)" : "% change"}
              method={cmp === "aligned" ? undefined : "Percent changes calculated by ArthaSense from each official index."}
            />
          </div>
        )}
      </Section>

      {/* ---------- heatmap ---------- */}
      <Section id="heatmap" title="Monthly heatmap" help="heatmap" intro="Years down, months across. Pick an indicator above (under “How are things changing?”) or switch the metric here.">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Seg label="Heatmap indicator" value={ind} options={prepared.map((p) => ({ key: p.b.key, label: p.b.shortName }))} onChange={(k) => push({ ind: k === "wpi" ? null : k })} />
          <Seg label="Heatmap metric" value={heatMetric} options={[{ key: "mom", label: "Monthly change (calculated)" }, { key: "rate", label: "Official annual rate" }]} onChange={setHeatMetric} />
        </div>
        <div className="rounded-md border border-rule bg-surface p-4">
          {heatMetric === "rate" && !hasOfficial ? (
            <Empty>{cur.b.rateMissingText}</Empty>
          ) : heatRows.filter((p) => p.v !== null).length === 0 ? (
            <Empty>
              {heatMetric === "rate"
                ? `No official ${cur.b.shortName} year-on-year figures are stored for this window, so none are shown.`
                : "Limited history: not enough consecutive stored months in this window to show values."}
            </Empty>
          ) : (
            <Heatmap rows={heatGrid(heatRows)} unit="%" label={`${cur.b.shortName} ${heatMetric === "mom" ? "monthly change" : "official annual rate"}`} />
          )}
          <SourceAttribution
            className="mt-3"
            cls={heatMetric === "mom" ? "calculated" : "official"}
            sources={sourcesOf([cur])}
            period={periodSpan(curVisible[0]?.period ?? null, curVisible[curVisible.length - 1]?.period ?? null)}
            units="% change"
            method={heatMetric === "mom" ? "Monthly change calculated by ArthaSense from the official index." : undefined}
          />
        </div>
      </Section>
    </>
  );
}
