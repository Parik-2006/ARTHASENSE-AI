"use client";

import { useMemo, useState } from "react";
import { Help } from "@/components/artha/help";
import { SourceAttribution } from "@/components/source/source-attribution";
import { TrendChart } from "@/components/indicators/indicator-dashboard";
import { SeriesChart } from "@/components/indicators/series-chart";
import { Panel } from "@/components/ui/primitives";
import { inWindow, resolveWindow, withDerived, type RangeKey } from "@/lib/analysis";
import {
  formatIndex,
  formatPercent,
  formatPeriod,
  lastRetrievedAt,
  latestObservation,
  monthNumber,
  withMomChange,
} from "@/lib/indicator";
import type { IipSectorsResult } from "@/lib/iip-sectors";
import { IIP_CONFIG } from "@/lib/indicators";
import { seriesIds, sourceFor } from "@/lib/source";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const RANGES: RangeKey[] = ["1Y", "2Y", "3Y", "All"];

/** Latest month in which EVERY given sector has an official growth value (so bars are comparable). */
export function commonGrowthMonth(sectors: { observations: { period: string; rate: number | null }[] }[]): string | null {
  if (!sectors.length) return null;
  const sets = sectors.map((s) => new Set(s.observations.filter((o) => o.rate !== null).map((o) => o.period)));
  const shared = [...sets[0]].filter((p) => sets.every((s) => s.has(p))).sort();
  return shared.length ? shared[shared.length - 1] : null;
}

/** Sector totals (Mining, Manufacturing, Electricity, Water). Shows only what is stored. */
export function IipSectorPanel({ result }: { result: IipSectorsResult }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [range, setRange] = useState<RangeKey>("All");
  const sectors = useMemo(() => (result.ok ? result.data.sectors.filter((s) => s.observations.length > 0) : []), [result]);
  const active = sectors.find((s) => s.key === selected) ?? sectors[0];
  const rows = useMemo(() => (active ? withMomChange(active.observations) : []), [active]);
  const month = useMemo(() => commonGrowthMonth(sectors), [sectors]);

  if (!result.ok) {
    return (
      <Panel title="Industrial breakdown">
        <p role="alert" className="text-sm text-up">
          Unable to load the sector breakdown. Please check the API connection.
        </p>
      </Panel>
    );
  }
  if (sectors.length === 0) {
    return (
      <Panel title="Industrial breakdown">
        <p className="text-sm text-ink-muted">No sector observations have been imported yet.</p>
      </Panel>
    );
  }
  const base = result.data.baseYear;
  const retrieved = lastRetrievedAt(sectors.flatMap((s) => s.observations));
  const sectorSource = {
    ...sourceFor(IIP_CONFIG, null),
    baseYear: base,
    retrievedAt: retrieved,
    coverage: `India · ${sectors.map((s) => s.label).join(", ")} (sector totals)`,
    seriesIds: sectors.flatMap((s) => seriesIds("iip", base, s.key)),
  };
  const toggle = (k: string) => setCompare((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const compared = sectors.filter((s) => compare.includes(s.key));
  const ranking = month
    ? sectors
        .map((s) => ({ s, v: s.observations.find((o) => o.period === month)?.rate ?? null }))
        .filter((x): x is { s: (typeof sectors)[number]; v: number } => x.v !== null)
        .sort((a, b) => b.v - a.v)
    : [];
  const maxAbs = Math.max(0.0001, ...ranking.map((r) => Math.abs(r.v)));

  return (
    <Panel
      title="Industrial breakdown"
      footnote={
        <>
          <p className="mb-1">
            Sector totals as published by MoSPI. Each sector has its own index level; levels are not additive and not
            comparable between sectors.
          </p>
          <SourceAttribution
            cls="official"
            sources={[sectorSource]}
            period={month ? `${formatPeriod(month, true)} (common month) and history` : "history"}
            units="Index and % year-on-year, as published"
          />
        </>
      }
    >
      <div role="group" aria-label="Sector" className="mb-4 flex flex-wrap gap-2">
        {sectors.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={active?.key === s.key}
            onClick={() => setSelected(s.key)}
            className={`rounded border px-3 py-1 text-sm ${focusRing} ${
              active?.key === s.key ? "border-accent bg-accent text-accent-ink" : "border-rule hover:bg-bg"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {active && (
        <>
          <p className="mb-2 text-sm font-medium">{active.label} · index (base {base} = 100)</p>
          <TrendChart rows={rows} axisLabel={`${active.label} index`} name={`${active.label} index`} />
        </>
      )}

      <h3 className="mt-6 text-sm font-semibold">
        Sector growth ranking <Help topic="sectors" />
      </h3>
      {month && ranking.length > 0 ? (
        <>
          <p className="mb-2 text-xs text-ink-muted">
            Official year-on-year growth for {formatPeriod(month, true)}, the latest month in which every sector
            reports a value.
          </p>
          <ul aria-label="Sector growth ranking" className="space-y-1.5">
            {ranking.map(({ s, v }) => (
              <li key={s.key} className="grid grid-cols-[minmax(7rem,12rem)_1fr_4.5rem] items-center gap-2 text-sm">
                <span className="truncate" title={s.label}>{s.label}</span>
                <span className="flex h-4 items-center">
                  <span className="relative h-3 w-full rounded bg-bg">
                    <span
                      data-testid="rank-bar"
                      className={`absolute top-0 h-3 rounded ${v < 0 ? "right-1/2 bg-warn" : "left-1/2 bg-accent"}`}
                      style={{ width: `${(Math.abs(v) / maxAbs) * 50}%` }}
                    />
                    <span className="absolute left-1/2 top-0 h-3 w-px bg-ink-muted" />
                  </span>
                </span>
                <span className="figure text-right">
                  {v < 0 ? "▼ " : "▲ "}
                  {formatPercent(v, true)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-ink-muted">
          No month exists in which all stored sectors have an official growth value, so no ranking is shown.
        </p>
      )}

      <h3 className="mt-6 text-sm font-semibold">Compare sectors over time</h3>
      <p className="mb-2 text-xs text-ink-muted">
        Official year-on-year growth, one aligned chart per selected sector (levels are not comparable).
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <fieldset className="flex flex-wrap gap-3">
          <legend className="sr-only">Sectors to compare</legend>
          {sectors.map((s) => (
            <label key={s.key} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={compare.includes(s.key)} onChange={() => toggle(s.key)} />
              {s.label}
            </label>
          ))}
        </fieldset>
        <div role="group" aria-label="Comparison range" className="flex gap-2">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className={`rounded border px-2 py-0.5 text-xs ${focusRing} ${range === r ? "border-accent bg-accent text-accent-ink" : "border-rule"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {compared.length === 0 ? (
        <p className="text-sm text-ink-muted">Select one or more sectors to compare.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {compared.map((s) => {
            const d = withDerived(s.observations);
            const vis = inWindow(d, resolveWindow(d, range));
            const pts = vis.map((r) => ({
              n: monthNumber(r.period),
              label: formatPeriod(r.period),
              value: r.rate,
              tip: [`Index ${formatIndex(r.index)}`, "Official growth"],
            }));
            return (
              <div key={s.key}>
                <p className="mb-1 text-sm font-medium">{s.label} · official YoY growth</p>
                {pts.some((p) => p.value !== null) ? (
                  <SeriesChart points={pts} mode="bar" name={`${s.label} growth`} yLabel="YoY growth (%)" suffix="%" />
                ) : (
                  <p className="rounded border border-dashed border-rule px-3 py-8 text-center text-sm text-ink-muted">
                    Official growth is not available for this range.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <caption className="sr-only">Latest stored value for each IIP sector</caption>
          <thead>
            <tr className="border-b border-rule text-left text-xs">
              <th scope="col" className="py-2 pr-4 font-semibold">Sector</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Latest period</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">Index</th>
              <th scope="col" className="py-2 text-right font-semibold">YoY growth (official)</th>
            </tr>
          </thead>
          <tbody>
            {sectors.map((s) => {
              const latest = latestObservation(s.observations);
              return (
                <tr key={s.key} className="border-b border-rule last:border-b-0">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">{s.label}</th>
                  <td className="py-2 pr-4">{latest ? formatPeriod(latest.period, true) : "—"}</td>
                  <td className="figure py-2 pr-4 text-right">{formatIndex(latest?.index ?? null)}</td>
                  <td className="figure py-2 text-right">
                    {latest?.rate == null ? <span className="text-ink-muted">—</span> : formatPercent(latest.rate, true)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
